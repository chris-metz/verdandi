import { repositoryKey } from "../repository-address.ts";
import type { CheckoutJob } from "./port.ts";

/**
 * The script that reads the checkouts on a machine, for `bash -s` on its
 * standard input: on this machine, or through `ssh` on a host, whose own
 * shell may not be bash. The job comes first, as variables, so that nothing
 * in it passes through any shell's command line. It runs on bash 3.2, as
 * macOS has.
 */
export function checkoutScript(job: CheckoutJob): string {
  return [
    `mode=${job.update ? "update" : "check"}`,
    `folders=(${job.folders.map(quoted).join(" ")})`,
    `repositories=(${job.repositories
      .map((repository) => quoted(repositoryKey(repository)))
      .join(" ")})`,
    `branches=(${job.mainBranches.map(quoted).join(" ")})`,
    `switch_path=${quoted(job.switchTo?.path ?? "")}`,
    `switch_branch=${quoted(job.switchTo?.branch ?? "")}`,
    ...(job.programFolders?.length
      ? [`PATH=${quoted(job.programFolders.join(":"))}:"$PATH"`]
      : []),
    body,
  ].join("\n");
}

/** A value in single quotes, as bash takes it literally. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Bash as written: the text as it stands, where `$\{` stands for bash's
 * `${`, which a template literal would take for its own.
 */
function bash(text: TemplateStringsArray): string {
  return text.raw.join("").replaceAll("$\\{", "${");
}

/**
 * Prints one tab-separated record per line, which the adapter reads:
 *
 * - `G group owner/name ok|failed message`: a checkout group, whether
 *   fetching worked, and git's message when it did not.
 * - `B group branch upstream track`: a branch of the group, the ref it
 *   tracks, and how far ahead and behind it is, as git puts it.
 * - `C group path branch changed own`: a checkout of the group, the branch
 *   checked out, how many files changed, and 1 for the clone's own.
 * - `S ok|refused message`: whether the clone switched, as asked.
 * - `E message`: nothing could be read, e.g. as git is missing.
 */
