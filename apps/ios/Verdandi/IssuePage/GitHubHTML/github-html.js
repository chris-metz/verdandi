/*
 * An issue's body or a comment as a body's web view shows it, in the app's
 * own script world, which the page cannot reach: the page itself runs no
 * script, and its policy loads nothing but GitHub's media (ADR 0003).
 *
 * GitHub's HTML is untrusted. As the desktop app's renderer does
 * (`github-html.ts`), it is parsed into an inert document, where nothing
 * runs or loads, and only what the allowlist names is built anew, element
 * by element, in the document that shows it; it is never turned back into
 * text and parsed again. GitHub's own structures come through as the
 * stylesheet expects them: highlighted code, task lists, alerts, tables,
 * footnotes and `<details>`. What github.com renders in the browser, such
 * as Mermaid diagrams and math, shows as its source with Open on GitHub.
 *
 * It follows the body as it shows (`media-loading.ts`): an image or video
 * from GitHub that fails, as its signed link expired, loads again with a
 * fresh link the app asks the core for; an image from elsewhere loads only
 * once its placeholder is tapped, as the app loads it. Taps on links,
 * images and its own buttons go to the app, and so does the body's height
 * as it changes.
 */

/* global window, document, DOMParser, Node, ResizeObserver, CSS, URL, MediaError, Element, HTMLElement, HTMLImageElement, HTMLVideoElement, HTMLButtonElement */

