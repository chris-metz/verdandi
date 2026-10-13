import { findText, type FindField, type TextMatch } from "./find";

/** A field's text and its original DOM nodes, without rewriting React or rich HTML. */
export interface RenderedFindField extends FindField {
  element: HTMLElement;
  name: string;
  segments: {
    node: Text;
    start: number;
    end: number;
    from: number;
    to: number;
  }[];
}

const ignored =
  'svg, script, style, video, audio, img, button, [aria-hidden="true"], [data-find-ignore]';
const block =
  /^(P|DIV|PRE|BLOCKQUOTE|LI|UL|OL|TABLE|TR|TD|TH|H[1-6]|DETAILS|SUMMARY|BR|HR)$/;

/** Only explicitly owned content participates; tooltips and preview copies never do. */
export function readFindFields(
  root: HTMLElement,
  query = "",
): RenderedFindField[] {
  return [...root.querySelectorAll<HTMLElement>("[data-find-field]")].flatMap(
    (element) => {
      if (element.closest("[data-find-ignore]")) return [];
      const name = element.dataset.findField ?? "";
      const scope =
        element.closest<HTMLElement>("[data-find-scope]")?.dataset.findScope ??
        "page";
      let text = "";
      const segments: RenderedFindField["segments"] = [];
      function boundary() {
        if (text && !text.endsWith("\n")) text += "\n";
      }
      function read(node: Node, preserve = false) {
        if (node instanceof Text) {
          const append = (shown: string, from: number, to: number) => {
            segments.push({
              node,
              start: text.length,
              end: text.length + shown.length,
              from,
              to,
            });
            text += shown;
          };
          if (preserve) append(node.data, 0, node.length);
          else
            for (const match of node.data.matchAll(
              /[\t\n\r\f ]+|[^\t\n\r\f ]+/g,
            )) {
              const value = match[0];
              const whitespace = /^[\t\n\r\f ]/.test(value);
              if (whitespace && (!text || /[\n ]$/.test(text))) continue;
              append(
                whitespace ? " " : value,
                match.index,
                match.index + value.length,
              );
            }
        } else if (node instanceof Element) {
          if (
            node !== element &&
            (node.matches(ignored) || node.hasAttribute("data-find-field"))
          )
            return;
          if (block.test(node.tagName)) boundary();
          // These are the whitespace-preserving elements in github-markdown.css.
          const keepsWhitespace =
            preserve || /^(PRE|CODE|TT)$/.test(node.tagName);
          for (const child of node.childNodes) read(child, keepsWhitespace);
          if (block.test(node.tagName)) boundary();
        }
      }
      read(element);
      const alternative = element.dataset.findAlternative;
      const full =
        element.dataset.findText ??
        (alternative &&
        query &&
        findText([{ key: name, text }], query).length === 0
          ? alternative
          : undefined);
      if (full !== undefined && full !== text) {
        const offset = text ? full.indexOf(text) : -1;
        if (offset < 0) segments.length = 0;
        else
          for (const segment of segments) {
            segment.start += offset;
            segment.end += offset;
          }
        text = full;
      }
      return [
        {
          key: `${scope}/${name}`,
          name,
          text,
          element:
            element.closest<HTMLElement>("[data-find-anchor]") ?? element,
          segments,
        },
      ];
    },
  );
}

/** The actual occurrence, including one spanning several inline formatting nodes. */
export function rangeOfTextMatch(
  fields: readonly RenderedFindField[],
  match: TextMatch,
): Range | undefined {
  const field = fields.find(({ key }) => key === match.field);
  return field && rangeInField(field, match);
}

function rangeInField(
  field: RenderedFindField,
  match: TextMatch,
): Range | undefined {
  const start = field.segments.find(
    (segment) => segment.start <= match.start && segment.end > match.start,
  );
  const end = field.segments.find(
    (segment) => segment.start < match.end && segment.end >= match.end,
  );
  if (!start || !end) return undefined;
  const range = start.node.ownerDocument.createRange();
  range.setStart(start.node, start.from + match.start - start.start);
  range.setEnd(end.node, end.to - (end.end - match.end));
  return range;
}

