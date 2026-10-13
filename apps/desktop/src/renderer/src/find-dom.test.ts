import { describe, expect, it } from "vitest";
import { sanitizeGitHubHtml } from "./github-html";
import {
  readFindFields,
  rangeOfTextMatch,
  revealTextDetails,
  revealFindField,
} from "./find-dom";
import { findText } from "./find";

describe("Find in displayed content", () => {
  it("reveals a match inside a horizontally scrolling code block", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-find-field="body"><pre style="overflow-x:auto;overflow-y:auto"><code>long line with target</code></pre></div>';
    const fields = readFindFields(root);
    const field = required(fields[0]);
    const range = required(
      rangeOfTextMatch(fields, required(findText(fields, "target")[0])),
    );
    const pre = required(root.querySelector("pre"));
    field.element.scrollIntoView = () => undefined;
    pre.getBoundingClientRect = () => new DOMRect(20, 100, 200, 100);
    range.getBoundingClientRect = () =>
      new DOMRect(900 - pre.scrollLeft, 120, 60, 20);
    revealFindField(field, range);
    expect(pre.scrollLeft).toBe(740);
  });
  it("searches displayed whitespace while keeping code whitespace and exact DOM ranges", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-find-field="body"><p>first\n  <strong>second</strong>   third</p><pre>first\n  second</pre></div>';
    const fields = readFindFields(root);
    const phrase = findText(fields, "first second third");
    expect(phrase).toHaveLength(1);
    expect(rangeOfTextMatch(fields, required(phrase[0]))?.toString()).toBe(
      "first\n  second   third",
    );
    expect(findText(fields, "first\n  second")).toHaveLength(1);
  });
  it("uses cleaned readable HTML across inline formatting and opens only the selected collapsed path", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-find-scope="issue:91"><div data-find-field="body"></div></div><button>Contract navigation</button>';
    const body = required(root.querySelector("[data-find-field]"));
    body.append(
      sanitizeGitHubHtml(
        '<details><summary>More</summary><p><a href="https://example.com" title="Contract tooltip">Con<strong>tract</strong></a> &amp; <code>contract</code></p><video src="https://private-user-images.githubusercontent.com/1/2.mp4"></video></details><details><summary>Other</summary><p>Other text</p></details><script>contract()</script>',
        document,
      ),
    );
    const fields = readFindFields(root);
    const matches = findText(fields, "contract");
    expect(matches).toHaveLength(2);
    const first = rangeOfTextMatch(fields, required(matches[0]));
    expect(first?.toString()).toBe("Contract");
    const link = body.querySelector("a");
    const video = body.querySelector("video");
    revealTextDetails(required(first));
    expect(
      [...body.querySelectorAll("details")].map((item) => item.open),
    ).toEqual([true, false]);
    expect(body.querySelector("a")).toBe(link);
    expect(body.querySelector("video")).toBe(video);
    expect(findText(fields, "tooltip")).toEqual([]);
    expect(findText(fields, "script")).toEqual([]);
    expect(findText(fields, "MoreContract")).toEqual([]);
  });

  it("counts avatar and overflow text once, including hidden rows, without searching their previews", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-find-scope="row:91" hidden><span data-find-field="author" data-find-text="@octocat"><img alt="@octocat"><span aria-hidden="true">O</span></span><span data-find-field="label:contract" data-find-text="contract">+4</span><span data-find-field="reference" data-find-text="acme/api#91">#91</span></div><div data-find-ignore><span data-find-field="preview">contract</span></div>';
    const fields = readFindFields(root);
    expect(findText(fields, "octocat")).toHaveLength(1);
    expect(findText(fields, "contract")).toHaveLength(1);
    expect(
      rangeOfTextMatch(fields, required(findText(fields, "octocat")[0])),
    ).toBeUndefined();
    expect(
      rangeOfTextMatch(fields, required(findText(fields, "91")[0]))?.toString(),
    ).toBe("91");
  });

  it("finds a date's full tooltip without counting its short form twice", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<time data-find-field="created" data-find-alternative="10/12/2026, 12:00">2d</time>';
    expect(findText(readFindFields(root, "2"), "2")).toHaveLength(1);
    const full = readFindFields(root, "2026");
    expect(findText(full, "2026")).toHaveLength(1);
    expect(full[0]?.text).toBe("10/12/2026, 12:00");
  });
});

function required<T>(value: T | undefined | null): T {
  if (value == null) throw new Error("Expected a field or occurrence");
  return value;
}
