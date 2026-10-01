import { describe, expect, it } from "vitest";
import { parseRepositoryInput } from "./repository-address.ts";

describe("parseRepositoryInput", () => {
  it.each([
    ["acme/api", "acme", "api"],
    ["  acme/api  ", "acme", "api"],
    ["Acme-Corp/my.repo_v2", "Acme-Corp", "my.repo_v2"],
    ["https://github.com/acme/api", "acme", "api"],
    ["http://github.com/acme/api", "acme", "api"],
    ["https://www.github.com/acme/api", "acme", "api"],
    ["github.com/acme/api", "acme", "api"],
    ["https://github.com/acme/api/", "acme", "api"],
    ["https://github.com/acme/api.git", "acme", "api"],
    ["https://github.com/acme/api/issues/12", "acme", "api"],
    ["https://github.com/acme/api?tab=readme", "acme", "api"],
    ["https://github.com/acme/api#readme", "acme", "api"],
  ])("reads %j as a repository", (text, owner, name) => {
    expect(parseRepositoryInput(text)).toEqual({ owner, name });
  });

  it.each([
    "",
    "acme",
    "api",
    "acme/",
    "/api",
    "acme/api/issues",
    "acme api",
    "acme/api extra",
    "-acme/api",
    "acme/..",
    "acme/.",
    "https://gitlab.com/acme/api",
    "https://github.com/acme",
    "https://github.com.evil.example/acme/api",
    "ftp://github.com/acme/api",
  ])("reads %j as no repository", (text) => {
    expect(parseRepositoryInput(text)).toBeUndefined();
  });
});