/** Reveal within nested code/table/map scrollers, then the page, without moving focus. */
export function revealFindField(
  field: RenderedFindField,
  range: Range | undefined,
): void {
  field.element.scrollIntoView({ block: "nearest", inline: "nearest" });
  if (!range) return;
  let element = range.startContainer.parentElement;
  while (element) {
    const style = getComputedStyle(element);
    const pane = element.hasAttribute("data-pane-focus");
    const bounds = element.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    if (/auto|scroll/.test(style.overflowX || style.overflow)) {
      if (rect.left < bounds.left)
        element.scrollLeft += rect.left - bounds.left;
      else if (rect.right > bounds.right)
        element.scrollLeft += rect.right - bounds.right;
    }
    if (pane || /auto|scroll/.test(style.overflowY || style.overflow)) {
      const top = bounds.top + (pane ? 56 : 0);
      if (rect.top < top) element.scrollTop += rect.top - top;
      else if (rect.bottom > bounds.bottom)
        element.scrollTop += rect.bottom - bounds.bottom;
    }
    if (pane) break;
    element = element.parentElement;
  }
}

/** Opening a native details section preserves its contents and the keyboard focus. */
export function revealTextDetails(range: Range): void {
  let element = range.startContainer.parentElement;
  while (element) {
    if (element instanceof HTMLDetailsElement) element.open = true;
    element = element.parentElement;
  }
}

/** Restore newly mounted sections, while respecting later manual toggles. */
export function findDetails(
  root: HTMLElement,
  saved: Readonly<Record<string, boolean>>,
  seen: WeakSet<HTMLDetailsElement>,
): Map<string, HTMLDetailsElement> {
  const details = new Map<string, HTMLDetailsElement>();
  for (const field of root.querySelectorAll<HTMLElement>("[data-find-field]")) {
    const scope =
      field.closest<HTMLElement>("[data-find-scope]")?.dataset.findScope ??
      "page";
    [...field.querySelectorAll<HTMLDetailsElement>("details")].forEach(
      (element, index) => {
        const key = `${scope}/${field.dataset.findField ?? ""}/details:${String(index)}`;
        if (!seen.has(element)) {
          seen.add(element);
          if (key in saved) element.open = saved[key] ?? false;
        }
        details.set(key, element);
      },
    );
  }
  return details;
}

/** Hidden labels, avatars, ellipses and clamped text need the full-text bubble. */
export function needsFindBubble(
  field: RenderedFindField,
  range: Range | undefined,
): boolean {
  if (!range) return true;
  if (field.element.closest("[hidden]")) return false;
  const rect = range.getBoundingClientRect();
  if (!rect.width || !rect.height) return true;
  let element: HTMLElement | null = range.startContainer.parentElement;
  while (element && !element.hasAttribute("data-pane-focus")) {
    const style = getComputedStyle(element);
    if (
      [style.overflow, style.overflowX, style.overflowY].some(
        (value) => value === "hidden" || value === "clip",
      )
    ) {
      const clip = element.getBoundingClientRect();
      if (
        rect.right > clip.right + 1 ||
        rect.bottom > clip.bottom + 1 ||
        rect.left < clip.left - 1
      )
        return true;
    }
    element = element.parentElement;
  }
  return false;
}

/** CSS ranges leave links, media nodes and React's text ownership intact. */
export function highlightFind(
  fields: readonly RenderedFindField[],
  matches: readonly TextMatch[],
  active: TextMatch | undefined,
): void {
  const all = new Highlight();
  const byKey = new Map(fields.map((field) => [field.key, field]));
  for (const match of matches) {
    const field = byKey.get(match.field);
    const range = field && rangeInField(field, match);
    if (range) all.add(range);
  }
  CSS.highlights.set("find-text", all);
  const selected = active && rangeOfTextMatch(fields, active);
  CSS.highlights.set(
    "find-active",
    new Highlight(...(selected ? [selected] : [])),
  );
}

export function clearFindHighlights(): void {
  CSS.highlights.delete("find-text");
  CSS.highlights.delete("find-active");
}
