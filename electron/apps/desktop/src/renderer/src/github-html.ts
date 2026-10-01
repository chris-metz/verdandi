import { attachmentOf, mediaSource } from "./media";
import {
  mediaImage,
  mediaPlaceholder,
  mediumName,
  openOnGitHubAttribute,
  ownButton,
  thirdPartyPlaceholder,
} from "./own-elements";

/**
 * Verdandi's own allowlist for the HTML GitHub renders for issue bodies and
 * comments (ADR 0003). That HTML is untrusted. It is parsed into an inert
 * document, where nothing runs or loads, and only what the allowlist names
 * is built anew, element by element, in the document that shows it; it is
 * never turned back into text and parsed again. What it builds runs no
 * script, loads nothing, and reaches no further than its own element: links
 * are only followed where they are clicked, and only as `linkTarget` allows.
 *
 * GitHub's own structures come through as its stylesheet expects them:
 * highlighted code, task lists, alerts, tables, footnotes and `<details>`.
 * What github.com renders in the browser, such as Mermaid diagrams and math,
 * shows as its source with **Open on GitHub**. Emoji GitHub draws as images
 * show as their names.
 *
 * Images and videos load from GitHub's media hosts only, as `mediaSource`
 * says; an image from anywhere else shows as a placeholder that loads it
 * once asked. Images open in the viewer, unless they are in a link, and
 * attached files show as chips.
 */
export function sanitizeGitHubHtml(
  html: string,
  document: Document,
): DocumentFragment {
  const source = new DOMParser().parseFromString(html, "text/html");
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, source.body, document);
  return fragment;
}

const svgNamespace = "http://www.w3.org/2000/svg";
const htmlNamespace = "http://www.w3.org/1999/xhtml";

/**
 * The HTML elements kept, each with the attributes it may keep besides
 * `commonAttributes`.
 */
const allowedElements: Readonly<Record<string, readonly string[]>> = {
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
 * Elements that are dropped with everything in them: those that run script,
 * load or embed something, take input or restyle the page, and GitHub's own
 * controls, which need github.com's script.
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

/** GitHub's classes that Verdandi's stylesheet styles. */
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
 * GitHub's families of classes Verdandi's stylesheet styles: syntax
 * highlighting (`pl-k`, `pl-c1`), the language of highlighted code, and
 * Octicons.
 */
const allowedClassPatterns = [
  /^pl-[a-z]+[0-9]?$/,
  /^highlight-(?:source|text)-[a-z0-9.+_-]+$/,
  /^octicon-[a-z0-9-]+$/,
];

/** How a block rendered in github.com's browser is named. */
const clientRenderedNames: Readonly<Record<string, string>> = {
  mermaid: "Mermaid diagram",
  geojson: "GeoJSON map",
  topojson: "TopoJSON map",
  stl: "STL model",
  math: "Math",
};

/** Appends the allowed content of `parent`'s children to `target`. */
function appendChildren(target: Node, parent: Node, document: Document): void {
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent ?? ""));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      appendElement(target, child as Element, document);
    }
  }
}

/**
 * Appends what an element becomes: itself with its allowed attributes, what
 * Verdandi shows in its place, or only its content, for an element that is
 * not allowed but may hold what is, such as GitHub's custom elements around
 * tables. Elements of other namespaces than HTML's are dropped, except
 * GitHub's Octicons.
 */