(() => {
  const content = document.getElementById("content");
  const look = document.getElementById("look");
  if (!content || !look) return;

  /** Sends a message to the app, answering with what the app answers. */
  function send(message) {
    return window.webkit.messageHandlers.body.postMessage(message);
  }

  /** Tells the app what went wrong in here, for its log. */
  function report(error) {
    const message =
      error instanceof Error
        ? `${error.message}\n${error.stack ?? ""}`
        : String(error);
    send({ kind: "log", message }).catch(() => undefined);
  }

  // MARK: - The allowlist

  const svgNamespace = "http://www.w3.org/2000/svg";
  const htmlNamespace = "http://www.w3.org/1999/xhtml";

  /**
   * The HTML elements kept, each with the attributes it may keep besides
   * `commonAttributes`.
   */
  const allowedElements = {
    a: ["href", "title", "aria-label"],
    abbr: ["title"],
    b: [],
    bdi: [],
    bdo: [],
    blockquote: [],
    br: [],
    caption: [],
    cite: [],
    code: [],
    col: ["span"],
    colgroup: ["span"],
    dd: [],
    del: [],
    details: ["open"],
    dfn: [],
    div: [],
    dl: [],
    dt: [],
    em: [],
    figcaption: [],
    figure: [],
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
    hr: [],
    i: [],
    ins: [],
    kbd: [],
    li: ["value"],
    mark: [],
    ol: ["start", "reversed"],
    p: [],
    pre: [],
    q: [],
    rp: [],
    rt: [],
    ruby: [],
    s: [],
    samp: [],
    section: [],
    small: [],
    span: [],
    strike: [],
    strong: [],
    sub: [],
    summary: [],
    sup: [],
    table: [],
    tbody: [],
    td: ["align", "colspan", "rowspan"],
    tfoot: [],
    th: ["align", "colspan", "rowspan"],
    thead: [],
    tr: [],
    tt: [],
    u: [],
    ul: [],
    var: [],
    wbr: [],
  };

  /** Attributes every kept element may have. */
  const commonAttributes = ["class", "dir", "id"];

  /**
   * Elements that are dropped with everything in them: those that run
   * script, load or embed something, take input or restyle the page, and
   * GitHub's own controls, which need github.com's script.
   */
  const droppedElements = new Set([
    "applet",
    "area",
    "audio",
    "base",
    "button",
    "canvas",
    "clipboard-copy",
    "datalist",
    "dialog",
    "embed",
    "form",
    "frame",
    "frameset",
    "head",
    "iframe",
    "link",
    "map",
    "meta",
    "noembed",
    "noframes",
    "noscript",
    "object",
    "optgroup",
    "option",
    "portal",
    "script",
    "select",
    "slot",
    "source",
    "style",
    "template",
    "textarea",
    "title",
    "tool-tip",
    "track",
  ]);

  /** GitHub's classes that the stylesheet styles. */
  const allowedClasses = new Set([
    "commit-link",
    "contains-task-list",
    "data-footnote-backref",
    "footnotes",
    "highlight",
    "issue-link",
    "markdown-alert",
    "markdown-alert-caution",
    "markdown-alert-important",
    "markdown-alert-note",
    "markdown-alert-tip",
    "markdown-alert-title",
    "markdown-alert-warning",
    "octicon",
    "sr-only",
    "task-list-item",
    "task-list-item-checkbox",
    "team-mention",
    "user-mention",
  ]);

  /**
   * GitHub's families of classes the stylesheet styles: syntax
   * highlighting (`pl-k`, `pl-c1`), the language of highlighted code, and
   * Octicons.
   */
  const allowedClassPatterns = [
    /^pl-[a-z]+[0-9]?$/,
    /^highlight-(?:source|text)-[a-z0-9.+_-]+$/,
    /^octicon-[a-z0-9-]+$/,
  ];

  /** How a block rendered in github.com's browser is named. */
  const clientRenderedNames = {
    mermaid: "Mermaid diagram",
    geojson: "GeoJSON map",
    topojson: "TopoJSON map",
    stl: "STL model",
    math: "Math",
  };

  /** What the current body was shown with: see `render`. */
  let shown = {
    imageHosts: [],
    videoHosts: [],
    /** Images from elsewhere loaded before, by their address. */
    loaded: {},
  };

  /** The allowed content of GitHub's HTML, built anew in this document. */
  function sanitize(html) {
    const source = new DOMParser().parseFromString(html, "text/html");
    const fragment = document.createDocumentFragment();
    appendChildren(fragment, source.body);
    return fragment;
  }

  /** Appends the allowed content of `parent`'s children to `target`. */
  function appendChildren(target, parent) {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        target.appendChild(document.createTextNode(child.textContent ?? ""));
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        appendElement(target, child);
      }
    }
  }

  /**
   * Appends what an element becomes: itself with its allowed attributes,
   * what the app shows in its place, or only its content, for an element
   * that is not allowed but may hold what is, such as GitHub's custom
   * elements around tables. Elements of other namespaces than HTML's are
   * dropped, except GitHub's Octicons.
   */
  function appendElement(target, element) {
    if (element.namespaceURI === svgNamespace) {
      if (element.localName === "svg") target.appendChild(icon(element));
      return;
    }
    if (element.namespaceURI !== htmlNamespace) return;
    const name = element.localName;
    const classes = element.classList;
    if (
      droppedElements.has(name) ||
      classes.contains("zeroclipboard-container") ||
      classes.contains("js-render-enrichment-loader") ||
      classes.contains("anchor")
    ) {
      return;
    }
    if (classes.contains("js-render-needs-enrichment")) {
      target.appendChild(clientRendered(element));
      return;
    }
    switch (name) {
      case "math-renderer":
        target.appendChild(math(element));
        return;
      case "img":
        target.appendChild(image(element));
        return;
      case "video":
        target.appendChild(video(element));
        return;
      case "a": {
        if (wrapsItsImage(element)) {
          appendChildren(target, element);
          return;
        }
        const href = safeHref(element.getAttribute("href") ?? "") ?? "";
        const attachment = attachmentOf(href);
        if (attachment) {
          const fileName = attachment.name ?? element.textContent.trim();
          target.appendChild(attachmentChip(href, fileName));
          return;
        }
        break;
      }
      case "input":
        if (element.getAttribute("type") === "checkbox") {
          target.appendChild(checkbox(element));
        }
        return;
    }
    const allowed = allowedElements[name];
    if (!allowed) {
      appendChildren(target, element);
      return;
    }
    const copy = document.createElement(name);
    for (const attribute of [...commonAttributes, ...allowed]) {
      const value = element.getAttribute(attribute);
      const kept = value === null ? undefined : allowedValue(attribute, value);
      if (kept !== undefined) copy.setAttribute(attribute, kept);
    }
    if (/^h[1-6]$/.test(name) && !copy.id) {
      const id = headingAnchor(element);
      if (id !== undefined) copy.id = id;
    }
    appendChildren(copy, element);
    target.appendChild(copy);
  }

  /** An attribute's value as kept, or `undefined` when it is not allowed. */
  function allowedValue(attribute, value) {
    switch (attribute) {
      case "class": {
        const kept = value
          .split(/\s+/)
          .filter(
            (name) =>
              allowedClasses.has(name) ||
              allowedClassPatterns.some((pattern) => pattern.test(name)),
          );
        return kept.length > 0 ? kept.join(" ") : undefined;
      }
      case "id":
        // GitHub prefixes the IDs it keeps, which thus never name the app's.
        return anchorId(value);
      case "dir":
        return ["ltr", "rtl", "auto"].includes(value) ? value : undefined;
      case "href":
        return safeHref(value);
      case "align":
        return ["left", "center", "right"].includes(value) ? value : undefined;
      case "start":
      case "value":
      case "span":
      case "colspan":
      case "rowspan":
        return /^\d{1,4}$/.test(value) ? value : undefined;
      case "open":
      case "reversed":
        return "";
      default:
        // Plain text, e.g. a title.
        return value;
    }
  }

  /** An element ID GitHub made for its anchors, or `undefined`. */
  function anchorId(value) {
    return /^user-content-\S+$/.test(value) ? value : undefined;
  }

  /**
   * A link's address as kept: a link within the same body, or an
   * `https://` one, with an address relative to github.com resolved
   * against it. Anything else is dropped, so that it cannot be followed.
   */
  function safeHref(value) {
    const href = value.trim();
    if (href.startsWith("#")) return href;
    try {
      const url = new URL(href, "https://github.com/");
      return url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * The ID of a heading's anchor, which GitHub puts in a link beside the
   * heading, or in it, rather than on it.
   */
  function headingAnchor(heading) {
    const parent = heading.parentElement;
    const scope = parent?.classList.contains("markdown-heading")
      ? parent
      : heading;
    const anchor = [...scope.children].find((child) =>
      child.classList.contains("anchor"),
    );
    return anchor ? anchorId(anchor.id) : undefined;
  }

  /** An Octicon, with nothing but its shape. */
  function icon(svg) {
    const copy = document.createElementNS(svgNamespace, "svg");
    const numbers = /^[\d\s.-]+$/;
    for (const attribute of ["viewBox", "width", "height"]) {
      const value = svg.getAttribute(attribute);
      if (value !== null && numbers.test(value))
        copy.setAttribute(attribute, value);
    }
    const classes = allowedValue("class", svg.getAttribute("class") ?? "");
    if (classes !== undefined) copy.setAttribute("class", classes);
    copy.setAttribute("aria-hidden", "true");
    for (const path of svg.children) {
      const d = path.getAttribute("d");
      if (
        path.namespaceURI !== svgNamespace ||
        path.localName !== "path" ||
        d === null ||
        !/^[\d\s.,+MmZzLlHhVvCcSsQqTtAa-]*$/.test(d)
      ) {
        continue;
      }
      const shape = document.createElementNS(svgNamespace, "path");
      shape.setAttribute("d", d);
      const rule = path.getAttribute("fill-rule");
      if (rule === "evenodd" || rule === "nonzero")
        shape.setAttribute("fill-rule", rule);
      copy.appendChild(shape);
    }
    return copy;
  }

  /**
   * A block github.com renders in the browser, such as a Mermaid diagram,
   * as its source, named, with Open on GitHub to see it rendered there.
   */
  function clientRendered(section) {
    const type = section.getAttribute("data-type") ?? "";
    const target = section.querySelector("[data-plain]");
    const source =
      target?.getAttribute("data-plain") ??
      section.querySelector("pre")?.textContent ??
      "";
    return sourceBlock(
      clientRenderedNames[type] ?? type,
      source.replace(/\n+$/, ""),
    );
  }

  /**
   * Math, which github.com renders in the browser: in a line, as its TeX
   * source in code; on its own, as a block of it with Open on GitHub.
   */
  function math(element) {
    const source = element.textContent;
    if (element.classList.contains("js-display-math")) {
      return sourceBlock(clientRenderedNames.math, source.trim());
    }
    const code = document.createElement("code");
    code.textContent = source;
    return code;
  }

  /** Source shown in place of what github.com renders from it. */
  function sourceBlock(name, source) {
    const block = document.createElement("div");
    block.className = "client-rendered";
    const header = document.createElement("div");
    header.className = "client-rendered-header";
    const title = document.createElement("span");
    title.textContent = name;
    header.append(
      title,
      ownButton({ label: "Open on GitHub", attribute: "data-open-on-github" }),
    );
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = source;
    pre.appendChild(code);
    block.append(header, pre);
    return block;
  }

  /**
   * Whether a link is the one GitHub puts around an image, to the image
   * itself, which the app's viewer shows instead.
   */
  function wrapsItsImage(link) {
    const href = link.getAttribute("href") ?? "";
    return (
      mediaSource("image", href).kind === "github" &&
      link.querySelector("img") !== null
    );
  }

  /**
   * An image: an emoji GitHub draws as one shows as its name, e.g.
   * `:octocat:`. One on GitHub's media hosts loads, at its own size at
   * most, and opens in the viewer unless it is in a link. One from
   * elsewhere loads only once asked, and any other shows as a placeholder.
   */
  function image(element) {
    const alt = element.getAttribute("alt") ?? "";
    if (element.classList.contains("emoji"))
      return document.createTextNode(alt);
    const src = element.getAttribute("src") ?? "";
    const source = mediaSource("image", src);
    const link = element.closest("a[href]");
    const inLink = link !== null && !wrapsItsImage(link);
    switch (source.kind) {
      case "github": {
        const img = mediaImage({ src: source.url, alt, inLink });
        for (const dimension of ["width", "height"]) {
          const value = element.getAttribute(dimension);
          if (value !== null && /^\d{1,5}$/.test(value))
            img.setAttribute(dimension, value);
        }
        return img;
      }
      case "third-party": {
        const loaded = shown.loaded[source.url];
        if (loaded)
          return mediaImage({ src: loaded, alt, inLink, source: source.url });
        return thirdPartyPlaceholder({ url: source.url, alt });
      }
      default:
        return cannotShow(mediumName("Image", alt));
    }
  }

  /**
   * A video on GitHub's media hosts, with controls, which never plays on
   * its own, named by its file as GitHub names it above it; any other as a
   * placeholder.
   */
  function video(element) {
    const source = mediaSource("video", element.getAttribute("src") ?? "");
    const summary = element.closest("details")?.querySelector("summary");
    const name = summary?.textContent.trim() ?? "";
    if (source.kind !== "github") return cannotShow(mediumName("Video", name));
    const copy = document.createElement("video");
    copy.className = "media-video";
    copy.setAttribute("src", source.url);
    copy.setAttribute("controls", "");
    copy.setAttribute("playsinline", "");
    copy.setAttribute("preload", "metadata");
    if (name) copy.setAttribute("aria-label", name);
    return copy;
  }

  /** Where an image or video that cannot load here would show. */
  function cannotShow(name) {
    return mediaPlaceholder({
      name,
      reason: "Cannot be shown here",
      buttons: [{ label: "Open on GitHub", attribute: "data-open-on-github" }],
    });
  }

  /** The shape of GitHub's `file` Octicon. */
  const fileIcon =
    "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z";

  /** The shape of GitHub's `image` Octicon. */
  const imageIcon =
    "M16 13.25A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75C0 1.784.784 1 1.75 1h12.5c.966 0 1.75.784 1.75 1.75ZM1.75 2.5a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h.94l.03-.03 6.077-6.078a1.75 1.75 0 0 1 2.412-.06L14.5 10.31V2.75a.25.25 0 0 0-.25-.25Zm12.5 11a.25.25 0 0 0 .25-.25v-.917l-4.298-3.889a.25.25 0 0 0-.344.009L4.81 13.5ZM7 6a2 2 0 1 1-3.999.001A2 2 0 0 1 7 6ZM5.5 6a.5.5 0 1 0-1 0 .5.5 0 0 0 1 0Z";

  /** An Octicon of the app's own, by its shape. */
  function octicon(shape, name) {
    const svg = document.createElementNS(svgNamespace, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("class", `octicon octicon-${name}`);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svgNamespace, "path");
    path.setAttribute("d", shape);
    svg.appendChild(path);
    return svg;
  }

  /**
   * An attached file, as a chip with a file icon and its name, whose link
   * opens it in the browser, where GitHub's session lets the user
   * download it.
   */
  function attachmentChip(href, name) {
    const chip = document.createElement("a");
    chip.className = "attachment";
    chip.setAttribute("href", href);
    chip.append(octicon(fileIcon, "file"), name || "Attachment");
    return chip;
  }

  /** A task list's checkbox, which only shows whether the task is done. */
  function checkbox(element) {
    const box = document.createElement("input");
    box.setAttribute("type", "checkbox");
    const classes = allowedValue("class", element.getAttribute("class") ?? "");
    if (classes !== undefined) box.setAttribute("class", classes);
    box.setAttribute("disabled", "");
    if (element.hasAttribute("checked")) box.setAttribute("checked", "");
    const label = element.getAttribute("aria-label");
    if (label !== null) box.setAttribute("aria-label", label);
    return box;
  }

  // MARK: - Where media load from

  /**
   * Where an image or video loads from, by its `src` (`media.ts`): one of
   * GitHub's media hosts, at once; another `https://` address, for an
   * image, only once the user asks; or nowhere.
   */
  function mediaSource(kind, src) {
    const trimmed = src.trim();
    if (!trimmed) return { kind: "none" };
    let url;
    try {
      url = new URL(trimmed, "https://github.com/");
    } catch {
      return { kind: "none" };
    }
    if (url.protocol !== "https:" || url.username || url.password)
      return { kind: "none" };
    const hosts = kind === "image" ? shown.imageHosts : shown.videoHosts;
    if (hosts.includes(url.host)) return { kind: "github", url: url.href };
    return kind === "image"
      ? { kind: "third-party", url: url.href }
      : { kind: "none" };
  }

  /**
   * Where GitHub keeps attached files on github.com: `/user-attachments/
   * files/<n>/<name>` and, earlier, `/<owner>/<repo>/files/<n>/<name>`,
   * whose filename is known; and `/user-attachments/assets/<uuid>` for an
   * upload linked to rather than shown, whose is not.
   */
  const attachmentPaths = [
    /^\/user-attachments\/files\/\d+\/([^/]+)$/,
    /^\/[\w.-]+\/[\w.-]+\/files\/\d+\/([^/]+)$/,
    /^\/user-attachments\/assets\/[\w-]+$/,
  ];

  /** The file a link in a body leads to, by its `href`, if it is one. */
  function attachmentOf(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return undefined;
    }
    if (url.protocol !== "https:" || url.host !== "github.com")
      return undefined;
    for (const path of attachmentPaths) {
      const match = path.exec(url.pathname);
      if (!match) continue;
      const [, name] = match;
      if (name === undefined) return { name: undefined };
      try {
        return { name: decodeURIComponent(name) };
      } catch {
        return { name };
      }
    }
    return undefined;
  }

  /**
   * A link to an image or video without the signature GitHub gives it,
   * which stays the same however often it is signed anew; any other link
   * as it is.
   */
  function unsignedLink(link) {
    try {
      const url = new URL(link);
      return url.host === "private-user-images.githubusercontent.com"
        ? url.origin + url.pathname
        : link;
    } catch {
      return link;
    }
  }

  /**
   * The link to an image or video that failed to load in its body's HTML
   * as read again: signed anew, if GitHub signs it, or as it was; none
   * once the body no longer shows it.
   */
  function freshLink(failed, html) {
    const address = unsignedLink(failed);
    const source = new DOMParser().parseFromString(html, "text/html");
    for (const medium of source.querySelectorAll("img[src], video[src]")) {
      let url;
      try {
        url = new URL(
          (medium.getAttribute("src") ?? "").trim(),
          "https://github.com/",
        ).href;
      } catch {
        continue;
      }
      if (unsignedLink(url) === address) return url;
    }
    return undefined;
  }

  // MARK: - The app's own elements

  /** One of the app's own buttons, marked by its attribute to act on. */
  function ownButton({ label, attribute, value = "" }) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute(attribute, value);
    button.textContent = label;
    return button;
  }

  /**
   * An image the app loads, which opens in the viewer unless it is in a
   * link, which a tap follows instead. One loaded from elsewhere keeps its
   * address in `data-source`.
   */
  function mediaImage({ src, alt, inLink, source }) {
    const img = document.createElement("img");
    img.className = "media-image";
    img.setAttribute("src", src);
    img.setAttribute("alt", alt);
    if (source) img.dataset.source = source;
    if (!inLink) img.setAttribute("role", "button");
    return img;
  }

  /** An image or video named by its kind and description, e.g. `Image: Logo`. */
  function mediumName(kind, description) {
    return description && description.toLowerCase() !== kind.toLowerCase()
      ? `${kind}: ${description}`
      : kind;
  }

  /**
   * Where an image or video would show, named, with why it does not, and
   * buttons to do something about it.
   */
  function mediaPlaceholder({ name, reason, buttons }) {
    const placeholder = document.createElement("span");
    placeholder.className = "media-placeholder";
    const text = document.createElement("span");
    text.className = "media-placeholder-text";
    const title = document.createElement("span");
    title.className = "media-placeholder-name";
    title.textContent = name;
    const why = document.createElement("span");
    why.className = "media-placeholder-reason";
    why.textContent = reason;
    text.append(title, why);
    const actions = document.createElement("span");
    actions.className = "media-placeholder-actions";
    actions.append(...buttons.map((button) => ownButton(button)));
    placeholder.append(octicon(imageIcon, "image"), text, actions);
    return placeholder;
  }

  /**
   * The placeholder of an image from elsewhere than GitHub's media hosts,
   * which names its host, and loads it once tapped: a button as a whole,
   * so that a finger finds it.
   */
  function thirdPartyPlaceholder({ url, alt, reason }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "media-placeholder media-placeholder-load";
    button.dataset.loadImage = url;
    button.dataset.imageAlt = alt;
    const text = document.createElement("span");
    text.className = "media-placeholder-text";
    if (alt && alt.toLowerCase() !== "image") {
      const name = document.createElement("span");
      name.className = "media-placeholder-name";
      name.textContent = alt;
      text.append(name);
    }
    const action = document.createElement("span");
    action.className = "media-placeholder-action";
    action.textContent = `Load image from ${hostOf(url)}`;
    text.append(action);
    if (reason) {
      const why = document.createElement("span");
      why.className = "media-placeholder-reason";
      why.textContent = reason;
      text.append(why);
    }
    button.append(octicon(imageIcon, "image"), text);
    return button;
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return "elsewhere";
    }
  }

  // MARK: - Following the body as it shows

  /** Whether the current body is still shown, for answers that come late. */
  let generation = 0;

  /**
   * A medium that fails within this long, in milliseconds, of loading once
   * more with a fresh link shows as a placeholder: fresh links did not
   * help. One that fails later, e.g. a video played on after its link
   * expired again, gets a fresh link again.
   */
  const silentRetryEvery = 60 * 1000;

  const openOnGitHub = {
    label: "Open on GitHub",
    attribute: "data-open-on-github",
  };

  /** When each medium last loaded once more with a fresh link. */
  let retriedAt = new WeakMap();
  /** Where each video was, and whether it played, when it failed. */
  let positions = new WeakMap();
  /** The placeholder each medium that failed shows as. */
  let placeholders = new WeakMap();
  /** The medium each placeholder stands for. */
  let media = new WeakMap();
  /** The media waiting for the body to be read again. */
  let waiting = new Set();
  let renewing = false;

  function isMedium(element) {
    return (
      (element instanceof HTMLImageElement ||
        element instanceof HTMLVideoElement) &&
      element.matches(".media-image, .media-video")
    );
  }

  /**
   * An image or video that failed: one from GitHub's media hosts has the
   * body read again for a fresh link, unless that did not help a minute
   * ago; any other shows as a placeholder.
   */
  function onError(event) {
    const medium = event.target;
    if (!isMedium(medium)) return;
    const kind = medium instanceof HTMLImageElement ? "image" : "video";
    // An image loaded from elsewhere has no link GitHub could renew.
    if (mediaSource(kind, medium.getAttribute("src") ?? "").kind !== "github") {
      fail(medium, "Could not be shown", [openOnGitHub]);
      return;
    }
    if (medium instanceof HTMLVideoElement) {
      positions.set(medium, {
        time: medium.currentTime,
        playing: !medium.paused,
      });
    }
    const retried = retriedAt.get(medium);
    if (retried !== undefined && Date.now() - retried < silentRetryEvery) {
      fail(medium, failure(medium));
      return;
    }
    renewThenLoad(medium);
  }

  /** Why a medium failed to load with a fresh link. */
  function failure(medium) {
    return medium instanceof HTMLVideoElement &&
      medium.error?.code === MediaError.MEDIA_ERR_DECODE
      ? "Could not be played"
      : "Could not be loaded";
  }

  /**
   * Has the body read again, with every medium waiting for it, then loads
   * each once more with its fresh link.
   */
  function renewThenLoad(medium) {
    retriedAt.set(medium, Date.now());
    waiting.add(medium);
    if (renewing) return;
    renewing = true;
    const asked = generation;
    send({ kind: "renew" })
      .catch(() => ({ status: "failed", reason: "Could not be read again" }))
      .then((renewed) => {
        if (asked !== generation) return;
        renewing = false;
        const those = [...waiting];
        waiting.clear();
        for (const one of those) {
          if (renewed?.status !== "renewed") {
            fail(one, renewed?.reason ?? "Could not be read again");
            continue;
          }
          const url = freshLink(one.getAttribute("src") ?? "", renewed.html);
          if (url === undefined) fail(one, "No longer in the body");
          else load(one, url);
        }
      })
      .catch(report);
  }

  /** Loads a medium once more, where it showed, going on where it was. */
  function load(medium, url) {
    const placeholder = placeholders.get(medium);
    if (placeholder) placeholder.replaceWith(medium);
    placeholders.delete(medium);
    const position =
      medium instanceof HTMLVideoElement ? positions.get(medium) : undefined;
    if (medium instanceof HTMLVideoElement && position) {
      medium.addEventListener(
        "loadedmetadata",
        () => {
          medium.currentTime = position.time;
          if (position.playing) medium.play().catch(() => undefined);
        },
        { once: true },
      );
    }
    medium.setAttribute("src", url);
  }

  /** Shows a placeholder where a medium was, saying why it failed. */
  function fail(
    medium,
    reason,
    buttons = [{ label: "Retry", attribute: "data-retry-media" }, openOnGitHub],
  ) {
    const name =
      medium instanceof HTMLImageElement
        ? mediumName("Image", medium.alt)
        : mediumName("Video", medium.getAttribute("aria-label") ?? "");
    const placeholder = mediaPlaceholder({ name, reason, buttons });
    (placeholders.get(medium) ?? medium).replaceWith(placeholder);
    placeholders.set(medium, placeholder);
    media.set(placeholder, medium);
  }

  /** Keeps an image at its own size at most, once it has loaded. */
  function onLoad(event) {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || image.naturalWidth === 0)
      return;
    const width = Number(image.getAttribute("width") ?? 0);
    const height = Number(image.getAttribute("height") ?? 0);
    if (width > image.naturalWidth || height > image.naturalHeight) {
      image.removeAttribute("width");
      image.removeAttribute("height");
    }
  }

  /**
   * Loads an image from elsewhere in place of its placeholder, as the app
   * loads it once asked, or says why it could not.
   */
  function loadThirdParty(button) {
    if (button.dataset.state === "loading") return;
    const url = button.dataset.loadImage ?? "";
    const alt = button.dataset.imageAlt ?? "";
    button.dataset.state = "loading";
    const action = button.querySelector(".media-placeholder-action");
    if (action) action.textContent = `Loading image from ${hostOf(url)}…`;
    const asked = generation;
    send({ kind: "loadImage", url })
      .catch(() => ({ status: "failed", reason: "Could not be loaded" }))
      .then((loaded) => {
        if (asked !== generation || !button.isConnected) return;
        if (loaded?.status === "loaded") {
          shown.loaded[url] = loaded.url;
          button.replaceWith(
            mediaImage({
              src: loaded.url,
              alt,
              inLink: button.closest("a") !== null,
              source: url,
            }),
          );
        } else {
          button.replaceWith(
            thirdPartyPlaceholder({
              url,
              alt,
              reason: loaded?.reason ?? "Could not be loaded",
            }),
          );
        }
      })
      .catch(report);
  }

  // MARK: - Taps

  /** Whether an image opens in the viewer when tapped. */
  const viewableImage = 'img.media-image[role="button"]';

  /**
   * Follows a tap in the body: on the app's own buttons, an image, or a
   * link, which the web view never follows itself. A link within the body
   * scrolls the page to what it names; any other goes to the app, which
   * opens an issue in the app and anything else in the browser, and
   * answers once it did.
   */
  function onClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const retry = target.closest("[data-retry-media]");
    const loadImage = target.closest("[data-load-image]");
    const onGitHub = target.closest("[data-open-on-github]");
    if (retry instanceof HTMLButtonElement) {
      event.preventDefault();
      const placeholder = retry.closest(".media-placeholder");
      const medium = placeholder && media.get(placeholder);
      if (!medium || retry.getAttribute("aria-disabled") === "true") return;
      retry.setAttribute("aria-disabled", "true");
      retry.textContent = "Retrying…";
      renewThenLoad(medium);
      return;
    }
    if (loadImage instanceof HTMLButtonElement) {
      event.preventDefault();
      loadThirdParty(loadImage);
      return;
    }
    if (onGitHub) {
      event.preventDefault();
      send({ kind: "openOnGitHub" }).catch(report);
      return;
    }
    const image = target.closest(viewableImage);
    if (image instanceof HTMLImageElement) {
      event.preventDefault();
      view(image);
      return;
    }
    const anchor = target.closest("a");
    if (!anchor || !content.contains(anchor)) return;
    event.preventDefault();
    follow(anchor);
  }

  function follow(anchor) {
    const href = anchor.getAttribute("href") ?? "";
    if (href.startsWith("#")) {
      scrollToAnchor(href.slice(1));
      return;
    }
    if (!href || anchor.getAttribute("aria-busy") === "true") return;
    // The link shows it is being looked up, until the app answers.
    anchor.setAttribute("aria-busy", "true");
    send({ kind: "link", href })
      .catch(report)
      .finally(() => {
        anchor.removeAttribute("aria-busy");
      });
  }

  /**
   * Has the app scroll the page to what a link within the body names, such
   * as a footnote: GitHub prefixes the IDs it keeps, but not always the
   * links to them.
   */
  function scrollToAnchor(fragment) {
    let id = fragment;
    try {
      id = decodeURIComponent(fragment);
    } catch {
      // Not percent-encoded after all.
    }
    const target = [id, `user-content-${id}`]
      .map((candidate) =>
        content.querySelector(`[id="${CSS.escape(candidate)}"]`),
      )
      .find((found) => found !== null);
    if (!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY;
    send({ kind: "scrollTo", top }).catch(report);
  }

  /** Has the app show an image full screen, from where it is. */
  function view(image) {
    const rect = image.getBoundingClientRect();
    send({
      kind: "viewImage",
      src: image.currentSrc || image.src,
      alt: image.alt,
      x: rect.left + window.scrollX,
      y: rect.top + window.scrollY,
      width: rect.width,
      height: rect.height,
    }).catch(report);
  }

  // MARK: - Height and details

  let reportedHeight = -1;

  /** Tells the app the body's height, whenever it changes. */
  function reportHeight() {
    const height = Math.ceil(content.getBoundingClientRect().height);
    if (height === reportedHeight) return;
    reportedHeight = height;
    send({ kind: "height", height }).catch(report);
  }

  /** Tells the app which `<details>` are open, to open them again. */
  function onToggle(event) {
    if (
      !(event.target instanceof HTMLElement) ||
      event.target.localName !== "details"
    )
      return;
    const open = [...content.querySelectorAll("details")]
      .map((details, index) => (details.open ? index : -1))
      .filter((index) => index >= 0);
    send({ kind: "details", open }).catch(report);
  }

  // Neither error, load nor toggle bubbles, so the body catches them on
  // their way down.
  content.addEventListener("error", onError, true);
  content.addEventListener("load", onLoad, true);
  content.addEventListener("toggle", onToggle, true);
  content.addEventListener("click", onClick);
  new ResizeObserver(reportHeight).observe(content);

  // MARK: - What the app asks

  /** Forgets the body shown, and what was waiting for it. */
  function forget() {
    generation += 1;
    retriedAt = new WeakMap();
    positions = new WeakMap();
    placeholders = new WeakMap();
    media = new WeakMap();
    waiting = new Set();
    renewing = false;
  }

  window.verdandi = {
    /**
     * Shows a body: GitHub's HTML, sanitized, in the theme's look, with
     * GitHub's media hosts as the app names them, the images from
     * elsewhere the user loaded before, and the `<details>` they opened.
     */
    render(html, options) {
      try {
        forget();
        look.textContent = options.look ?? "";
        shown = {
          imageHosts: options.imageHosts ?? [],
          videoHosts: options.videoHosts ?? [],
          loaded: { ...(options.loaded ?? {}) },
        };
        content.replaceChildren(sanitize(html));
        const details = [...content.querySelectorAll("details")];
        for (const index of options.openDetails ?? []) {
          if (details[index]) details[index].open = true;
        }
        if (options.loadImages) {
          for (const button of content.querySelectorAll("[data-load-image]")) {
            loadThirdParty(button);
          }
        }
        reportedHeight = -1;
        reportHeight();
      } catch (error) {
        report(error);
      }
    },

    /** Shows the body in another look: the theme's colours, the text size. */
    restyle(css) {
      look.textContent = css;
      reportHeight();
    },

    /** Shows nothing, as the web view waits to show another body. */
    clear() {
      forget();
      content.replaceChildren();
      reportedHeight = -1;
    },
  };

  send({ kind: "ready" }).catch(report);
})();
