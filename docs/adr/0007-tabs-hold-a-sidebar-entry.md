# Tabs hold a sidebar entry, and the sidebar shows into the tab shown, unless it is pinned

The Electron app's main area gets tabs ([#79](https://github.com/chris-metz/verdandi/issues/79)). A tab holds what the main area held before, a sidebar entry's list with the issue pages opened from it, or is a new tab. The sidebar stays one for the whole window, and choosing an entry shows it in the tab shown, replacing what that tab showed, as a browser's address bar does. Issues are kept side by side by opening them in other tabs (Open in New Tab, ⌘-click, ⌘Enter, or a new tab's palette), not through the sidebar. This keeps one rule for every tab: it has an entry, which is where Back to the list and a label clicked on an issue page lead. A pinned tab is the one exception to showing into the tab shown: choosing another entry while it is shown opens that entry in a new tab, as Safari does, so that a tab the user keeps open, such as Checkouts, is never replaced by a click in the sidebar. Issues opened from its own list still open in it.

## Considered Options

- **A fixed list tab with issue tabs beside it:** the first tab always shows the selected entry's list and follows the sidebar, and every issue opened from it gets a tab of its own. Issues open side by side without an extra step, and the sidebar never changes with the tab shown. But an issue tab is cut off from the list it came from, so Back to the list and a label filter need a rule of their own for it, and every issue opened, even in passing, leaves a tab behind.
- **Tabs across the whole window, each with its own sidebar:** the sidebar shows the same tracked repositories, views and account in every tab, so only its selection would differ, and the tab's entry holds that already.
- **A pinned tab that follows the sidebar like any other**, as in Chrome, where pinning only makes it small and keeps it at the left: one rule for every tab, but a tab pinned to keep it open would be gone after one click in the sidebar.
- **Several windows**, joined as native window tabs on macOS: they behave differently on each platform, and Verdandi is built around one window, one instance and one window restored at launch.

## Consequences

- What is restored at launch is every tab with its entry, its issue pages and whether it is pinned, not one selected entry.
- A label filter, a state and an expansion still belong to the sidebar entry, so two tabs showing the same entry share them.
