import { describe, expect, it } from "vitest";
import { sanitizeGitHubHtml } from "./github-html";
import {
  imageAltAttribute,
  loadImageAttribute,
  openOnGitHubAttribute,
} from "./own-elements";

/** GitHub's HTML as Verdandi inserts it. */
function inserted(html: string): HTMLElement {
  const container = document.createElement("div");
  container.append(sanitizeGitHubHtml(html, document));
  return container;
}

/** GitHub's HTML as Verdandi inserts it, read back as HTML. */
function sanitized(html: string): string {
  return inserted(html).innerHTML;
}

/**
 * HTML that would run script, load something, restyle or take over the
 * window, or follow a link of another scheme than `https:`, if it were
 * inserted as it is.
 */
const hostileCorpus = [
  "<script>alert(1)</script>",
  '<img src="x" onerror="alert(1)">',
  '<img src="https://evil.example/pixel.gif" srcset="https://evil.example/2x.gif 2x">',
  '<svg onload=alert(1)><path d="M0 0"/></svg>',
  "<svg><script>alert(1)</script></svg>",
  '<svg><use href="https://evil.example/sprite.svg#x"></use></svg>',
  '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
  '<svg><animate attributeName="href" to="javascript:alert(1)"/></svg>',
  '<svg><foreignObject><iframe src="https://evil.example"></iframe></foreignObject></svg>',
  '<svg><image href="https://evil.example/x.png"/></svg>',
  "<math><mtext><table><mglyph><style><img src=x onerror=alert(1)>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  '<iframe src="https://evil.example"></iframe>',
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<form action="https://evil.example"><input name="q"><button formaction="javascript:alert(1)">Go</button></form>',
  '<textarea autofocus onfocus="alert(1)"></textarea>',
  '<input type="text" autofocus onfocus="alert(1)">',
  '<input type="image" src="https://evil.example/x.png">',
  '<input type="checkbox" onclick="alert(1)" checked>',
  "<style>body { display: none }</style>",
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<meta http-equiv="refresh" content="0; url=https://evil.example">',
  '<base href="https://evil.example/">',
  "<template><img src=x onerror=alert(1)></template>",
  '<video src="https://evil.example/x.mp4" autoplay poster="https://evil.example/x.png"></video>',
  '<audio src="https://evil.example/x.mp3" autoplay></audio>',
  '<picture><source srcset="https://evil.example/x.png"><img src="x"></picture>',
  '<a href="javascript:alert(1)">x</a>',
  '<a href=" JaVaScRiPt:alert(1)">x</a>',
  '<a href="java&#x09;script:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>',
  '<a href="vbscript:msgbox(1)">x</a>',
  '<a href="file:///etc/passwd">x</a>',
  '<a href="http://evil.example">x</a>',
  '<a href="mailto:octo@example.com">x</a>',
  '<a href="https://evil.example" target="_blank" rel="opener" ping="https://evil.example/ping">x</a>',
  '<p onclick="alert(1)" onmouseover="alert(1)">x</p>',
  '<details open ontoggle="alert(1)"><summary>x</summary></details>',
  '<div style="position: fixed; inset: 0; z-index: 99">x</div>',
  '<div class="fixed inset-0 z-50 bg-background">x</div>',
  '<p id="root">x</p><a name="verdandi">x</a>',
  '<table background="https://evil.example/x.png"><tr><td background="javascript:alert(1)">x</td></tr></table>',
  '<blockquote cite="javascript:alert(1)">x</blockquote>',
  '<x-evil onmouseover="alert(1)">x</x-evil>',
  "<dialog open>x</dialog>",
  '<frameset onload="alert(1)"></frameset>',
  '<p data-open-on-github="">x</p>',
  '<button type="button" data-load-image="https://evil.example/x.png">Load image</button>',
  '<img src="https://private-user-images.githubusercontent.com/1/2.png?jwt=x" onerror="alert(1)" srcset="https://evil.example/2x.png 2x" usemap="#m" ismap style="position: fixed">',
  '<video src="https://private-user-images.githubusercontent.com/1/2.mp4?jwt=x" autoplay loop onplay="alert(1)" poster="https://evil.example/x.png"><track src="https://evil.example/t.vtt"></video>',
  '<video src="https://camo.githubusercontent.com/x.mp4" autoplay></video>',
  '<img src="https://camo.githubusercontent.com.evil.example/x.png">',
  '<img src="https://octo:secret@camo.githubusercontent.com/x.png">',
  '<a href="https://camo.githubusercontent.com/x"><img src="https://evil.example/x.png"></a>',
  "<!-- <img src=x onerror=alert(1)> -->",
];

