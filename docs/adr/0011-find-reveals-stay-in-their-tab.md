# Keep Find and the paths it opens within one Electron tab

The Electron app's Find ([issue #48](https://github.com/chris-metz/verdandi/issues/48)), including the paths it opens to reveal text matches, belongs to one tab. These automatic expansions remain local to that tab after Find closes; manual list expansion remains shared by sidebar entry as in [ADR 0007](0007-tabs-hold-a-sidebar-entry.md). We chose this exception so typing and stepping through text matches in one tab cannot change what another tab shows, while ordinary list browsing keeps its existing rules.
