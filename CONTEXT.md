# Verdandi

A desktop client for reading GitHub issues across many repositories at once, focused on how issues relate to each other: sub-issue hierarchies and blocking relationships that cross repository boundaries.

## Language

### Repositories

**Tracked repository**:
A GitHub repository the user has explicitly added for direct browsing in Verdandi. Tracked repositories define the scope of All, independently of views.
_Avoid_: watched repository, subscribed repository, starred repository

**External issue**:
An issue from a repository that is not a tracked repository, found through a view or reached by following a sub-issue or blocking relationship.
_Avoid_: foreign issue, remote issue

### Views

**View**:
A named, saved GitHub issue search whose scope is defined by its search text, independently of tracked repositories.
_Avoid_: dashboard, workspace, smart folder

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