const xhtml = "http://www.w3.org/1999/xhtml";

/** Attributes that would load something if an element kept them. */
const loadingAttributes = [
  "src",
  "srcset",
  "srcdoc",
  "poster",
  "background",
  "data",
  "action",
  "formaction",
  "ping",
  "xlink:href",
];

/** Images and videos loaded from GitHub's media hosts, by their tag. */
const mediaHosts: Record<string, RegExp> = {
  img: /^https:\/\/(private-user-images|user-images|camo)\.githubusercontent\.com\//,
  video:
    /^https:\/\/(private-user-images|user-images)\.githubusercontent\.com\//,
};

/** The attributes Verdandi's own buttons carry. */
const buttonAttributes = [
  "type",
  openOnGitHubAttribute,
  loadImageAttribute,
  imageAltAttribute,
];

/**
 * Whether Verdandi made an element, rather than kept it: its own buttons,
 * which carry its attributes only, and images and videos from GitHub's
 * media hosts.
 */
function isVerdandis(element: Element): boolean {
  if (element.localName === "button") {
    return (
      element.getAttribute("type") === "button" &&
      [...element.attributes].every(({ name }) =>
        buttonAttributes.includes(name),
      )
    );
  }
  const host = mediaHosts[element.localName];
  return host?.test(element.getAttribute("src") ?? "") ?? false;
}

