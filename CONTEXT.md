# Verdandi

A desktop client for reading GitHub issues across many repositories at once, focused on how issues relate to each other: sub-issue hierarchies and blocking relationships that cross repository boundaries.

## Language

### Repositories

**Tracked repository**:
A GitHub repository the user has explicitly added for direct browsing in Verdandi. Tracked repositories define the scope of All, independently of views. It is the repository itself, not its `owner/name`: it stays the same tracked repository through renames and transfers, and a new repository that takes over its old name is a different one.
_Avoid_: watched repository, subscribed repository, starred repository

**External issue**:
An issue from a repository that is not a tracked repository, found through a view or reached by following a sub-issue or blocking relationship.
_Avoid_: foreign issue, remote issue

### Views

**View**:
A named, saved GitHub issue search whose scope is defined by its search text, independently of tracked repositories.
_Avoid_: dashboard, workspace, smart folder

**Match**:
An issue returned by a view's search.
_Avoid_: hit, result

**Context issue**:
An issue shown in a view's tree only as an ancestor or sub-issue of a match, not because the search returned it. It is known not to match only when the view's search results are complete; otherwise its match status is unknown.
_Avoid_: nonmatch, filler issue

### Issues

**Author**:
The GitHub account that opened an issue, or wrote a comment. An issue whose account has been deleted has none.
_Avoid_: creator, reporter, opener, owner

### Issue relationships

**Sub-issue**:
An issue attached under another issue through GitHub's native sub-issue hierarchy; it may live in a different repository than its parent.
_Avoid_: child issue, subtask, task list item

**Parent issue**:
The issue a sub-issue is attached to. An issue has at most one parent issue.
_Avoid_: epic, tracking issue

**Blocking relationship**:
GitHub's native issue dependency between two issues: one issue is _blocked by_ the other, which _blocks_ it. It may cross repositories.
_Avoid_: dependency, link

**Blocking chain**:
The sequence of issues reached from an issue by following blocking relationships in one direction, possibly across repositories.
_Avoid_: dependency tree, blocking order

### Browsing

**Sidebar entry**:
One of the places the user opens from the sidebar: All, a tracked repository, or a view. Each has its own list.
_Avoid_: tab, folder, source

**All**:
The sidebar entry that shows every tracked repository at once, as one list. It is always there, always first, and is not a view.
_Avoid_: everything, overview, home, inbox

**Scope**:
The issues a sidebar entry stands for: a tracked repository's open issues, the open issues of every tracked repository for All, or a view's matches.
_Avoid_: filter, source

**List**:
What the main area shows for a sidebar entry: the issues of its scope, each under its parent issue, together with the parent issues and sub-issues needed to place them.
_Avoid_: tree view, feed, board