const body = bash`
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o IdentityAgent=none -o ConnectTimeout=10'
export GIT_HTTP_LOW_SPEED_LIMIT=1000 GIT_HTTP_LOW_SPEED_TIME=30
export LC_ALL=C

if ! command -v git >/dev/null 2>&1; then
  printf 'E\tgit is not installed.\n'
  exit 0
fi

# A folder as its user names it: ~ for the home folder.
home_real=$(cd "$HOME" 2>/dev/null && pwd -P)
expanded() {
  case $1 in
    '~') printf '%s\n' "$HOME" ;;
    '~/'*) printf '%s\n' "$HOME/$\{1#\~/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}
shown() {
  local home
  for home in "$HOME" "$home_real"; do
    [ -n "$home" ] || continue
    case $1 in
      "$home") printf '~\n'; return ;;
      "$home"/*) printf '~%s\n' "$\{1#"$home"}"; return ;;
    esac
  done
  printf '%s\n' "$1"
}
# Text on one line, without tabs.
flat() { tr '\t\r\n' '   ' | sed 's/  */ /g; s/^ //; s/ $//'; }
# The files changed in a checkout, new ones included, a line each, taking
# no lock while an editor or an agent works there.
changes() { git --no-optional-locks -C "$1" status --porcelain 2>/dev/null; }

# The tracked repository a remote's URL names on github.com, as owner/name
# in lower case, in any of the forms git accepts.
url_pattern='^((https?|ssh|git)://([^@/]+@)?|[^@/:]+@)github\.com(:[0-9]+)?[:/]([^/]+/[^/]+)$'
repository_of() {
  local url
  url=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  url=$\{url%/}
  url=$\{url%.git}
  [[ $url =~ $url_pattern ]] || return 1
  printf '%s\n' "$\{BASH_REMATCH[5]}"
}
tracked() {
  local repository
  for repository in "$\{repositories[@]}"; do
    [ "$repository" = "$1" ] && return 0
  done
  return 1
}

# Every checkout of a tracked repository in the folders, each once, with
# the remote that names it, the git folder its worktrees share, and 1 for
# the clone's own.
dirs=() names=() remotes=() commons=() owns=()
seen='
'
for folder in "$\{folders[@]}"; do
  top=$(expanded "$folder")
  [ -d "$top" ] || continue
  while IFS= read -r git_path; do
    dir=$(cd "$\{git_path%/.git}" 2>/dev/null && pwd -P) || continue
    case $seen in *"
$dir
"*) continue ;; esac
    seen="$seen$dir
"
    remote= name=
    while read -r key url; do
      found=$(repository_of "$url") || continue
      tracked "$found" || continue
      remote=$\{key#remote.}
      remote=$\{remote%.url}
      name=$found
      break
    done < <(git -C "$dir" config --get-regexp '^remote\..*\.url$' 2>/dev/null)
    [ -n "$name" ] || continue
    common=$(cd "$dir" && cd "$(git rev-parse --git-common-dir)" && pwd -P) || continue
    own=0
    [ "$dir/.git" = "$common" ] && own=1
    dirs+=("$dir") names+=("$name") remotes+=("$remote") commons+=("$common") owns+=("$own")
  done < <(find "$top" -maxdepth 3 -name .git -prune 2>/dev/null)
done

# A group per shared git folder: the first checkout of each stands for it.
groups=() group_of=()
for i in "$\{!dirs[@]}"; do
  g=-1
  for j in "$\{!groups[@]}"; do
    if [ "$\{commons[$\{groups[$j]}]}" = "$\{commons[$i]}" ]; then g=$j; break; fi
  done
  if [ "$g" -lt 0 ]; then g=$\{#groups[@]}; groups+=("$i"); fi
  group_of+=("$g")
done

# Switches the clone's own checkout at switch_path to the main branch
# switch_branch, before anything is fetched, printing 'S ok' or
# 'S refused message'. It never switches a worktree, as an agent may work
# there, nor a checkout with changed files, which would come along.
switch_refused() {
  printf 'S\trefused\t%s\n' "$(printf '%s' "$1" | flat)"
}
switch_clone() {
  local i dir= branch main= message
  for i in "$\{!dirs[@]}"; do
    if [ "$\{owns[$i]}" = 1 ] && [ "$(shown "$\{dirs[$i]}")" = "$switch_path" ]; then
      dir=$\{dirs[$i]}
      break
    fi
  done
  if [ -z "$dir" ]; then
    switch_refused "$switch_path is no clone of a tracked repository in the folders."
    return
  fi
  for branch in "$\{branches[@]}"; do
    [ "$branch" = "$switch_branch" ] && main=1
  done
  if [ -z "$main" ]; then
    switch_refused "$switch_branch is no main branch."
    return
  fi
  if [ -n "$(changes "$dir")" ]; then
    switch_refused "$switch_path has changed files."
    return
  fi
  if message=$(git -C "$dir" switch --quiet --no-guess "$switch_branch" 2>&1); then
    printf 'S\tok\t\n'
  else
    switch_refused "$message"
  fi
}
if [ -n "$switch_path" ]; then
  switch_clone
fi

tmp=$(mktemp -d "$\{TMPDIR:-/tmp}/verdandi.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

# Each group is fetched once, all of them at the same time: worktrees share
# their refs, which two fetches at once would trip over. A fetch that hangs
# is stopped after a minute. Nothing they start may keep the output open.
for g in "$\{!groups[@]}"; do
  i=$\{groups[$g]}
  (
    git -C "$\{dirs[$i]}" fetch --quiet "$\{remotes[$i]}" >/dev/null 2>"$tmp/$g.err" &
    fetch=$!
    (
      trap 'kill "$sleeper"' TERM
      sleep 60 &
      sleeper=$!
      wait "$sleeper" && kill "$fetch"
    ) >/dev/null 2>&1 &
    watchdog=$!
    if wait "$fetch"; then : >"$tmp/$g.ok"; fi
    kill "$watchdog" 2>/dev/null
  ) &
done
wait

# Brings a group's main branches up to date, printing what it did as
# 'U group branch moved|created|elsewhere|refused message': a branch only
# GitHub has is created; one that is only behind is moved forward, where it
# is not checked out by fetching from the repository itself, and where the
# clone's own checkout has it by merging there. One checked out in any
# worktree stays, as an agent may work there. Nothing ever merges with a
# commit of its own, nor overwrites a changed file.
update_group() {
  local g=$1
  local dir=$\{dirs[$\{groups[$1]}]} remote=$\{remotes[$\{groups[$1]}]}
  local common=$\{commons[$\{groups[$1]}]}
  local branch upstream counts worktree message
  for branch in "$\{branches[@]}"; do
    if ! git -C "$dir" show-ref --verify --quiet "refs/heads/$branch"; then
      if git -C "$dir" show-ref --verify --quiet "refs/remotes/$remote/$branch" &&
        git -C "$dir" branch --quiet --track "$branch" "$remote/$branch" >/dev/null 2>&1; then
        printf 'U\t%s\t%s\tcreated\t\n' "$g" "$branch"
      fi
      continue
    fi
    upstream=$(git -C "$dir" for-each-ref --format='%(upstream)' "refs/heads/$branch")
    [ -n "$upstream" ] || continue
    counts=$(git -C "$dir" rev-list --left-right --count "refs/heads/$branch...$upstream" 2>/dev/null) || continue
    # Only behind: none ahead, some behind.
    [ "$\{counts%%[!0-9]*}" = 0 ] && [ "$\{counts##*[!0-9]}" != 0 ] || continue
    worktree=$(git -C "$dir" for-each-ref --format='%(worktreepath)' "refs/heads/$branch")
    if [ -n "$worktree" ]; then
      worktree=$(cd "$worktree" 2>/dev/null && pwd -P)
      if [ "$worktree/.git" != "$common" ]; then
        printf 'U\t%s\t%s\telsewhere\t%s\n' "$g" "$branch" "$(shown "$worktree")"
        continue
      fi
      message=$(git -C "$worktree" merge --ff-only --quiet "$upstream" 2>&1)
    else
      message=$(git -C "$dir" fetch --quiet . "$upstream:refs/heads/$branch" 2>&1)
    fi
    if [ $? -eq 0 ]; then
      printf 'U\t%s\t%s\tmoved\t\n' "$g" "$branch"
    else
      printf 'U\t%s\t%s\trefused\t%s\n' "$g" "$branch" "$(printf '%s' "$message" | flat)"
    fi
  done
}
if [ "$mode" = update ]; then
  for g in "$\{!groups[@]}"; do
    [ -e "$tmp/$g.ok" ] && update_group "$g"
  done
fi

for g in "$\{!groups[@]}"; do
  i=$\{groups[$g]}
  if [ -e "$tmp/$g.ok" ]; then
    printf 'G\t%s\t%s\tok\t\n' "$g" "$\{names[$i]}"
  else
    printf 'G\t%s\t%s\tfailed\t%s\n' "$g" "$\{names[$i]}" "$(flat <"$tmp/$g.err")"
  fi
  git -C "$\{dirs[$i]}" for-each-ref \
    --format="B%09$g%09%(refname:strip=2)%09%(upstream)%09%(upstream:track,nobracket)" \
    refs/heads
done

for i in "$\{!dirs[@]}"; do
  dir=$\{dirs[$i]}
  branch=$(git -C "$dir" symbolic-ref --short -q HEAD)
  changed=$(changes "$dir" | wc -l | tr -d ' ')
  printf 'C\t%s\t%s\t%s\t%s\t%s\n' "$\{group_of[$i]}" "$(shown "$dir")" "$branch" "$changed" "$\{owns[$i]}"
done
`;
