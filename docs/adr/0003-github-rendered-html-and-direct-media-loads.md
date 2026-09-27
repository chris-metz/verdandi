# Render GitHub's issue HTML and let the renderer load its media directly

Issue bodies and comments are displayed from the HTML GitHub renders for them (GraphQL `bodyHTML`), not from the raw Markdown. That HTML already resolves issue and pull request references and mentions, converts emoji, highlights code, proxies third-party images through Camo, and replaces uploaded images and videos, including those from private repositories, with signed links that load without credentials for about five minutes. The sandboxed renderer loads those media links itself, and only from GitHub's media hosts (`private-user-images`, `camo` and legacy `user-images` on `githubusercontent.com`). This is the one place where the renderer fetches anything that does not come through the core. It still never holds a GitHub token, and it never contacts a host named in issue content. Chromium's ordinary HTTP cache is accepted, so viewed images from private repositories may remain in the machine-local app-data directory from [ADR 0002](0002-private-user-data-outside-config-dir.md), even though issue data itself is only kept in memory.

## Considered Options

- **Render the raw Markdown locally:** it would have to rebuild GitHub's reference resolution, emoji and highlighting, and it gets no Camo links. Private media would then only be reachable by fetching `github.com/user-attachments` URLs with gh's token, which is undocumented and reportedly fails with fine-grained tokens.
- **Have the core fetch media and serve it through a custom scheme:** this is robust against expiring links and keeps media off disk. It needs its own byte fetching, memory limits and video range handling, which is too much for the MVP.

## Consequences

The HTML is treated as untrusted and passes through Verdandi's own allowlist and stylesheet before display. When a media load fails, the issue's HTML is fetched again once to get fresh links before a placeholder is shown. The signed-link host and its lifetime are observed behavior that GitHub does not document; if it changes, images fall back to placeholders with **Open on GitHub**. The evidence is in [GitHub issue images and attachments](../research/github-issue-media.md).

Decided in [Decide how private-repository images and attachments are displayed](https://github.com/chris-metz/verdandi/issues/13).
