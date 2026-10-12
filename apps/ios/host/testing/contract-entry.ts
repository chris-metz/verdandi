/**
 * The bundle `ContractTests` runs on JavaScriptCore, as
 * `build/contract-core.js`: the app's host, with the core's GitHub in
 * memory (`FakeGitHub`) in place of the app's, so that the test can make
 * every request and see every event, on the Swift types, without a network.
 * Beside the host's own functions, the test calls:
 *
 * - `fakeGitHub(method, argsJSON)`: one of `FakeGitHub`'s methods, its
 *   arguments as a JSON array, e.g. to make GitHub fail or hide something.
 * - `contract()`: every request and event name, as JSON.
 * - `requested()`: the names of the requests made so far, as JSON.
 */
import { eventNames, requestNames } from "@verdandi/core/contract";
import {
  createFakeGitHub,
  type FakeGitHub,
} from "../../../../packages/core/src/testing/fake-github.ts";
import { createHost } from "../host.ts";
import { useNative, type Native } from "../native.ts";
import { installPolyfills } from "../polyfills.ts";

const scope = globalThis as { __native?: Native; __host?: unknown };
if (!scope.__native) throw new Error("The app has not set __native.");
useNative(scope.__native);
installPolyfills();

const github = createFakeGitHub({ login: "octo-reader" });
github.setOrganizations(["acme"]);
// A signed link to an uploaded image, which `renewMediaLinks` renews.
const image =
  '<p><img src="https://private-user-images.githubusercontent.com/1/map.png?jwt=signed"></p>';
github.addRepository(
  "acme/api",
  [
    {
      number: 1,
      title: "Draw the blocking map",
      author: "octo-reader",
      labels: [{ name: "bug", color: "d73a4a" }],
      subIssues: ["acme/api#2", "acme/api#6", "other/lib#5"],
      blockers: ["acme/api#3"],
      metadata: {
        assignees: [{ login: "octo-reader", avatarUrl: "https://avatars/1" }],
        milestone: "Autumn",
        bodyHTML: image,
      },
      comments: [
        { author: "octo-reader", bodyHTML: image },
        { bodyHTML: "<p>From a deleted account.</p>" },
      ],
    },
    {
      number: 2,
      title: "Lay out the cards",
      state: "closed",
      metadata: { stateReason: "completed" },
    },
    { number: 3, title: "Read the relationships", blockers: ["acme/api#4"] },
    // Blocks #3 and is blocked by #1, which #3 blocks: a cycle.
    { number: 4, title: "Follow them both ways", blockers: ["acme/api#1"] },
    { number: 6, title: "Hidden from the account" },
    {
      number: 8,
      title: "Not planned",
      state: "closed",
      metadata: { stateReason: "not-planned" },
    },
  ],
  { suggested: true, organization: true },
);
github.addPullRequest("acme/api", 7);
github.hide("acme/api#6");
github.addRepository("other/lib", [{ number: 5, title: "Elsewhere" }]);
github.addRepository(
  "acme/web",
  [{ number: 1, title: "Archived but readable" }],
  { suggested: true, organization: true, isArchived: true },
);
github.addRepository("acme/docs", [], {
  suggested: true,
  organization: true,
  hasIssuesEnabled: false,
});
github.addRepository("acme/secret", [], {
  suggested: true,
  organization: true,
  issuesDenied: true,
});
github.setSearch("is:open label:bug", {
  matches: ["acme/api#1"],
  pullRequests: 1,
});
github.setSearch("is:open sort:", { rejected: "The search is invalid." });
github.setSearch("repo:nobody/none", {
  rejected: "The listed repositories cannot be searched.",
  unsearchable: true,
});

const requested: string[] = [];
const host = createHost({ access: () => github });
scope.__host = {
  ...host,
  request(id: number, name: string, argsJSON: string) {
    requested.push(name);
    host.request(id, name, argsJSON);
  },
  fakeGitHub(method: string, argsJSON: string) {
    const call = Reflect.get(github, method) as (
      this: FakeGitHub,
      ...args: unknown[]
    ) => unknown;
    return JSON.stringify(
      call.apply(github, JSON.parse(argsJSON) as unknown[]) ?? null,
    );
  },
  contract() {
    return JSON.stringify({ requests: requestNames, events: eventNames });
  },
  requested() {
    return JSON.stringify(requested);
  },
};