function appendElement(target: Node, element: Element, document: Document) {
  if (element.namespaceURI === svgNamespace) {
    if (element.localName === "svg")
      target.appendChild(icon(element, document));
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
    target.appendChild(clientRendered(element, document));
    return;
  }
  switch (name) {
    case "math-renderer":
      target.appendChild(math(element, document));
      return;
    case "img":
      target.appendChild(image(element, document));
      return;
    case "video":
      target.appendChild(video(element, document));
      return;
    case "a": {
      if (wrapsItsImage(element)) {
        appendChildren(target, element, document);
        return;
      }
      const href = safeHref(element.getAttribute("href") ?? "") ?? "";
      const attachment = attachmentOf(href);
      if (attachment) {
        const name = attachment.name ?? element.textContent.trim();
        target.appendChild(attachmentChip(href, name, document));
        return;
      }
      break;
    }
    case "input":
      if (element.getAttribute("type") === "checkbox") {
        target.appendChild(checkbox(element, document));
      }
      return;
  }
  const allowed = allowedElements[name];
  if (!allowed) {
    appendChildren(target, element, document);
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
  appendChildren(copy, element, document);
  target.appendChild(copy);
}

/** An attribute's value as kept, or `undefined` when it is not allowed. */
function allowedValue(attribute: string, value: string): string | undefined {
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
function anchorId(value: string): string | undefined {
  return /^user-content-\S+$/.test(value) ? value : undefined;
}

/**
 * A link's address as kept: a link within the same body, or an `https://`
 * one, with an address relative to github.com resolved against it.
 * Anything else is dropped, so that it cannot be followed.
 */
function safeHref(value: string): string | undefined {
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
function headingAnchor(heading: Element): string | undefined {
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
function icon(svg: Element, document: Document): SVGElement {
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
    if (rule === "evenodd" || rule === "nonzero") {
      shape.setAttribute("fill-rule", rule);
    }
    copy.appendChild(shape);
  }
  return copy;
}

/**
 * A block github.com renders in the browser, such as a Mermaid diagram, as
 * its source, named, with **Open on GitHub** to see it rendered there.
 */
function clientRendered(section: Element, document: Document): HTMLElement {
  const type = section.getAttribute("data-type") ?? "";
  const target = section.querySelector("[data-plain]");
  const source =
    target?.getAttribute("data-plain") ??
    section.querySelector("pre")?.textContent ??
    "";
  return sourceBlock(
    clientRenderedNames[type] ?? type,
    source.replace(/\n+$/, ""),
    document,
  );
}

/**
 * Math, which github.com renders in the browser: in a line, as its TeX
 * source in code; on its own, as a block of it with **Open on GitHub**.
 */
function math(element: Element, document: Document): HTMLElement {
  const source = element.textContent;
  if (element.classList.contains("js-display-math")) {
    return sourceBlock(
      clientRenderedNames.math ?? "Math",
      source.trim(),
      document,
    );
  }
  const code = document.createElement("code");
  code.textContent = source;
  return code;
}

/** Source shown in place of what github.com renders from it. */
function sourceBlock(
  name: string,
  source: string,
  document: Document,
): HTMLElement {
  const block = document.createElement("div");
  block.className = "client-rendered";
  const header = document.createElement("div");
  header.className = "client-rendered-header";
  const title = document.createElement("span");
  title.textContent = name;
  header.append(
    title,
    ownButton(
      { label: "Open on GitHub", attribute: openOnGitHubAttribute },
      document,
    ),
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
 * itself, which Verdandi's viewer shows instead.
 */
function wrapsItsImage(link: Element): boolean {
  const href = link.getAttribute("href") ?? "";
  return (
    mediaSource("image", href).kind === "github" &&
    link.querySelector("img") !== null
  );
}

/**
 * An image: an emoji GitHub draws as one shows as its name, e.g.
 * `:octocat:`. One on GitHub's media hosts loads, at its own size at most,
 * and opens in the viewer unless it is in a link. One from elsewhere loads
 * only once asked, and any other shows as a placeholder.
 */
function image(element: Element, document: Document): Node {
  const alt = element.getAttribute("alt") ?? "";
  if (element.classList.contains("emoji")) return document.createTextNode(alt);
  const source = mediaSource("image", element.getAttribute("src") ?? "");
  switch (source.kind) {
    case "github": {
      const link = element.closest("a[href]");
      const img = mediaImage(document, {
        src: source.url,
        alt,
        inLink: link !== null && !wrapsItsImage(link),
      });
      for (const dimension of ["width", "height"]) {
        const value = element.getAttribute(dimension);
        if (value !== null && /^\d{1,5}$/.test(value)) {
          img.setAttribute(dimension, value);
        }
      }
      return img;
    }
    case "third-party":
      return thirdPartyPlaceholder(document, {
        url: source.url,
        alt,
        reason: `On ${new URL(source.url).host}`,
      });
    case "none":
      return cannotShow(mediumName("Image", alt), document);
  }
}

/**
 * A video on GitHub's media hosts, with controls, which never plays on its
 * own, named by its file as GitHub names it above it; any other as a
 * placeholder.
 */
function video(element: Element, document: Document): Node {
  const source = mediaSource("video", element.getAttribute("src") ?? "");
  const summary = element.closest("details")?.querySelector("summary");
  const name = summary?.textContent.trim() ?? "";
  if (source.kind !== "github") {
    return cannotShow(mediumName("Video", name), document);
  }
  const copy = document.createElement("video");
  copy.className = "media-video";
  copy.setAttribute("src", source.url);
  copy.setAttribute("controls", "");
  copy.setAttribute("preload", "metadata");
  if (name) copy.setAttribute("aria-label", name);
  return copy;
}

/** Where an image or video that cannot load here would show. */
function cannotShow(name: string, document: Document): HTMLElement {
  return mediaPlaceholder(document, {
    name,
    reason: "Cannot be shown here",
    buttons: [{ label: "Open on GitHub", attribute: openOnGitHubAttribute }],
  });
}

/** The shape of GitHub's `file` Octicon. */
const fileIcon =
  "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z";

/**
 * An attached file, as a chip with a file icon and its name, whose link
 * opens it in the browser, where GitHub's session lets the user download it.
 */
function attachmentChip(
  href: string,
  name: string,
  document: Document,
): HTMLAnchorElement {
  const chip = document.createElement("a");
  chip.className = "attachment";
  chip.setAttribute("href", href);
  chip.setAttribute("title", "Opens in the browser");
  const svg = document.createElementNS(svgNamespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("class", "octicon octicon-file");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svgNamespace, "path");
  path.setAttribute("d", fileIcon);
  svg.appendChild(path);
  chip.append(svg, name || "Attachment");
  return chip;
}

/** A task list's checkbox, which only shows whether the task is done. */
function checkbox(element: Element, document: Document): HTMLInputElement {
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
