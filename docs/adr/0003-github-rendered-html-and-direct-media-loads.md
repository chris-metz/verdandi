# Render GitHub's issue HTML and let the renderer load its media directly

Issue bodies and comments are displayed from the HTML GitHub renders for them (GraphQL `bodyHTML`), not from the raw Markdown. That HTML already resolves issue and pull request references and mentions, converts emoji, highlights code, proxies third-party images through Camo, and replaces uploaded images and videos, including those from private repositories, with signed links that load without credentials for about five minutes. The sandboxed renderer loads those media links itself, and only from GitHub's media hosts (`private-user-images`, `camo` and legacy `user-images` on `githubusercontent.com`). This is the one place where the renderer fetches anything that does not come through the core. It still never holds a GitHub token, and it never contacts a host named in issue content. Chromium's ordinary HTTP cache is accepted, so viewed images from private repositories may remain in the machine-local app-data directory from [ADR 0002](0002-private-user-data-outside-config-dir.md), even though issue data itself is only kept in memory.

The issue-page metadata in [issue #25](https://github.com/chris-metz/verdandi/issues/25) extends this direct-image exception to `https://avatars.githubusercontent.com` for assignee avatars returned by GitHub. These requests carry no GitHub token or referrer. The renderer's CSP names that host explicitly; external avatar URLs on other hosts do not load. This adds GitHub's own avatar service to the original media-host allowance without allowing arbitrary image hosts.

The media ticket, [issue #32](https://github.com/chris-metz/verdandi/issues/32), lets an image without a Camo link load after an explicit click on its placeholder. Nothing loads until the user clicks. The main process then fetches the image with Node's own `fetch`, outside the window's session. The fetch is `https://` only, including redirects, and sends no cookies, credentials or referrer. The file must be an image of at most 10 MB. The renderer shows it as a `blob:` URL, which its CSP allows for this, so the CSP still names no other image host. The renderer itself still contacts no host named in issue content. The click reveals the user's IP address to that host, as opening the image in a browser would.

The macOS app ([ADR 0006](0006-try-a-native-macos-app-beside-electron.md)) loads images the same way since [issue #69](https://github.com/chris-metz/verdandi/issues/69). The content policy of its web views names those four hosts. An image from any other host shows as a placeholder that names the host. A click has the app fetch the image with a `URLSession` of its own, under the same limits, and the web view shows it as a `data:` URL. The web views keep nothing on disk.

## Considered Options

- **Render the raw Markdown locally:** it would have to rebuild GitHub's reference resolution, emoji and highlighting, and it gets no Camo links. Private media would then only be reachable by fetching `github.com/user-attachments` URLs with gh's token, which is undocumented and reportedly fails with fine-grained tokens.
- **Have the core fetch media and serve it through a custom scheme:** this is robust against expiring links and keeps media off disk. It needs its own byte fetching, memory limits and video range handling, which is too much for the MVP.

## Consequences

The HTML is treated as untrusted and passes through Verdandi's own allowlist and stylesheet before display. When a media load fails, the issue's HTML is fetched again once to get fresh links before a placeholder is shown. The signed-link host and its lifetime are observed behavior that GitHub does not document; if it changes, images fall back to placeholders with **Open on GitHub**. The evidence is in [GitHub issue images and attachments](../research/github-issue-media.md).

Decided in [Decide how private-repository images and attachments are displayed](https://github.com/chris-metz/verdandi/issues/13).
