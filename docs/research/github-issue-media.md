# GitHub issue images and attachments

Research date: **2026-09-27**. For [Decide how private-repository images and attachments are displayed](https://github.com/chris-metz/verdandi/issues/13), under [Map: Verdandi MVP spec](https://github.com/chris-metz/verdandi/issues/1). This records URL shapes, what GitHub's rendered HTML contains, what `gh` can fetch, request costs, and Electron's delivery and caching mechanisms. It does not choose how Verdandi renders issue bodies or delivers media. Context: [GitHub issue data access research](github-issue-data-access.md), [ADR 0001](../adr/0001-typescript-electron-stack.md) (Electron, sandboxed renderer), [ADR 0002](../adr/0002-private-user-data-outside-config-dir.md) (where Chromium's profile lives).

## Findings

- **GitHub's rendered HTML already contains loadable URLs for uploaded images and videos, including those in private repositories.** REST `body_html` and GraphQL `bodyHTML`, both reachable through `gh api`, rewrite every uploaded image and video to `https://private-user-images.githubusercontent.com/<n>/<n>-<uuid>.<ext>?jwt=<redacted>`. This also happens in public repositories. These are bearer URLs: in the observations they loaded without a cookie, `Authorization` header, or `Referer`. They were valid for **300 seconds** from the API response and returned 404 afterwards. The URL format and lifetime are observed behavior; GitHub does not document them.
- **Non-image files are not signed in the HTML.** Links stay `https://github.com/user-attachments/files/<n>/<name>`, which returns 404 without authentication in a private repository.
- **`gh api` with a full `https://github.com/user-attachments/...` URL sends gh's token to github.com.** For private repositories it returned the bytes: assets and files both answered 200 via a 302 to a short-lived signed storage URL. This is undocumented. `gh` maintainers state there is no attachment API. Community reports say fine-grained PATs and GitHub App tokens get 404; that was not tested here.
- **Third-party images arrive as stable Camo URLs** that need no authentication. GitHub's own `user-images.githubusercontent.com` URLs (pre-2023 uploads) stay unsigned.
- **A local Markdown renderer would miss GitHub's server-side work**: reference and mention resolution, signing of media URLs, Camo proxying, syntax highlighting, task lists, alerts, and footnotes.
- **Neither approach renders Mermaid, GeoJSON, TopoJSON, ASCII STL, or math server-side.** The HTML carries their source plus markers for github.com's client-side renderers, so both approaches need local work for them.
- **Cost.** `bodyHTML` does not change GraphQL cost. The REST `html` media types lose `304` revalidation on bodies with signed URLs, because each response carries new signatures. Attachment and CDN fetches did not consume REST quota.
- **Electron can serve bytes to the sandboxed renderer through a privileged custom scheme (`protocol.handle`) or blob URLs over IPC, or let it load the signed https URLs directly.** Chromium's HTTP cache is on disk in Electron's default persistent session, and the signed image responses advertise a 30-day `max-age`. An in-memory session keeps that cache in memory. Custom-protocol responses do not go through the HTTP cache according to Electron's source.

## Attachment URL forms

Only people with access to a private repository can view its uploaded files. Public-repository uploads "can be accessed without authentication." The limits are 10 MB for images, 10/100 MB for videos (free/paid plans), and 25 MB for other files. Images and videos (`.png .gif .jpg .jpeg .svg .mp4 .mov .webm`) are supported everywhere. Documents, archives, logs, data, and code files are supported in issue and pull request comments. [Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files).

Since May 2023, "future attachments associated with private repositories can only be viewed after logging in". The change "doesn't apply retroactively to existing attachments, which are obfuscated by having a long, unguessable URL." [Changelog, 2023-05-09](https://github.blog/changelog/2023-05-08-more-secure-private-attachments/).

The periods below come from surveying issues in public repositories (`cli/cli`, `microsoft/vscode`, `golang/go`, `github/docs`). They are observations, not GitHub-documented cutovers.

| URL form | Seen in | Appears in | In rendered HTML | Unauthenticated fetch |
| --- | --- | --- | --- | --- |
| `https://github.com/user-attachments/assets/<uuid>` | current images and videos (from 2024) | raw `body` | rewritten to signed `private-user-images` URL | public: 302 to signed S3 URL; private: **404** |
| `https://github.com/user-attachments/files/<n>/<name>` | current other files | raw and HTML | unchanged `<a href>` | public: 302 to `objects.githubusercontent.com`; private: **404** |
| `https://github.com/<owner>/<repo>/assets/<n>/<uuid>` | 2023–2024 images and videos | raw `body` | rewritten to signed `private-user-images` URL (public verified) | not tested |
| `https://user-images.githubusercontent.com/<n>/<n>-<uuid>.<ext>` | uploads to 2022/early 2023 | raw and HTML | unchanged, not signed | public: 200, `max-age=3600` |
| `https://github.com/<owner>/<repo>/files/<n>/<name>` | legacy files | raw and HTML | unchanged `<a href>` | public: 302 to `objects.githubusercontent.com` |
| `https://private-user-images.githubusercontent.com/<n>/<n>-<uuid>.<ext>?jwt=…` | generated per API response | HTML only, unless a user pastes one | minted fresh each response | 200 until expiry, then 404 |

Raw Markdown shapes produced by uploads:

- **Images:** `<img width="…" height="…" alt="Image" src="https://github.com/user-attachments/assets/<uuid>" />` was the dominant form in current web-UI uploads, public and private. `![alt](https://github.com/user-attachments/assets/<uuid>)` also appears.
- **Videos:** the bare asset URL alone in a paragraph. GitHub CLI's docs say such a reference "renders as a player"; "if the reference appears within a sentence, it renders as a link instead." [Attaching files with GitHub CLI](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli).
- **Other files:** `[name.ext](https://github.com/user-attachments/files/<n>/name.ext)`.

`gh` ≥ 2.99.0 can upload images and videos with `--attach` (push access required), but it has no matching download command ([gh v2.99.0](https://github.com/cli/cli/releases/tag/v2.99.0)).

**Edge case, observed:** users sometimes paste signed `private-user-images…?jwt=` URLs, copied from a browser, into raw Markdown. Search found such bodies in public issues. The HTML passes the pasted URL through unchanged rather than re-signing it, so the image is permanently broken (404) after the original 300 seconds.

## GitHub-rendered HTML

### How to get it

- **REST.** Issue and issue-comment endpoints accept four custom media types; `application/vnd.github.html+json` "Returns HTML rendered from the body's markdown. Response will include `body_html`", and `full+json` returns `body`, `body_text`, and `body_html`. [REST issues](https://docs.github.com/en/rest/issues/issues#get-an-issue), [REST issue comments](https://docs.github.com/en/rest/issues/comments).
- **GraphQL.** `Issue.bodyHTML` and `IssueComment.bodyHTML` are typed `HTML` and described as "The body rendered to HTML"; `bodyText` also exists. [GraphQL Issues reference](https://docs.github.com/en/graphql/reference/issues).
- **Through `gh`.** `gh api` sends `Accept: */*` only when no Accept header is given; `-H 'Accept: application/vnd.github.html+json'` replaces it. GraphQL field selection is passed through unchanged. Both routes were verified with `gh` 2.101.0. [gh http.go](https://github.com/cli/cli/blob/v2.101.0/pkg/cmd/api/http.go#L88-L90), [gh api manual](https://cli.github.com/manual/gh_api).

REST, GraphQL, and an unauthenticated REST call for a public issue all produced the same signed image URLs.

### Media in the HTML

| Source | Observed HTML |
| --- | --- |
| Uploaded image | `<a target="_blank" rel="noopener noreferrer" href="SIGNED"><img src="SIGNED" alt="…" style="max-width: 100%;">`. Images uploaded as `<img width height>` add `class="js-gh-image-fallback"` and an inline style using `aspect-ratio` and `var(--bgColor-muted)`. |
| Uploaded video | `<details open class="details-reset border rounded-2"><summary>` with an Octicon and the file name, then `<video src="SIGNED" data-canonical-src="SIGNED" controls muted …>` |
| Uploaded non-image file | `<a href="https://github.com/user-attachments/files/<n>/<name>">name</a>`, not signed |
| Legacy `user-images` | `<img src="https://user-images.githubusercontent.com/…">`, not signed |
| Third-party image | `<img src="https://camo.githubusercontent.com/<hmac>/<hex-encoded-original-url>" data-canonical-src="ORIGINAL" …>` |

The asset UUID survives in the signed path, so a signed URL can be matched to its `user-attachments/assets/<uuid>` reference in the raw body.

**Signed URL properties.** Observed on 2026-09-27 in public issues and in a small sample of private-repository issues and comments (20 PNG/JPEG images; no private video was available):

- **JWT claims:** `iss: github.com`, `aud: raw.githubusercontent.com`, `nbf` = response time, `exp − nbf = 300` s. The payload embeds an S3-presigned path with `X-Amz-Expires=300` and a `response-content-type`. Video URLs had the same lifetime.
- **Minted per response.** Two REST calls two seconds apart produced different JWTs.
- **Bearer semantics.** Private and public signed URLs returned 200 from `curl` with no cookie, `Authorization`, or `Referer`. After `exp`, both returned 404 with an empty body.
- **Response headers:** `cache-control: max-age=2592000`, `x-content-type-options: nosniff`, and `content-security-policy: default-src 'none'; script-src 'none'; img-src 'self'; media-src 'self'; sandbox;`. There is no `Access-Control-Allow-Origin`, so `<img>` and `<video>` loads work but a renderer-side `fetch()` or canvas read would not. Videos answered `Range` with `206` and `accept-ranges: bytes`.
- **Not documented.** No docs.github.com page documents the `private-user-images` host, the JWT, or the 300-second lifetime. GitHub's anonymized-URL article says only that uploads get `https://<subdomain>.githubusercontent.com/` URLs, and that "Anyone who receives your anonymized URL, directly or indirectly, may view your image or video." [About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls).

**Derived constraint:** a media load that starts more than 300 seconds after the body was fetched fails. Examples:

- redisplaying a body from the in-memory cache;
- a view left open while a lazy image scrolls into view;
- seeking in a long video, which issues new range requests on the same URL.

Keeping such loads working requires refetching the body, fetching bytes while the URL is fresh, or fetching through the canonical `user-attachments` URL (below).

### Third-party images (Camo)

GitHub proxies third-party images through Camo. Camo "generates an anonymous URL proxy for each file which hides your browser details and related information from other users". Videos "are not processed through Camo" because externally hosted videos are unsupported. Images behind authentication or on private networks "can't be viewed by GitHub." [About anonymized URLs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls).

The observed Camo path is an HMAC followed by the hex-encoded original URL. It returned 200 without credentials, `cache-control: public, max-age=31536000`, and no CORS header. `data-canonical-src` carries the original URL. **Inference:** rendering a raw-Markdown image URL directly would contact the third-party host from the user's machine, which is what Camo exists to prevent.

### Features a local Markdown renderer would have to reimplement

The observed HTML comes from public issues: `cli/cli`, `microsoft/vscode`, `mathjax/MathJax`, `mermaid-js/mermaid`, and `Automattic/jetpack#44323` for GeoJSON/TopoJSON/STL.

| Feature | In API HTML | Rendered by |
| --- | --- | --- |
| Issue/PR references | `<a class="issue-link js-issue-link" data-id data-url data-hovercard-type="issue\|pull_request" href>` | Server: resolves the target and its type |
| @mentions | `<a class="user-mention notranslate" data-hovercard-type="user" href>` | Server |
| Emoji shortcodes | Plain Unicode (`:bug:` became 🐛); no `<g-emoji>` wrapper was found in the samples | Server |
| Task lists | `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" disabled class="task-list-item-checkbox" aria-label="Incomplete task">` | Server |
| Code blocks | `<div class="highlight highlight-source-<lang>">` with `<span class="pl-…">` tokens, plus `snippet-clipboard-content` copy data | Server; colors need GitHub's `pl-*` CSS |
| Alerts (`> [!NOTE]`, five types) | `<div class="markdown-alert markdown-alert-note">` with `<p class="markdown-alert-title">` | Server; appearance needs CSS |
| Footnotes | `<section data-footnotes class="footnotes">`, `<sup><a href="#user-content-fn-…">` | Server (seen in one public issue) |
| Tables | Wrapped in a `<markdown-accessiblity-table>` custom element (sic) | Server |
| `<details>`/`<summary>`, headings | Passed through; `dir="auto"` added; anchor ids prefixed `user-content-` | Server |
| Mermaid, GeoJSON, TopoJSON, ASCII STL | `<section class="js-render-needs-enrichment" data-host="https://viewscreen.githubusercontent.com" data-src="…/markdown/<type>?…" data-type="<type>">` with `data-json`/`data-plain` source and a highlighted `<pre>` fallback | **Client:** github.com JavaScript and a viewscreen embed |
| Math (`$…$`, `$$…$$`, ` ```math `) | `<math-renderer class="js-inline-math\|js-display-math" data-run-id>` containing the raw TeX | **Client:** GitHub "uses MathJax; an open source, JavaScript-based display engine" |

Sources: [diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams), [math](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions), [basic formatting: task lists, mentions, references, emoji, footnotes, alerts](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax).

**What the HTML route still requires:**

- GitHub-like styles for its classes: Primer utility classes, `pl-*`, alerts, Octicons, `--bgColor-*` variables;
- handling for the custom elements;
- a local renderer for diagrams and math, or display of their source;
- link interception.

**What a local renderer also requires:** it must separately reproduce reference and mention resolution, emoji, highlighting, and media URL handling.

GitHub offers `POST /markdown` (GFM with a `context` repository for references). It was not exercised because of this research's read-only constraint, so whether it signs media URLs is unknown. [REST Markdown](https://docs.github.com/en/rest/markdown/markdown).

### Safety of the HTML

GitHub describes a GitHub.com pipeline in which the HTML is sanitized, "aggressively removing things that could harm you and your kin—such as `script` tags, inline-styles, and `class` or `id` attributes". Filters then add emoji, task lists, anchors, image caching, and autolinks. The `github/markup` gem itself "does no sanitization." [github/markup README](https://github.com/github/markup#github-markup).

No GitHub document found here states that `body_html`/`bodyHTML` is safe for embedding in another application. The observed HTML still carries GitHub-added `style`, `class`, and `data-*` attributes, `target="_blank"` links, custom elements, and user-chosen link targets.

Electron's guide warns that "displaying arbitrary content from untrusted sources poses a severe security risk that Electron is not intended to handle". [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

**Derived requirement:** whichever route is chosen, treat body HTML as untrusted input and apply Verdandi's own allowlist before insertion.

## Fetching bytes with gh's credentials

### What `gh api` does with a full URL

- **Absolute URLs are used as-is:** `if strings.Contains(p, "://") { // Absolute URLs are used as-is`. The manual only describes the endpoint as "a path of a GitHub API v3 endpoint, or `graphql`", so this is supported in code but undocumented. [http.go#L19-L36](https://github.com/cli/cli/blob/v2.101.0/pkg/cmd/api/http.go#L19-L36).
- **Which hosts get the token.** `AddAuthTokenHeader` looks up a token for `NormalizeHostname(host)`. go-gh v2.16.1 maps any host ending in `.github.com` to `github.com`, so `github.com`, `api.github.com`, and `uploads.github.com` receive `Authorization: token …`. `*.githubusercontent.com` hosts get no token. [api/http_client.go#L153-L190](https://github.com/cli/cli/blob/v2.101.0/api/http_client.go#L153-L190), [go-gh auth.go#L178-L195](https://github.com/cli/go-gh/blob/v2.16.1/pkg/auth/auth.go#L178-L195).
  - **Caveat, inferred from code and not tested:** if `GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN` is set, go-gh returns it for non-github.com hosts. [auth.go#L63-L99](https://github.com/cli/go-gh/blob/v2.16.1/pkg/auth/auth.go#L63-L99).
- **Redirects.** Go follows them. gh does not add its token when the hostname changes during a redirect, and Go itself drops `Authorization` on redirects to a different domain. [Go `http.Client`](https://pkg.go.dev/net/http#Client). The traces confirmed that the token went only to github.com and not to the S3 or `objects.githubusercontent.com` hop.
- **Output.** Non-JSON bodies are streamed verbatim when stdout is not a terminal; the sha256 of a PNG via `gh api` matched `curl` and the signed URL. Two caveats:
  - Textual bodies containing terminal escape sequences are refused even when piped, unless `--allow-escape-sequences` is passed. A `.log` attachment with ANSI colors would therefore fail without the flag.
  - Bodies with a JSON content type pass through go-gh's sanitizer and are not byte-exact.
  - There is no `--output` flag.

  Sources: [api.go#L475-L548](https://github.com/cli/cli/blob/v2.101.0/pkg/cmd/api/api.go#L475-L548), [iostreams/content.go#L63-L92](https://github.com/cli/cli/blob/v2.101.0/pkg/iostreams/content.go#L63-L92), [go-gh sanitizer](https://github.com/cli/go-gh/blob/v2.16.1/pkg/api/http_client.go#L257-L271).

### Observed results

Token: gh's default OAuth login (keyring; scopes `gist, read:org, repo, workflow`). Status codes only:

| Request | `curl`, no credentials | `gh api <full URL>` |
| --- | --- | --- |
| Public `github.com/user-attachments/assets/<uuid>` | 302 → S3, `X-Amz-Expires=300` | 200 (same redirect) |
| Private `github.com/user-attachments/assets/<uuid>` | 404 | **200**: token sent to github.com, 302 → S3 URL (300 s), no token on that hop; bytes identical to the HTML's signed URL |
| Private `github.com/user-attachments/files/<n>/<name>` | 404 | **200**: 302 → `objects.githubusercontent.com` (300 s), `content-disposition: attachment` |
| Private `private-user-images…?jwt=` (fresh) | 200 | 200 (no token sent) |
| Private `github.com/<o>/<r>/raw/<branch>/<file>` and `blob/…?raw=true` | 404 | 404: token sent, not accepted |
| Private `raw.githubusercontent.com/<o>/<r>/<branch>/<file>` | 404 | 404: gh sends no token to this host |
| Private REST contents, `Accept: application/vnd.github.raw` | n/a | 200 |

**Status of the user-attachments route:** undocumented. `gh` maintainers call attachment download "blocked because GitHub APIs don't support issue and PR attachments" ([cli/cli#9046](https://github.com/cli/cli/issues/9046)). They also said there is "no public API" and that parsing bodies to download attachments is out of scope for `gh` ([cli/cli#11584](https://github.com/cli/cli/issues/11584)).

**Secondary evidence, community discussions without GitHub staff answers:**

- A personal access token worked where a GitHub App installation token received 404. The suggested workaround was to fetch `body_html` and use its short-lived JWT URL. [community#148227](https://github.com/orgs/community/discussions/148227).
- A fine-grained PAT and a GitHub App token both received 404 on `user-attachments/files`. [community#162417](https://github.com/orgs/community/discussions/162417).

So the direct route depends on token type. A user whose `gh` uses a fine-grained PAT via `GH_TOKEN`, or who is in an SSO-enforced organization, may fail where the HTML route succeeds; neither case was tested.

**Repository files referenced as images** (for example `blob/…?raw=true` or `raw.githubusercontent.com` in a private repository) are not reachable through gh's token on those web hosts. The documented authenticated path is the contents API with the raw media type, which is a normal REST request. [REST repository contents](https://docs.github.com/en/rest/repos/contents#get-repository-content). How such references appear in private-repository body HTML was not observed.

## Cost

- **GraphQL.** Issue queries with `first:100` cost 1 point with `body` alone, with `body bodyHTML`, and with nested `comments(first:100){ nodes { bodyHTML } }`. These costs came from `rateLimit(dryRun:true)`, which calculates cost without running the query; executed queries that included `bodyHTML` also reported cost 1. This matches GitHub's connection-based cost calculation, in which scalar fields add nothing. [GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).
- **REST HTML media types.** A `304` does not count against the primary limit when made with authorization, and GitHub advises keeping responses stable so polls return `304`. [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests).
  - **Observed:** for an issue with attachments, each `html+json` response had a new ETag, and `If-None-Match` with the previous one returned 200.
  - For an issue without attachments, the same conditional request returned 304, as did the default JSON media type for the issue with attachments.
  - **Inference:** revalidating bodies that contain uploads through HTML media types costs a full request each time.
- **Media hosts.** `private-user-images`, S3, `objects.githubusercontent.com`, Camo, and `user-images` responses carry no rate-limit headers.
  - Twenty `gh api https://github.com/user-attachments/assets/…` fetches (10 public, 10 private) and three private `files` fetches left REST core `X-RateLimit-Used` unchanged; interleaved control calls incremented it by one each.
  - Whether github.com applies other, unpublished limits to these endpoints at volume is unknown.

## Electron delivery

These facts were checked against Electron **v44.4.5** docs and source; no Verdandi Electron app was run.

| Mechanism | Documented behavior | Notes |
| --- | --- | --- |
| `protocol.handle(scheme, handler)` | Handler returns a `Response` or `Promise<Response>`; a body can be a `Buffer`, string, or `ReadableStream`. It replaced the `register*`/`intercept*` APIs deprecated in Electron 25. Protocols are registered per session (`ses.protocol`). [protocol](https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler), [breaking changes](https://www.electronjs.org/docs/latest/breaking-changes) | `registerSchemesAsPrivileged` must be called before `ready`, only once. Privileges: `standard`, `secure`, `bypassCSP`, `supportFetchAPI`, `corsEnabled`, `stream`. `stream` makes `<video>`/`<audio>` expect streamed responses. [CustomScheme](https://www.electronjs.org/docs/latest/api/structures/custom-scheme) |
| Range for video via custom scheme | Not documented | Secondary: the handler must answer `206`/`Content-Range` itself. Seek issue [#38749](https://github.com/electron/electron/issues/38749) (open); fix [#47703](https://github.com/electron/electron/pull/47703); a maintainer recommends `standard: true` ([#51442](https://github.com/electron/electron/issues/51442)) |
| `session.webRequest` | `onBeforeRequest` can cancel or redirect, `onBeforeSendHeaders` can rewrite request headers, `onHeadersReceived` can rewrite response headers such as CSP. "Only the last attached `listener` will be used." [webRequest](https://www.electronjs.org/docs/latest/api/web-request) | Whether it sees custom-scheme requests is undocumented, and the secondary evidence conflicts ([#23413](https://github.com/electron/electron/issues/23413)) |
| Bytes over IPC → blob URL | `ipcRenderer.invoke` uses structured clone; typed arrays are transferred as such; `Buffer` arrives as `Uint8Array`. [IPC serialization](https://www.electronjs.org/docs/latest/tutorial/ipc#object-serialization), [contextBridge types](https://www.electronjs.org/docs/latest/api/context-bridge#parameter--error--return-type-support) | Chromium may page blob data to `<profile>/blob_storage` under memory pressure. It disables this for off-the-record contexts, which is what Electron's in-memory sessions report (from source). [Chromium blob README](https://github.com/chromium/chromium/blob/main/storage/browser/blob/README.md) |
| Direct https loads by the renderer | Allowed if CSP permits; signed URLs need no token | Loses control after the 300-second window; see disk cache below |

**CSP.** `img-src` governs image-destination requests: `<img>`, SVG `<image>`, and CSS images. `media-src` governs "video, audio, and associated text track resources" ([CSP3 img-src](https://www.w3.org/TR/CSP3/#directive-img-src), [media-src](https://www.w3.org/TR/CSP3/#directive-media-src), [Fetch destinations](https://fetch.spec.whatwg.org/#concept-request-destination)).

- `*` does not match non-HTTP(S) schemes other than the page's own, so a custom scheme, `blob:`, and `data:` must be listed explicitly, for example `img-src verdandi-media: blob:`.
- `'self'` never matches `blob:`.
- The `bypassCSP` privilege exempts that scheme's resources from the page's policy, according to Electron's source. The alternative is to list the scheme.

Electron recommends delivering CSP by header (`onHeadersReceived`, or directly on a `protocol.handle` response), with `<meta>` as a fallback. Its checklist also covers `will-navigate` and `setWindowOpenHandler` for link handling. [Electron security](https://www.electronjs.org/docs/latest/tutorial/security).

For embeds, Electron recommends the iframe `sandbox` attribute with minimal capabilities and advises against `<webview>`. [Web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds).

**Disk cache:**

- **Default session.** Chromium's HTTP cache is enabled by default and lives in `sessionData`, which defaults to `userData`. Under ADR 0002 that is the machine-local desktop directory. A `BrowserWindow`'s default session is persistent. [app.getPath](https://www.electronjs.org/docs/latest/api/app#appgetpathname), [session](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options).
- **In-memory session.** `session.fromPartition(name)` without the `persist:` prefix, or `webPreferences.partition`, creates "an in-memory session"; its `getStoragePath()` is `null`. Electron's docs do not state where that session's HTTP cache lives. Electron's source sets no cache directory for it, and Chromium's network-context contract says "If null and the cache is enabled, an in-memory database is used" (source, not docs).
- **Other controls:** `fromPartition(p, { cache: false })`, `ses.clearCache()`, and the switches `--disable-http-cache` and `--disk-cache-size`. [Command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches).
- **Media responses are cacheable.** Signed image and video responses advertise `max-age=2592000` (30 days), Camo `public, max-age=31536000`, and legacy `user-images` `max-age=3600`. Under RFC 9111 these are storable. **Inference, not measured in Electron:** in a persistent session, renderer-loaded private images can be written to the disk cache even though each signed URL is used only once.
- **Header rewrites.** `no-store` forbids storing in non-volatile storage ([RFC 9111 §5.2.2.5](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.5)). Rewriting `Cache-Control` in `onHeadersReceived` is **unverified** as a way to stop caching; Chromium appears to apply those overrides after its cache transaction.
- **Custom schemes.** `protocol.handle` responses are served by Electron's URL loader factory outside the network service's HTTP cache, so they are not written to the disk cache. Source-level finding, not documented. Blink's in-renderer memory cache is in memory only.

## What this resolves and leaves open

Three workable shapes emerge. These are not decisions:

1. **Render GitHub's HTML and let the renderer load signed and Camo URLs directly** under a CSP naming those hosts. This needs no token outside `gh` and no custom scheme. It must work within the 300-second window, sanitize and restyle GitHub's HTML, and use an in-memory session to keep private media off disk.
2. **Render GitHub's HTML, but rewrite media URLs to a custom scheme** that the core fulfils. The core can fetch signed URLs with an ordinary HTTPS client holding no GitHub token, or `gh api` the canonical `user-attachments` URL recovered from the UUID. Responses bypass the HTTP disk cache, and the core controls retries, Range, and the in-memory lifetime. The canonical-URL fallback is undocumented and token-type-dependent.
3. **Render raw Markdown locally.** This reimplements the server-side features listed above. It needs attachment bytes through the undocumented `gh api` route, or through a second, HTML fetch just for signed URLs. It must also choose between loading third-party images directly, which exposes the user to those hosts, and taking Camo URLs from the HTML.

Diagrams and math need client-side rendering in every shape. Non-image files are links in every shape. Opening one needs either `gh api` on the `files` URL or a hand-off to the browser, where GitHub's session applies.

These findings feed [Decide how private-repository images and attachments are displayed](https://github.com/chris-metz/verdandi/issues/13). The revalidation and cost point also matters to [Decide refresh, partial loading and rate-limit recovery](https://github.com/chris-metz/verdandi/issues/15).

A public reproduction of the signed-URL observation (the URL and its claims change on every call):

```sh
gh api graphql -f query='
query {
  repository(owner: "cli", name: "cli") {
    issue(number: 14528) { bodyHTML }
  }
}' --jq '.data.repository.issue.bodyHTML' \
  | grep -o 'src="https://private-user-images[^"]*"' | head -1
```

**Evidence limits:**

- Observations are dated 2026-09-27 with `gh` 2.101.0 and gh's OAuth token. Public examples are named above.
- Private-repository checks covered a small sample of recent issues and comments (20 PNG/JPEG images, 3 PDF/DOCX files) and are reported only as structure and status codes. They did not include private videos, legacy private forms (`user-images`, `<owner>/<repo>/assets`, `<owner>/<repo>/files`), or third-party images in private bodies.
- Not tested:
  - fine-grained PATs, `GH_TOKEN`/enterprise-token overrides, GitHub App tokens, SSO-enforced organizations, and GHES;
  - volume limits on github.com attachment endpoints;
  - `POST /markdown`;
  - any Electron behavior: no app was built, and the caching, Range, and `webRequest` points above rest on docs and source reading.
- The `private-user-images` format, its 300-second lifetime, and token acceptance on `user-attachments` are undocumented and could change without notice.
- This note contains no credentials, JWTs, private repository names, private URLs, or issue content.