describe("GitHub's HTML", () => {
  it("keeps GitHub's formatting of text", () => {
    const html =
      '<h2 dir="auto">Steps</h2>\n<p dir="auto">It <strong>crashes</strong> <em>often</em>, <del>never</del> <code>on start</code>.<br>Always.</p>\n<ol dir="auto">\n<li>Open</li>\n<li>Close</li>\n</ol>\n<blockquote>\n<p dir="auto">Quoted</p>\n</blockquote>\n<hr>';

    expect(sanitized(html)).toBe(html);
  });

  it.each([
    [
      "task lists, whose checkboxes cannot be changed",
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Completed task" checked=""> Done</li>\n<li class="task-list-item"><input type="checkbox" id="" disabled="" class="task-list-item-checkbox" aria-label="Incomplete task"> Todo</li>\n</ul>',
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" checked="" aria-label="Completed task"> Done</li>\n<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled="" aria-label="Incomplete task"> Todo</li>\n</ul>',
    ],
    [
      "tables, without GitHub's element around them",
      '<markdown-accessiblity-table><table>\n<thead>\n<tr>\n<th align="left">Name</th>\n<th align="right">Count</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left">a</td>\n<td align="right">1</td>\n</tr>\n</tbody>\n</table></markdown-accessiblity-table>',
      '<table>\n<thead>\n<tr>\n<th align="left">Name</th>\n<th align="right">Count</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td align="left">a</td>\n<td align="right">1</td>\n</tr>\n</tbody>\n</table>',
    ],
    [
      "strikethrough and autolinks",
      '<p dir="auto"><del>Old</del> <a href="https://example.com/docs" rel="nofollow">https://example.com/docs</a></p>',
      '<p dir="auto"><del>Old</del> <a href="https://example.com/docs">https://example.com/docs</a></p>',
    ],
    [
      "highlighted code, without GitHub's copy button",
      '<div class="highlight highlight-source-js notranslate position-relative overflow-auto" dir="auto"><pre><span class="pl-k">const</span> <span class="pl-s1">x</span> <span class="pl-c1">=</span> <span class="pl-s">"a"</span><span class="pl-kos">;</span></pre><div class="zeroclipboard-container">\n<clipboard-copy aria-label="Copy" class="ClipboardButton btn js-clipboard-copy m-2 p-0" data-copy-feedback="Copied!" value="const x = &quot;a&quot;;" tabindex="0" role="button"><svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" class="octicon octicon-copy js-clipboard-copy-icon"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5Z"></path></svg></clipboard-copy>\n</div></div>',
      '<div class="highlight highlight-source-js" dir="auto"><pre><span class="pl-k">const</span> <span class="pl-s1">x</span> <span class="pl-c1">=</span> <span class="pl-s">"a"</span><span class="pl-kos">;</span></pre></div>',
    ],
    [
      "emoji, those GitHub draws as images by their names",
      '<p dir="auto">Ship it 🚀 <g-emoji class="g-emoji" alias="tada">🎉</g-emoji> <img class="emoji" title=":octocat:" alt=":octocat:" src="https://github.githubassets.com/images/icons/emoji/octocat.png" height="20" width="20" align="absmiddle"></p>',
      '<p dir="auto">Ship it 🚀 🎉 :octocat:</p>',
    ],
    [
      "mentions and references",
      '<p dir="auto"><a class="user-mention notranslate" data-hovercard-type="user" data-hovercard-url="/users/octo-dev/hovercard" data-octo-click="hovercard-link-click" href="https://github.com/octo-dev">@octo-dev</a> see <a class="issue-link js-issue-link" data-error-text="Failed to load title" data-id="3000000001" data-permission-text="Title is private" data-url="https://github.com/acme/api/issues/12" data-hovercard-type="issue" data-hovercard-url="/acme/api/issues/12/hovercard" href="https://github.com/acme/api/issues/12">#12</a></p>',
      '<p dir="auto"><a class="user-mention" href="https://github.com/octo-dev">@octo-dev</a> see <a class="issue-link" href="https://github.com/acme/api/issues/12">#12</a></p>',
    ],
    [
      "alerts, with their icons' shapes",
      '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon octicon-info mr-2" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13Z"></path></svg>Note</p><p dir="auto">Read this.</p>\n</div>',
      '<div class="markdown-alert markdown-alert-note" dir="auto"><p class="markdown-alert-title" dir="auto"><svg viewBox="0 0 16 16" width="16" height="16" class="octicon octicon-info" aria-hidden="true"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13Z"></path></svg>Note</p><p dir="auto">Read this.</p>\n</div>',
    ],
    [
      "<details>",
      '<details open=""><summary>Logs</summary>\n<p dir="auto">Trace</p>\n</details>',
      '<details open=""><summary>Logs</summary>\n<p dir="auto">Trace</p>\n</details>',
    ],
    [
      "footnotes, with GitHub's anchors",
      '<p dir="auto">Claim<sup><a href="#user-content-fn-1-4a1b" id="user-content-fnref-1-4a1b" data-footnote-ref="" aria-describedby="footnote-label">1</a></sup></p>\n<section data-footnotes="" class="footnotes"><h2 id="footnote-label" class="sr-only" dir="auto">Footnotes</h2>\n<ol dir="auto">\n<li id="user-content-fn-1-4a1b">\n<p dir="auto">Source <a href="#user-content-fnref-1-4a1b" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p>\n</li>\n</ol>\n</section>',
      '<p dir="auto">Claim<sup><a id="user-content-fnref-1-4a1b" href="#user-content-fn-1-4a1b">1</a></sup></p>\n<section class="footnotes"><h2 class="sr-only" dir="auto">Footnotes</h2>\n<ol dir="auto">\n<li id="user-content-fn-1-4a1b">\n<p dir="auto">Source <a class="data-footnote-backref" href="#user-content-fnref-1-4a1b" aria-label="Back to reference 1">↩</a></p>\n</li>\n</ol>\n</section>',
    ],
    [
      "headings, with the anchor GitHub puts beside them",
      '<div class="markdown-heading" dir="auto"><h2 tabindex="-1" class="heading-element" dir="auto">Steps</h2><a id="user-content-steps" class="anchor" aria-label="Permalink: Steps" href="#steps"><svg class="octicon octicon-link" viewBox="0 0 16 16" version="1.1" width="16" height="16" aria-hidden="true"><path d="m7.775 3.275 1.25-1.25Z"></path></svg></a></div>',
      '<div dir="auto"><h2 dir="auto" id="user-content-steps">Steps</h2></div>',
    ],
  ])("keeps %s", (_, html, expected) => {
    expect(sanitized(html)).toBe(expected);
  });

  it.each([
    ["mermaid", "Mermaid diagram"],
    ["geojson", "GeoJSON map"],
    ["topojson", "TopoJSON map"],
    ["stl", "STL model"],
  ])(
    "shows a %s block github.com renders itself as its source, with Open on GitHub",
    (type, name) => {
      const html = `<section class="js-render-needs-enrichment render-needs-enrichment position-relative" data-identity="0e1f" data-host="https://viewscreen.githubusercontent.com" data-src="https://viewscreen.githubusercontent.com/markdown/${type}?docs_host=https%3A%2F%2Fdocs.github.com" data-type="${type}" aria-label="${type} rendered output container">\n  <div class="js-render-enrichment-target" data-json="{}" data-plain="first &lt;line&gt;\n  second\n" dir="auto">\n    <div class="render-plaintext-hidden" dir="auto">\n      <pre lang="${type}" aria-label="Raw ${type} code">first &lt;line&gt;\n  second\n</pre>\n    </div>\n  </div>\n  <span class="js-render-enrichment-loader d-flex" style="min-height:100px" role="presentation"><svg width="16" height="16" viewBox="0 0 16 16" class="octospinner"><circle cx="8" cy="8" r="7"></circle></svg></span>\n</section>`;

      expect(sanitized(html)).toBe(
        `<div class="client-rendered"><div class="client-rendered-header"><span>${name}</span><button type="button" data-open-on-github="">Open on GitHub</button></div><pre><code>first &lt;line&gt;\n  second</code></pre></div>`,
      );
    },
  );

  it("shows math github.com renders itself as its source: in code within a line, and on its own with Open on GitHub", () => {
    const html =
      '<p dir="auto">Where <math-renderer class="js-inline-math" style="display: inline" data-static-url="https://github.githubassets.com/static" data-run-id="8d3f">$x^2$</math-renderer> holds:</p>\n<math-renderer class="js-display-math" style="display: block" data-static-url="https://github.githubassets.com/static" data-run-id="9e4a">$$\n\\sum_{i=1}^n i\n$$</math-renderer>';

    expect(sanitized(html)).toBe(
      '<p dir="auto">Where <code>$x^2$</code> holds:</p>\n<div class="client-rendered"><div class="client-rendered-header"><span>Math</span><button type="button" data-open-on-github="">Open on GitHub</button></div><pre><code>$$\n\\sum_{i=1}^n i\n$$</code></pre></div>',
    );
  });

  const signed =
    "https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=abc";
  const legacy = "https://user-images.githubusercontent.com/1/2-9c1d.png";
  const camo =
    "https://camo.githubusercontent.com/8f1a/68747470733a2f2f6578616d706c652e636f6d2f782e706e67";

  it("shows uploaded images to open in the viewer, instead of GitHub's link around them", () => {
    const html = `<p dir="auto"><a target="_blank" rel="noopener noreferrer" href="${signed}"><img src="${signed}" alt="Screenshot" style="max-width: 100%;"></a> <img width="320" height="200" alt="Image" src="${legacy}" class="js-gh-image-fallback" style="aspect-ratio: 8 / 5; background-color: var(--bgColor-muted);"></p>`;

    expect(sanitized(html)).toBe(
      `<p dir="auto"><img class="media-image" src="${signed}" alt="Screenshot" tabindex="0" role="button"> <img class="media-image" src="${legacy}" alt="Image" tabindex="0" role="button" width="320" height="200"></p>`,
    );
  });

  it("shows third-party images through Camo, following a link around one that leads elsewhere", () => {
    const badge = camo.replace("8f1a", "7e2b");
    const html = `<p dir="auto"><a target="_blank" rel="noopener noreferrer nofollow" href="${camo}"><img src="${camo}" data-canonical-src="https://example.com/x.png" alt="Diagram" style="max-width: 100%;"></a> <a href="https://ci.example/build" rel="nofollow"><img src="${badge}" data-canonical-src="https://ci.example/badge.svg" alt="CI"></a></p>`;

    expect(sanitized(html)).toBe(
      `<p dir="auto"><img class="media-image" src="${camo}" alt="Diagram" tabindex="0" role="button"> <a href="https://ci.example/build"><img class="media-image" src="${badge}" alt="CI"></a></p>`,
    );
  });

  it("shows uploaded videos with controls, named by their file, never playing on their own", () => {
    const video = signed.replace(".png", ".mp4");
    const html = `<details open="" class="details-reset border rounded-2"><summary class="py-2 px-3"><span aria-label="Video description demo.mp4" class="m-1">demo.mp4</span></summary><video src="${video}" data-canonical-src="${video}" controls="controls" muted="muted" autoplay loop poster="https://example.com/p.png" class="d-block"></video></details>`;

    expect(sanitized(html)).toBe(
      `<details open=""><summary><span>demo.mp4</span></summary><video class="media-video" src="${video}" controls="" preload="metadata" aria-label="demo.mp4"></video></details>`,
    );
  });

  it("loads an image from anywhere else only once asked", () => {
    expect(
      sanitized('<p><img src="https://example.com/logo.png" alt="Logo"></p>'),
    ).toBe(
      '<p><span class="media-placeholder"><span class="media-placeholder-name">Image: Logo</span><span class="media-placeholder-reason">On example.com</span><button type="button" data-load-image="https://example.com/logo.png" data-image-alt="Logo">Load image</button></span></p>',
    );
  });

  it.each([
    ['<img src="http://example.com/old.png" alt="Old">', "Image: Old"],
    ['<video src="https://example.com/demo.mp4"></video>', "Video"],
  ])("shows %s, which cannot load, with Open on GitHub", (html, name) => {
    expect(sanitized(html)).toBe(
      `<span class="media-placeholder"><span class="media-placeholder-name">${name}</span><span class="media-placeholder-reason">Cannot be shown here</span><button type="button" data-open-on-github="">Open on GitHub</button></span>`,
    );
  });

  it("shows attached files as chips, named by their file, that open in the browser", () => {
    const html =
      '<p dir="auto">See <a href="https://github.com/user-attachments/files/17/crash%20report.log">the logs</a> and <a href="https://github.com/user-attachments/assets/3f2a-9c1d">demo</a>.</p>';

    expect(
      [...inserted(html).querySelectorAll("a.attachment")].map((chip) => ({
        href: chip.getAttribute("href"),
        name: chip.textContent,
        icon: chip.querySelector("svg.octicon-file") !== null,
      })),
    ).toEqual([
      {
        href: "https://github.com/user-attachments/files/17/crash%20report.log",
        name: "crash report.log",
        icon: true,
      },
      {
        href: "https://github.com/user-attachments/assets/3f2a-9c1d",
        name: "demo",
        icon: true,
      },
    ]);
  });

  it("resolves links relative to github.com", () => {
    expect(
      sanitized('<p><a href="/acme/api/blob/main/README.md">Readme</a></p>'),
    ).toBe(
      '<p><a href="https://github.com/acme/api/blob/main/README.md">Readme</a></p>',
    );
  });

  describe.each(hostileCorpus)("given %s", (html) => {
    const all = () => [...inserted(html).querySelectorAll("*")];

    it("keeps no element that runs script, loads, embeds or takes input", () => {
      expect(
        all()
          .filter((element) => !isVerdandis(element))
          .map((element) => element.localName)
          .filter((name) =>
            /^(script|style|iframe|frame|frameset|object|embed|form|button|textarea|select|link|meta|base|template|noscript|img|video|audio|source|picture|dialog)$/.test(
              name,
            ),
          ),
      ).toEqual([]);
      expect(
        all().filter(
          (element) =>
            element.localName === "input" &&
            !(
              element.getAttribute("type") === "checkbox" &&
              element.hasAttribute("disabled")
            ),
        ),
      ).toEqual([]);
    });

    it("keeps nothing of SVG but the shapes of icons, and nothing of MathML", () => {
      expect(
        all()
          .filter((element) => element.namespaceURI !== xhtml)
          .map((element) => element.localName)
          .filter((name) => name !== "svg" && name !== "path"),
      ).toEqual([]);
    });

    it("keeps no attribute that runs script, loads something or restyles", () => {
      // Only Verdandi's own elements load from GitHub, or act when clicked.
      const attributes = all().flatMap((element) =>
        [...element.attributes]
          .map(({ name }) => name.toLowerCase())
          .filter(
            (name) =>
              !isVerdandis(element) ||
              !(name === "src" || buttonAttributes.includes(name)),
          ),
      );
      expect(
        attributes.filter(
          (name) =>
            name.startsWith("on") ||
            name === "style" ||
            name === "target" ||
            name === "name" ||
            name.startsWith("data-") ||
            loadingAttributes.includes(name),
        ),
      ).toEqual([]);
    });

    it("never plays a video on its own", () => {
      expect(
        all().filter((element) => element.hasAttribute("autoplay")),
      ).toEqual([]);
    });

    it("keeps only links to https: addresses or within the body", () => {
      const hrefs = all().flatMap((element) => {
        const href = element.getAttribute("href");
        return href === null ? [] : [href];
      });
      expect(hrefs.filter((href) => !/^(https:\/\/|#)/.test(href))).toEqual([]);
    });

    it("keeps no class of the app's own and no ID that could name the app's elements", () => {
      expect(
        all().flatMap((element) =>
          [...element.classList].filter((name) =>
            /^(fixed|inset-0|z-50|bg-background)$/.test(name),
          ),
        ),
      ).toEqual([]);
      expect(
        all()
          .map((element) => element.id)
          .filter((id) => id !== "" && !id.startsWith("user-content-")),
      ).toEqual([]);
    });
  });
});
