import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import { attachmentOf, freshLink, mediaSource } from "./media";

describe("the window's Content Security Policy", () => {
  const meta = new DOMParser()
    .parseFromString(indexHtml, "text/html")
    .querySelector('meta[http-equiv="Content-Security-Policy"]');
  const directives = new Map(
    (meta?.getAttribute("content") ?? "").split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources.sort()];
    }),
  );

  it("loads images only from the app, GitHub's media hosts and avatars, and what the app loaded when asked", () => {
    expect(directives.get("img-src")).toEqual(
      [
        "'self'",
        "data:",
        "blob:",
        "https://avatars.githubusercontent.com",
        "https://private-user-images.githubusercontent.com",
        "https://user-images.githubusercontent.com",
        "https://camo.githubusercontent.com",
      ].sort(),
    );
  });

  it("loads videos only from GitHub's hosts for uploads", () => {
    expect(directives.get("media-src")).toEqual(
      [
        "https://private-user-images.githubusercontent.com",
        "https://user-images.githubusercontent.com",
      ].sort(),
    );
  });

  it("sends no referrer to them", () => {
    expect(
      new DOMParser()
        .parseFromString(indexHtml, "text/html")
        .querySelector('meta[name="referrer"]')
        ?.getAttribute("content"),
    ).toBe("no-referrer");
  });
});

const signed =
  "https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=abc";
const legacy = "https://user-images.githubusercontent.com/1/2-3f2a.png";
const camo =
  "https://camo.githubusercontent.com/8f1a/68747470733a2f2f6578616d706c652e636f6d2f782e706e67";

describe("where an image loads from", () => {
  it.each([
    ["an upload, signed", signed],
    ["a legacy upload", legacy],
    ["a third-party image through Camo", camo],
  ])("loads %s from GitHub's media hosts at once", (_, src) => {
    expect(mediaSource("image", src)).toEqual({ kind: "github", url: src });
  });

  it.each([
    "https://example.com/logo.png",
    "https://camo.githubusercontent.com.evil.example/x.png",
    "https://evil.example/?https://camo.githubusercontent.com/x",
    "https://camo.githubusercontent.com:8443/x.png",
    "https://avatars.githubusercontent.com/u/1",
    "https://raw.githubusercontent.com/acme/api/main/logo.png",
    "https://github.com/user-attachments/assets/3f2a",
  ])("loads %s, from elsewhere, only once asked", (src) => {
    expect(mediaSource("image", src)).toEqual({
      kind: "third-party",
      url: src,
    });
  });

  it("reads an address relative to github.com as one on it", () => {
    expect(mediaSource("image", "/acme/api/raw/main/logo.png")).toEqual({
      kind: "third-party",
      url: "https://github.com/acme/api/raw/main/logo.png",
    });
  });

  it.each([
    "http://camo.githubusercontent.com/x.png",
    "http://example.com/logo.png",
    "https://octo:secret@camo.githubusercontent.com/x.png",
    "https://octo@example.com/logo.png",
    "data:image/png;base64,iVBORw0KGgo=",
    "blob:https://github.com/3f2a",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "https://[bad",
    "",
    " ",
  ])("never loads %j", (src) => {
    expect(mediaSource("image", src)).toEqual({ kind: "none" });
  });
});

describe("where a video loads from", () => {
  it.each([
    ["an upload, signed", signed.replace(".png", ".mp4")],
    ["a legacy upload", legacy.replace(".png", ".mp4")],
  ])("loads %s from GitHub's media hosts", (_, src) => {
    expect(mediaSource("video", src)).toEqual({ kind: "github", url: src });
  });

  it.each([camo, "https://example.com/demo.mp4", "http://example.com/x.mp4"])(
    "never loads %s, as GitHub hosts or proxies no other videos",
    (src) => {
      expect(mediaSource("video", src)).toEqual({ kind: "none" });
    },
  );
});

describe("attachments", () => {
  it.each([
    ["https://github.com/user-attachments/files/17/crash.log", "crash.log"],
    [
      "https://github.com/user-attachments/files/17/crash%20report.txt",
      "crash report.txt",
    ],
    ["https://github.com/acme/api/files/17/crash.log", "crash.log"],
    ["https://github.com/user-attachments/assets/3f2a-9c1d", undefined],
  ])("names %s as an attachment, by its filename", (href, name) => {
    expect(attachmentOf(href)).toEqual({ name });
  });

  it.each([
    "https://github.com/acme/api/blob/main/crash.log",
    "https://github.com/acme/api/pull/3/files",
    "https://github.com/acme/api/issues/3",
    "https://github.com/user-attachments/files/17",
    "https://example.com/user-attachments/files/17/crash.log",
    "http://github.com/user-attachments/files/17/crash.log",
    "#user-content-fn-1",
  ])("takes %s for no attachment", (href) => {
    expect(attachmentOf(href)).toBeUndefined();
  });
});

describe("fresh links to media that failed", () => {
  const signedAs = (signature: string) =>
    `https://private-user-images.githubusercontent.com/1/2-3f2a.png?jwt=${signature}`;
  const withImage = (text: string, signature: string) =>
    `<p dir="auto">${text} <img src="${signedAs(signature)}" alt="Screenshot"></p>`;

  it("finds a failed medium's fresh link in its body read again", () => {
    expect(freshLink(signedAs("a"), withImage("Crash", "b"))).toBe(
      signedAs("b"),
    );
    expect(
      freshLink(
        signedAs("a").replace(".png", ".mp4"),
        `<video src="${signedAs("b&amp;v=2").replace(".png", ".mp4")}" controls></video>`,
      ),
    ).toBe(signedAs("b&v=2").replace(".png", ".mp4"));
  });

  it("finds a link GitHub never signs as it was", () => {
    expect(freshLink(camo, `<p><img src="${camo}" alt="Logo"></p>`)).toBe(camo);
  });

  it("finds none for a medium the body no longer shows", () => {
    expect(freshLink(signedAs("a"), '<p dir="auto">Fixed</p>')).toBeUndefined();
  });
});
