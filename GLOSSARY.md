# Verdandi

A desktop client for GitHub issues across many repositories at once, focused on how issues relate to each other: sub-issue hierarchies and blocking relationships that cross repository boundaries.

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

### Issues

**Issue**:
A GitHub issue, in a tracked repository or not. Pull requests share issues' numbers but are not issues, and Verdandi does not show them.
_Avoid_: ticket, task

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

**Sidebar**:
The column beside the main area that lists the sidebar entries, with the account below them. The user can hide it to give the main area the whole window, and show it again. In the Electron app they can also drag its edge to make it wider or narrower, and dragging it narrower than it may be hides it. The Electron app keeps it hidden or shown, and its width, across launches on the same machine.
_Avoid_: collapse (an issue's sub-issues collapse), drawer, navigation

**Sidebar entry**:
One of the places the user opens from the sidebar: All, a tracked repository, or a view. Each has its own list.
_Avoid_: tab, folder, source

**All**:
The sidebar entry that shows every tracked repository at once, as one list. It is always there, always first, and is not a view.
_Avoid_: everything, overview, home, inbox

**Scope**:
The issues a sidebar entry stands for: a tracked repository's issues in the chosen state, the issues in the chosen state of every tracked repository for All, or the issues a view's search returns.
_Avoid_: filter, source

**State**:
Whether an issue is open or closed. A tracked repository and All show one state at a time, open unless the user switches to closed; a view's state comes from its search text.
_Avoid_: status

**Label filter**:
The labels the user has picked from a list to narrow it to issues that carry all of them. Each sidebar entry has its own, which lasts until the user removes it or quits, though the macOS app keeps the one of the entry chosen last for its next launch.
_Avoid_: tag, label search

**Match**:
An issue in a sidebar entry's scope that carries every label of its label filter; without a label filter, every issue in the scope. For a view, that means an issue its search returned.
_Avoid_: hit, result

**Context issue**:
An issue shown in a list only as an ancestor or sub-issue of a match, not a match itself. In a view it is known not to match only when the view's search results are complete; otherwise its match status is unknown.
_Avoid_: nonmatch, filler issue

**List**:
What the main area shows for a sidebar entry: its matches, each under its parent issue, together with the context issues needed to place them.
_Avoid_: tree view, feed, board

### Tabs

**Tab**:
One of the places open side by side in the main area, shown one at a time: a sidebar entry's list with the issues opened from it one after another, or a new tab. Choosing a sidebar entry shows it in the tab shown. A tab is named after its sidebar entry, followed by the issue it shows, if any.
_Avoid_: window, page

**New tab**:
A tab with nothing chosen in it yet, offering the recent issues and a field to go to an issue by its number or link.
_Avoid_: blank tab, start page, home

**Recent issue**:
One of the issues the user opened last, whichever way they opened it, newest first. In the macOS app, only an issue gone to by its number or link is one.
_Avoid_: history, recently viewed

### Look

**Theme**:
A named set of colours for Verdandi, either light or dark. The user picks one light theme and one dark theme.
_Avoid_: colour scheme, skin, palette

**Appearance**:
Whether Verdandi shows the user's light theme or dark theme: following the operating system, always light, or always dark. It follows the operating system unless the user chooses otherwise.
_Avoid_: mode, dark mode, colour mode

**Interface font**:
The font family Verdandi shows all text in but code. The user chooses it from the fonts installed on their machine; unless they do, it is one Verdandi ships.
_Avoid_: UI font, body font, system font

**Code font**:
The font family Verdandi shows code in, such as code in issue bodies and comments. The user chooses it as they do the interface font; unless they do, it is a monospace font Verdandi ships.
_Avoid_: monospace font, mono font

**Text size**:
The size of body text in Verdandi, in pixels. All other text grows and shrinks with it in proportion, while spacing and icons stay as they are, unlike zoom, which grows everything.
_Avoid_: font size, zoom
