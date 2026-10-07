/**
 * What a view's search covers, as far as its `repo:`, `org:` and `user:`
 * qualifiers say; the rest of the search is GitHub's to check. It comes from
 * the search text alone, never from the tracked repositories.
 */
export interface ViewScopeDescription {
  covers:
    /** Every repository the account can read on GitHub, tracked or not. */
    | { kind: "everywhere" }
    /** Only these repositories and owners' repositories, in search order. */
    | { kind: "only"; targets: ViewScopeTarget[] };
  /**
   * Several `repo:` qualifiers stand side by side without `OR`, which
   * advanced search combines with AND, so the search matches nothing.
   */
  warning:
    { kind: "repositories-combined"; repositories: string[] } | undefined;
}

/** A repository, `owner/name`, or an owner whose repositories are searched. */
export type ViewScopeTarget =
  { kind: "repository"; name: string } | { kind: "owner"; login: string };

/**
 * A search as GitHub's advanced search reads it: terms side by side, or
 * joined by `AND`, must all hold; `OR` joins alternatives, and binds less
 * tightly; parentheses group.
 */
type Node =
  | { kind: "term"; target: ViewScopeTarget | undefined }
  | { kind: "and" | "or"; nodes: Node[] };

/** Describes what a search covers, however GitHub will judge the rest of it. */
export function describeViewScope(query: string): ViewScopeDescription {
  const root = parse(tokenize(query));
  const restriction = root && restrictionOf(root);
  return {
    covers: restriction
      ? { kind: "only", targets: distinct(restriction) }
      : { kind: "everywhere" },
    warning: root && combinedRepositories(root),
  };
}

/** Splits a search into terms, keeping quoted text and parentheses whole. */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  for (const [token] of query.matchAll(/[()]|(?:"[^"]*"?|[^\s()"])+/g)) {
    tokens.push(token);
  }
  return tokens;
}

/**
 * Reads the terms as a tree, forgiving what GitHub would reject, such as
 * unbalanced parentheses: what can be read of it still names its scope.
 */
function parse(tokens: string[]): Node | undefined {
  let position = 0;
  function alternatives(): Node | undefined {
    const nodes: Node[] = [];
    for (;;) {
      const node = conjunction();
      if (node) nodes.push(node);
      if (tokens[position] !== "OR") break;
      position++;
    }
    return group("or", nodes);
  }
  function conjunction(): Node | undefined {
    const nodes: Node[] = [];
    for (;;) {
      const token = tokens[position];
      if (token === undefined || token === "OR") break;
      if (token === ")") {
        position++;
        // A stray `)` closes nothing, and ends only a group it closes.
        if (depth > 0) break;
        continue;
      }
      position++;
      if (token === "AND") continue;
      if (token === "(") {
        depth++;
        const inner = alternatives();
        depth--;
        if (inner) nodes.push(inner);
        continue;
      }
      if (token === "NOT") {
        const next = tokens[position];
        if (next !== undefined && next !== "(" && next !== ")") position++;
        nodes.push({ kind: "term", target: undefined });
        continue;
      }
      nodes.push({ kind: "term", target: targetOf(token) });
    }
    return group("and", nodes);
  }
  let depth = 0;
  return alternatives();
}

function group(kind: "and" | "or", nodes: Node[]): Node | undefined {
  return nodes.length > 1 ? { kind, nodes } : nodes[0];
}

/** The repository or owner a term narrows the search to, if it does. */
function targetOf(term: string): ViewScopeTarget | undefined {
  const qualifier = /^(repo|org|user):(.+)$/i.exec(term);
  if (!qualifier?.[1] || !qualifier[2]) return undefined;
  const value = qualifier[2].replace(/^"(.*)"?$/, "$1").replace(/"$/, "");
  if (!value) return undefined;
  return qualifier[1].toLowerCase() === "repo"
    ? { kind: "repository", name: value }
    : { kind: "owner", login: value };
}

/**
 * The repositories and owners a part of the search is limited to, or none
 * when it is not limited: an alternative without a limit lifts it.
 */
function restrictionOf(node: Node): ViewScopeTarget[] | undefined {
  if (node.kind === "term") return node.target && [node.target];
  const parts = node.nodes.map(restrictionOf);
  if (node.kind === "or") {
    return parts.every((part) => part !== undefined) ? parts.flat() : undefined;
  }
  const limited = parts.filter((part) => part !== undefined);
  return limited.length > 0 ? limited.flat() : undefined;
}

/** The repositories a part of the search is limited to, by `repo:` alone. */
function repositoriesOf(node: Node): string[] | undefined {
  const restriction = restrictionOf(node);
  return restriction?.every((target) => target.kind === "repository")
    ? restriction.map((target) => target.name)
    : undefined;
}

/**
 * The repositories of the first conjunction whose parts each limit the
 * search to repositories that no other part allows.
 */
function combinedRepositories(
  node: Node,
): ViewScopeDescription["warning"] | undefined {
  if (node.kind === "term") return undefined;
  if (node.kind === "and") {
    const limits = node.nodes
      .map(repositoriesOf)
      .filter((limit) => limit !== undefined);
    const [first, ...rest] = limits.map(
      (limit) => new Set(limit.map((name) => name.toLowerCase())),
    );
    if (
      first &&
      rest.length > 0 &&
      ![...first].some((name) => rest.every((other) => other.has(name)))
    ) {
      return {
        kind: "repositories-combined",
        repositories: [
          ...new Map(
            limits.flat().map((name) => [name.toLowerCase(), name]),
          ).values(),
        ],
      };
    }
  }
  for (const child of node.nodes) {
    const warning = combinedRepositories(child);
    if (warning) return warning;
  }
  return undefined;
}

/** Each target once, whatever its case, in the order first named. */
function distinct(targets: ViewScopeTarget[]): ViewScopeTarget[] {
  const seen = new Map<string, ViewScopeTarget>();
  for (const target of targets) {
    const key = `${target.kind}:${(target.kind === "repository" ? target.name : target.login).toLowerCase()}`;
    if (!seen.has(key)) seen.set(key, target);
  }
  return [...seen.values()];
}
