# Installed fonts and text size

Research date: **2026-10-02**. For [Research listing installed fonts and making text size relative](https://github.com/chris-metz/verdandi/issues/64). It feeds [Let the user choose the interface font and the code font](https://github.com/chris-metz/verdandi/issues/65) and [Let the user change the text size](https://github.com/chris-metz/verdandi/issues/66). This records how the Electron app can list installed font families and tell monospace ones apart, how it can check that a family named in `config.toml` is installed, and how much of the renderer's layout is in fixed pixels today. It does not decide the keys, the dialog, or the wording of notices. Context: [ADR 0005](../adr/0005-look-in-a-toml-config-file.md) (fonts and text size go into `config.toml`; zoom stays machine-local), [ADR 0001](../adr/0001-typescript-electron-stack.md) (one browser engine on all three operating systems), [GitHub issue images and attachments](github-issue-media.md) (the sandboxed renderer and its CSP).

The Electron app uses Electron 44.4.5, which bundles Chromium 152.0.7977.130 and Node 24.21.0 ([release](https://releases.electronjs.org/release/v44.4.5)), and Tailwind CSS 4.3.3 (`electron/apps/desktop/package.json`). The window has `contextIsolation: true`, `sandbox: true` and `nodeIntegration: false` (`electron/apps/desktop/src/main/index.ts:330-335`). Main sets no session permission handlers. Renderer paths below are relative to `electron/apps/desktop/src/renderer/src/`.

## Findings

- **The renderer can list installed fonts itself, with `window.queryLocalFonts()`.** In Electron 44 it works in Verdandi's sandboxed, context-isolated window from a `file://` page, without a user gesture and without any permission handler. On the Mac used here it returned 522 faces in 182 families in 127–174 ms, then about 1 ms for later calls. That is the same set CoreText reports.
- **Electron consults only the permission check handler for it**, under the name `local-fonts`. Without a check handler every check passes. A check handler that refuses makes the call resolve with an empty list, not an error. The request handler is never called for it.
- **The call fails while the window is hidden**, and on macOS also while it is fully covered: `SecurityError: Page needs to be visible.` A window created with `show: false` counts as visible on first load, so the call works at startup.
- **No source tells monospace without extra work.** `FontData` has only `family`, `fullName`, `postscriptName`, `style` and `blob()`. Parsing each font's `post` table took 1.8 s for 182 families. A canvas width check took 50 ms and found every family CoreText marks monospace, plus three that are not. Native APIs tell it directly (CoreText, DirectWrite, fontconfig), but reaching them from Electron needs a native module or a child process.
- **The npm packages run in the main process and are either thinly maintained or partly heuristic.** `font-list` (MIT, published 2026-05) is current, but on Windows it decides monospace from words in the family name. The native modules `font-scanner` and `fontmanager-redux` (MIT) ask the platform APIs, but were last published in 2022 and 2021 and build with node-gyp on install.
- **`document.fonts.check()` cannot tell an installed family from a missing one.** It returned `true` for both. Checking against the family list from `queryLocalFonts()` works, and a canvas measurement works as a second opinion. Families the app ships, such as Geist, are not in that list.
- **A font installed while Verdandi runs does not appear in `queryLocalFonts()` until restart.** Chromium caches the list for the session. On Linux Chromium also turns off fontconfig's rescanning. On macOS Chromium tells renderers when registered fonts change, so CSS may already use a new font there.
- **Today's base text size is 14 px**: the app root is `text-sm` (0.875rem at Chromium's default 16 px root) and `.markdown-body` is `font-size: 14px`. No root `font-size` is set anywhere.
- **Most text sizes are already rem-based.** 85 uses of Tailwind's rem text scale, 24 arbitrary pixel text sizes, 6 pixel font sizes in `github-markdown.css`. But Tailwind's spacing is rem too, so growing the root font size would grow spacing, icons and the sidebar as well.
- **What breaks when text grows is what holds text in a fixed box**: 10 fixed line heights in classes and 2 in `github-markdown.css`, 14 fixed heights around one line of text, 5 list column widths, and the blocking map's card size, which is a pixel constant fed to ELK. Scroll anchoring measures the DOM and has no row-height constant; nothing is virtualized.

## Listing installed fonts

### Local Font Access API

`window.queryLocalFonts()` "returns a Promise that fulfills with an array of FontData objects representing the font faces available locally", optionally filtered by PostScript names. The permission is `local-fonts`. MDN marks it experimental and not Baseline ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)). Chromium enables it by default on desktop since 103 ([Chrome Platform Status](https://chromestatus.com/feature/6234451761692672)). The spec is a WICG Draft Community Group Report of 7 June 2024. It requires transient activation, rejects opaque origins, and sorts results by PostScript name ([WICG spec](https://wicg.github.io/local-font-access/)).

`FontData` has four read-only names (`family`, `fullName`, `postscriptName`, `style`) and `blob()`, which returns "the raw bytes of the underlying font file" ([MDN FontData](https://developer.mozilla.org/en-US/docs/Web/API/FontData)). The result holds faces, not families, so a family list needs deduplicating.

**In Electron.** Electron 44's session docs list `local-fonts` for both `setPermissionRequestHandler` and `setPermissionCheckHandler` ([session](https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler)). The source settles which one matters:

- Electron answers Chromium's "status for current document" query with the check handler: granted or denied, never "ask". Without a check handler it returns `true` for everything except the deprecated sync clipboard read ([electron_permission_manager.cc](https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_permission_manager.cc)).
- Chromium's font access manager asks for user activation and a permission prompt only when the status is "ask" ([font_access_manager.cc at 152](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_access_manager.cc)). In Electron that never happens, so the spec's activation rule does not apply.
- A denied status resolves with an empty list. Blink rejects only for "needs user activation", "not visible", unsupported platform or an unexpected error ([font_access.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/third_party/blink/renderer/modules/font_access/font_access.cc)).
- "By default, Electron will automatically approve all permission requests unless the developer has manually configured a custom handler" ([Electron security](https://www.electronjs.org/docs/latest/tutorial/security#5-handle-session-permission-requests-from-remote-content)).

**Observed** with Electron 44.4.5 on macOS 27.0.1, in a scratch app with Verdandi's `webPreferences` and CSP, loading a `file://` page (as the packaged app does):

| Setup                                                   | Result                                                                                                                                                |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No handlers, no user gesture                            | 522 faces, 182 families; `navigator.permissions.query({name: "local-fonts"})` is `granted`; `window.origin` is `file://`, `isSecureContext` is `true` |
| Check handler returning `true`                          | Same; the handler saw `local-fonts` with origin `file:///`; the request handler was not called                                                        |
| Check handler returning `false` for `local-fonts`       | Resolved with `[]`, with or without a simulated user gesture                                                                                          |
| Window hidden with `win.hide()` after a successful call | Rejected: `SecurityError: Page needs to be visible.`                                                                                                  |
| Called before the `show: false` window was shown        | Worked; `document.visibilityState` was `visible`                                                                                                      |

The last two rows match Electron's docs: on macOS the visibility state is also `hidden` while the window is fully covered by another, and a window created with `show: false` starts `visible` ([Page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility)). Chromium checks visibility before anything else, including its cache.

**Opaque origins.** Chromium's main branch now answers a document with an opaque origin with "permission denied", that is, an empty list. Chromium 152 does not have that check yet ([main](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/font_access/font_access_manager.cc)). The `file://` page here reported the origin `file://`, not `null`, and got the full list. A later Electron should be re-tested.

**What each platform contributes** (Chromium 152 source):

- **macOS:** CoreText's available fonts, duplicates removed ([mac data source](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_enumeration_data_source_mac.mm)). On this Mac the list left out the hidden system families whose names begin with `.`, and included user fonts in `~/Library/Fonts`.
- **Linux:** fontconfig's `FcFontList`, only TrueType and CFF formats, deduplicated by PostScript name ([Linux data source](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_enumeration_data_source_linux.cc)).
- **Windows:** DirectWrite's system font collection ([Windows data source](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_enumeration_data_source_win.cc)).

The font data is read once per storage partition and cached: `GetFontEnumerationData()` builds it only while `initialized_` is false ([font_enumeration_cache.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_enumeration_cache.cc)). That explains the 1 ms second call.

Electron's API docs list no font enumeration of their own. Their only mention of installed fonts is the `local-fonts` permission.

### npm packages

All of these run in the main process, not in the sandboxed renderer. Verdandi's packaging takes only `out/**`, which electron-vite bundles, and `package.json`; no `node_modules` are packaged (`electron/apps/desktop/electron-builder.yml`). A package that ships a binary or a `.node` file next to its source needs extra packaging work.

| Package                                                                          | Last publish, license  | How it works                                                                                                                                                                                                                                           | Monospace                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`font-list`](https://github.com/oldj/node-font-list) 2.1.0                      | 2026-05-21, MIT        | macOS: runs a bundled universal binary built from `NSFontManager availableFontFamilies`, then falls back to `system_profiler`. Linux: `fc-list`. Windows: PowerShell with WPF's `SystemFontFamilies`, preferring a zh-CN family name where one exists. | macOS: `NSFontMonoSpaceTrait` of the family's first member. Linux: `spacing` text containing "mono", else words such as "mono" or "courier" in the name. Windows: only words in the name ("mono", "courier", "console", "terminal", "fixed", "typewriter"); a width check exists only in a comment. |
| [`font-scanner`](https://github.com/axosoft/font-scanner) 0.2.1                  | 2022-09-13, MIT        | Native addon: CoreText, DirectWrite, fontconfig. Built with node-gyp on install; Linux needs `libfontconfig-dev`.                                                                                                                                      | `kCTFontMonoSpaceTrait`, `IDWriteFontFace1::IsMonospacedFont`, `FC_SPACING == FC_MONO`                                                                                                                                                                                                              |
| [`fontmanager-redux`](https://github.com/Eugeny/fontmanager-redux) 1.1.0         | 2021-06-24, MIT        | Same design as `font-scanner` (both descend from `font-manager`). node-gyp on install.                                                                                                                                                                 | Same                                                                                                                                                                                                                                                                                                |
| [`get-system-fonts`](https://github.com/princjef/get-system-fonts) 2.0.2         | 2020-06-12, MIT        | Scans font folders and returns file paths, not family names.                                                                                                                                                                                           | No                                                                                                                                                                                                                                                                                                  |
| [`system-font-families`](https://github.com/rBurgett/system-font-families) 0.6.0 | 2021-10-20, Apache-2.0 | Pure JavaScript; parses TTF and OTF files.                                                                                                                                                                                                             | No                                                                                                                                                                                                                                                                                                  |

The `font-list` README's platform table says macOS uses `system_profiler`; its code tries the bundled binary first ([darwin/index.js](https://github.com/oldj/node-font-list/blob/e3d83ac9a500bf644ae82d3ca46f271b7f5be83d/libs/darwin/index.js), [win32 detailed script](https://github.com/oldj/node-font-list/blob/e3d83ac9a500bf644ae82d3ca46f271b7f5be83d/libs/win32/getDetailedFontsByPowerShell.js), [linux/index.js](https://github.com/oldj/node-font-list/blob/e3d83ac9a500bf644ae82d3ca46f271b7f5be83d/libs/linux/index.js)). Its macOS binary is found through `__dirname`, which a Vite bundle changes. The native modules' monospace checks are in their `src/FontManager*.{mm,cc}` files. Publish dates are from the npm registry.

**Observed** on the same Mac: `font-list` `getFonts()` returned 182 families in 40 ms and `getFonts2()` in 85 ms, with the same 7 monospace families as CoreText.

### Platform tools

- **macOS `system_profiler SPFontsDataType -json`** "reports on the hardware and software configuration of the system" (`man system_profiler`). Observed: 8.8 s, 242 files, 277 families, including 95 hidden families whose names begin with `.`. Its typeface records have `family`, `fullname`, `style` and others, but no monospace field.
- **CoreText** marks monospace faces with `traitMonoSpace` (`kCTFontMonoSpaceTrait`): "The font uses fixed-pitch glyphs if available" ([Apple](https://developer.apple.com/documentation/coretext/ctfontsymbolictraits/traitmonospace)). Observed with a small Swift program: 522 faces, 182 families, 7 monospace families, 47 ms.
- **Linux `fc-list`** "lists fonts and styles available on the system for applications using fontconfig"; `-q` "returns 1 as the error code if no fonts matched" ([fc-list(1) source](https://gitlab.freedesktop.org/fontconfig/fontconfig/-/raw/main/fc-list/fc-list.sgml)). Fontconfig's `spacing` property is "Proportional, dual-width, monospace or charcell", with the constants `proportional` 0, `dual` 90, `mono` 100 and `charcell` 110 ([fontconfig user docs source](https://gitlab.freedesktop.org/fontconfig/fontconfig/-/raw/main/doc/fontconfig-user.sgml)). So a pattern such as `fc-list :spacing=mono family` lists monospace families. `fc-match` always returns a best match, so it cannot say "missing" by itself.
- **Windows DirectWrite:** `IDWriteFactory::GetSystemFontCollection` "Gets an object which represents the set of installed fonts" ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefactory-getsystemfontcollection)). `IDWriteFont1::IsMonospacedFont` "Determines if the font is monospaced", from Windows 8 and the Windows 7 Platform Update ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/dwrite_1/nf-dwrite_1-idwritefont1-ismonospacedfont)). Node can reach it only through a native module.

### Telling monospace families apart in the renderer

`queryLocalFonts()` says nothing about spacing, so the renderer has two options:

- **Parse the font.** The OpenType `post` table's `isFixedPitch` is "Set to 0 if the font is proportionally spaced, non-zero if the font is not proportionally spaced (i.e. monospaced)" ([OpenType post](https://learn.microsoft.com/en-us/typography/opentype/spec/post)). MDN's `FontData` example reads the SFNT header from `blob()` the same way. Observed: reading one face per family for 182 families took 1.8 s, because each `blob()` reads the whole file. It found 7; it missed Monaco, which CoreText marks monospace, and added a bitmap font CoreText does not mark.
- **Measure.** Compare the canvas widths of `iiiiiiiiii` and `MMMMMMMMMM` in each family ([measureText](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/measureText)). Observed: 50 ms for 182 families. It found all 7 CoreText families plus Webdings, a Thai font and a proportional "Propo" variant of a Nerd Font.

Both were tried on one Mac only.

### Showing each family in its own face

[#65](https://github.com/chris-metz/verdandi/issues/65) draws each name in its own face. That is only a `font-family` on each entry, and the CSP allows it (see below). Because "Font selection is done one character at a time" ([MDN font-family](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)), a family without Latin glyphs, such as the Thai font above, shows its name in the fallback. A symbol font such as Webdings shows pictures instead of its name. What drawing about 180 faces at once costs was not measured.

### Comparison

| Source                              | Families (this Mac)      | Speed (this Mac)                   | Monospace                                                     | Sandboxed renderer with `contextIsolation`        | Maintenance                               | License          |
| ----------------------------------- | ------------------------ | ---------------------------------- | ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------- | ---------------- |
| `queryLocalFonts()`                 | 182                      | 127–174 ms first call, ~1 ms after | Not exposed; parse `blob()` (1.8 s) or measure (50 ms)        | Yes, observed                                     | Part of Chromium; spec still a WICG draft | Part of Electron |
| `font-list`                         | 182                      | 40 / 85 ms                         | Native trait on macOS; name words on Windows and partly Linux | No: main process, child processes, bundled binary | Published 2026-05                         | MIT              |
| `font-scanner`, `fontmanager-redux` | Not tested               | Not tested                         | Platform APIs on all three                                    | No: main process, native addon                    | Last published 2022 / 2021                | MIT              |
| `system_profiler`                   | 277, including 95 hidden | 8.8 s                              | No                                                            | No: macOS only, child process                     | Apple                                     | Part of macOS    |
| `fc-list`                           | Not tested               | Not tested                         | `:spacing=mono`                                               | No: Linux only, child process                     | fontconfig                                | Part of the OS   |
| DirectWrite                         | Not tested               | Not tested                         | `IsMonospacedFont`                                            | No: native code                                   | Microsoft                                 | Part of Windows  |

## Checking that a font is installed

The family names in `config.toml` are only words in a CSS `font-family` list. "The browser will select the first font in the list that is installed or that can be downloaded using a @font-face at-rule", and "Font selection is done one character at a time" ([MDN font-family](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family)). So a missing family never breaks rendering: a list like `"Chosen", "Geist Variable", sans-serif` falls back to Geist by itself. The check is needed only to tell the user, and to mark the name "not installed" in the picker. Family names are matched case-insensitively, including localized names ([CSS Fonts 4 §5.1](https://drafts.csswg.org/css-fonts-4/#localized-name-matching)).

How Verdandi reads the file today: the core reads and validates `config.toml` (`electron/packages/core/src/settings/config-file.ts`, `config-document.ts`) and watches its folder (`watch-file.ts` in the same folder). It pushes `configChanged` to the renderer, which follows it with `followConfig` (`config.ts:10-34`) and lists problems in `ConfigProblems.tsx`. Themes are checked in the core against a `ThemeCatalogue` that the desktop app passes in (`electron/packages/core/src/settings/port.ts:167-170`). The core cannot see installed fonts; in the desktop app only the renderer can, through `queryLocalFonts()`, unless main gains a native module or a child process.

### Options

- **`document.fonts.check()`: unusable.** It returns `true` "if rendering text with the given font specification will not attempt to use any fonts in this FontFaceSet that are not yet fully loaded"; MDN's own example says `check("12px i-dont-exist")` is `true` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check)). The spec returns `true` when the list of matching font faces is empty or all are system fonts ([CSS Font Loading](https://drafts.csswg.org/css-font-loading/#font-face-set-check)). Observed: `true` for both Menlo and a made-up name.
- **`@font-face` with `local()`: unsuitable.** `local()` matches "either the Postscript name or the full font name", not the family name ([MDN src](https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src)).
- **Match against the family list from `queryLocalFonts()`.** Compare case-insensitively with each `family`. It needs the window visible for the first call.
- **Canvas measurement.** Measure a probe string in `"Name", monospace`, `"Name", serif` and `"Name", sans-serif` against each generic alone; any difference means the family is used. Observed: Menlo and Helvetica found, the made-up name not. It also worked under Verdandi's CSP, whose `font-src` is `'self' data:` (`electron/apps/desktop/src/renderer/index.html:12`), so naming an installed family is not a font load the CSP blocks. It cannot see a family that has no glyphs for the probe string, because Chromium falls back per character.
- **Main process.** `fc-list -q "<family>"` on Linux, or a family list from `font-list` or a native module, compared the same way.

### At startup and after a change

- **At startup** the renderer can call `queryLocalFonts()` once: the `show: false` window counts as visible on first load. The CSS fallback already covers the moment before the answer arrives, so the first paint need not wait for it, unlike the theme (`main.tsx:10-21`).
- **After a change to the file** the window is often in the background, behind the editor. On macOS a fully covered window is `hidden`, and the call rejects. The renderer should therefore keep the family list from startup and check later changes against it.
- **A font installed while Verdandi runs is missing from that list until restart.** Chromium caches the list per session (above). Whether CSS can already use the new font differs:
  - macOS: the browser process forwards `kCTFontManagerRegisteredFontsChangedNotification` to every renderer ([theme_helper_mac.mm](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/theme_helper_mac.mm)), which calls `blink::RegisteredFontsChanged()` ([render_thread_impl.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/renderer/render_thread_impl.cc)). A canvas check could confirm it.
  - Linux: Chromium sets fontconfig's rescan interval to 0 "to disable re-scan" ([fontconfig_util.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/ui/gfx/linux/fontconfig_util.cc)), while fontconfig would otherwise "automatically rebuild the internal datastructures when this interval passes" ([fontconfig user docs source](https://gitlab.freedesktop.org/fontconfig/fontconfig/-/raw/main/doc/fontconfig-user.sgml)).
  - Windows: Chromium's font proxy takes the system collection once when it initializes ([dwrite_font_proxy_impl_win.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/renderer_host/dwrite_font_proxy_impl_win.cc)). DirectWrite itself notices new fonts with "some latency" ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/dwrite/nf-dwrite-idwritefactory-getsystemfontcollection)). Not tested.

### Fonts the app ships

Geist comes from `@fontsource-variable/geist` (`electron/apps/desktop/package.json`, `index.css:4`) as an `@font-face` bundled into `out/`. `queryLocalFonts()` lists only "font faces available locally" ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts)), so a shipped family is missing from the family list unless it is also installed. The picker has to add shipped families itself, and the installed check has to accept them. The same publisher has `@fontsource-variable/geist-mono` 5.3.0, under OFL-1.1 ([npm](https://www.npmjs.com/package/@fontsource-variable/geist-mono)). [#65](https://github.com/chris-metz/verdandi/issues/65) asks whether to ship it as the code font's default; this note did not weigh that and makes no recommendation.

## Text size today

### The base and the units

- No root `font-size` is set; `html` gets only `font-sans` (`index.css:72-74`). Chromium's default is 16 px; Electron's `webPreferences.defaultFontSize` "Defaults to `16`" and is a window creation option ([web-preferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)).
- The whole app inherits `text-sm` from its root element (`App.tsx:460`): 0.875rem, 14 px. Issue bodies and comments use `.markdown-body { font-size: 14px }` (`github-markdown.css:10`). **14 px is today's base size.**
- `rem` "Represents the font-size of the root element", and `em` the element's own computed font size ([MDN length](https://developer.mozilla.org/en-US/docs/Web/CSS/length)).
- Tailwind 4's text utilities are rem with unitless line heights: `text-xs` is `font-size: var(--text-xs); /* 0.75rem (12px) */ line-height: var(--text-xs--line-height); /* calc(1 / 0.75) */` ([font-size](https://tailwindcss.com/docs/font-size)).
- Tailwind 4's spacing and sizing are rem too: `p-<number>` is `padding: calc(var(--spacing) * <number>)`, and the default `--spacing` is 0.25rem ([padding](https://tailwindcss.com/docs/padding), [theme](https://tailwindcss.com/docs/theme)). The build confirms `h-8` as `calc(var(--spacing) * 8)` and `leading-4` as `line-height: calc(var(--spacing) * 4)`, while `text-[11px]` compiles to a literal `font-size: 11px`.
- `index.css` overrides only fonts, colours and radii in `@theme inline` (`index.css:14-59`). It sets `--font-sans: "Geist Variable", sans-serif` (`index.css:16`) and `--radius: 0.625rem` (`index.css:62`). The text and spacing scales are Tailwind's defaults.

### Tailwind classes

Counted over every string in the renderer's `.ts` and `.tsx` files, tests excluded, with variants stripped:

| Kind                                     | Uses            | Notes                                                                                                                                                                                                                                                                |
| ---------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text, Tailwind scale (rem)               | 85 in 24 files  | `text-xs` 69, `text-sm` 12, `text-base` 2, `text-xl` 1, `text-2xl` 1                                                                                                                                                                                                 |
| Text, arbitrary px                       | 24 in 11 files  | `text-[11px]` 18, `text-[10px]` 5, `text-[13px]` 1                                                                                                                                                                                                                   |
| Text, arbitrary rem                      | 1               | `text-[0.8rem]` (`components/ui/button.tsx:25`)                                                                                                                                                                                                                      |
| Line height, spacing-based               | 6               | `leading-4`: `BlockingMapBand.tsx:316`, `IssueRow.tsx:244,265,308,497`, `RateLimitsButton.tsx:107`                                                                                                                                                                   |
| Line height, arbitrary px                | 4               | `leading-[18px]`: `IssueRow.tsx:444,463`, `LabelFilter.tsx:76,111`                                                                                                                                                                                                   |
| Line height, unitless                    | 6               | `leading-none` 3, `leading-snug` 2, `leading-tight` 1                                                                                                                                                                                                                |
| Spacing and sizing, Tailwind scale (rem) | 465 in 27 files | `min-w-0` 27, `gap-2` 21, `gap-1` 20, `px-2` 19, `px-4` 18 …; icons are `size-3`, `size-3.5`, `size-4`                                                                                                                                                               |
| Sizing, arbitrary px                     | 4               | `size-[18px]`, the chevron box (`IssueRow.tsx:217,334,525,533`)                                                                                                                                                                                                      |
| Sizing, arbitrary with rem               | 8               | `max-h-[calc(100%-3rem)]` and similar in dialogs; `h-[min(40rem,calc(100%-3rem))]` (`RepositoryPicker.tsx:212`)                                                                                                                                                      |
| Sizing, containers (rem)                 | 7               | `max-w-sm`, `-lg`, `-xl`, `-2xl`, `-3xl`                                                                                                                                                                                                                             |
| Other arbitrary px                       | 10              | `border-l-[3px]` (`BlockingMapBand.tsx:277`), `rounded-[min(var(--radius-md),10px\|12px)]` ×4 (`button.tsx`), 2 px `shadow-[inset_…_var(--selection-edge)]` selection edges ×5 (`App.tsx:44`, `IssueRow.tsx:194`, `RepositoryPicker.tsx:265,469`, `Sidebar.tsx:447`) |

There are no `h-[..px]`, `w-[..px]`, `gap-[..px]` or `p-[..px]` classes. The arbitrary pixel text sizes are:

- `text-[11px]`: `BlockingMapBand.tsx:177`, `GoToIssueDialog.tsx:134`, `IssueRow.tsx:97,265,308,444,463,497`, `LabelFilter.tsx:76,111,189`, `RepositoryPicker.tsx:500`, `SettingsDialog.tsx:49`, `Sidebar.tsx:370,496`, `ViewDialog.tsx:142,262`, `ViewPane.tsx:163`
- `text-[10px]`: `Avatar.tsx:21` (the initial inside a fixed-size avatar), `BlockingMapBand.tsx:304,376`, `IssueRow.tsx:244`, `RateLimitsButton.tsx:107`
- `text-[13px]`: `ViewDialog.tsx:176`

Inline styles set no font size. The only inline pixel sizes are the blocking map's layout (`BlockingMapBand.tsx:166,172,178,257-263`) and the indent of nested rows (`IssueRow.tsx:202`, `depth * 20`, matching the 20 px guides in `index.css:77-85`).

### Fixed boxes that hold text

These are spacing classes, rem today, that set a box's size around text. They do not grow with the text if the text alone grows:

- **Fixed heights around one line** (14 sites in 8 files):
  - list rows `h-8` (`IssueRow.tsx:192,332`)
  - the sticky column header `h-7` (`IssueRow.tsx:97`)
  - the issue page header `h-12` (`IssuePagePane.tsx:304`)
  - the view strip `h-7` (`ViewPane.tsx:275`)
  - chips `h-5` (`IssueRow.tsx:587`, `LabelFilter.tsx:145`)
  - text inputs `h-8` (`GoToIssueDialog.tsx:138`, `RepositoryPicker.tsx:235`, `ViewDialog.tsx:33`)
  - the shadcn button sizes `h-6`, `h-7`, `h-8`, `h-9` (`components/ui/button.tsx:23-26`), used 23 times in 8 files

  Rows that use `min-h-*` already grow (`Sidebar.tsx:444`, `IssueListPane.tsx:120`, `ViewPane.tsx:114`, `RepositoryPicker.tsx:467`).

- **List column widths**: `w-7`, `w-16`, `w-24`, `w-20`, `w-16` for By, Created, Sub-issues, Blocked by and Blocks, shared by header and cells (`IssueRow.tsx:57,64,71,78,85`).
- **Fixed line heights**: the 6 `leading-4` and 4 `leading-[18px]` sites above. They stay 16 or 18 px whatever the font size.

Panes and boxes whose text wraps or truncates are not on this list. At larger sizes they show less text per line; whether any should grow is a choice for [#66](https://github.com/chris-metz/verdandi/issues/66), which wants the sidebar width to stay:

- the sidebar `w-64` (`App.tsx:468`)
- the settings dialog's section list `w-40` (`SettingsDialog.tsx:56`)
- the repository picker's owners `w-48` (`RepositoryPicker.tsx:241`)
- the rate-limit popover `w-80` (`RateLimitsButton.tsx:62`)
- `max-w-80` on the label filter popover and the issue page's buttons (`LabelFilter.tsx:101`, `IssuePagePane.tsx:388`)
- the map card's repository chip `max-w-36` (`BlockingMapBand.tsx:304`)

### `github-markdown.css`

It is Verdandi's own stylesheet, written for GitHub's rendered HTML and the theme tokens. It is not a vendored copy of a package; it arrived with `7a4fcdc` ("Show issue bodies and comments from GitHub's HTML"). Its sizes hang off `.markdown-body { font-size: 14px }` (`github-markdown.css:10`):

- **Relative to it:** headings `2em` to `0.85em` (`:43,49,54,58,62,66`), code `85%` (`:171,180`) and `100%` inside `pre` (`:191`), and the body's unitless `line-height: 1.5` (`:11`).
- **Their own pixel font sizes**, 5 besides the root's 14 px: `kbd` 11 px with `line-height: 10px` (`:206-207`), footnotes 12 px (`:460`), the header of client-rendered blocks 12 px (`:498`), attachments 12 px with `line-height: 22px` (`:557-558`), media placeholders 12 px (`:584`).
- **Spacing:** 24 pixel paddings, margins and gaps (block margins 16 and 24 px, `pre` padding 16 px), 7 em-based ones that grow with the text (heading rules, list indent `2em`, code padding `0.2em 0.4em`), and 2 rem ones (`:394,414`). The link underline offset is rem too (`0.2rem`, `:141`). Borders, radii and outlines are pixels.

The code font comes from `:162-166`: `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace`. Tailwind's own `--font-mono` is a similar stack.

### The blocking map

The layout is computed in JavaScript and handed to ELK as numbers (`blocking-layout.ts`):

- `cardWidth = 216`, `cardHeight = 112`, `columnWidth = 280`, `padding = 28`, `minimumMapHeight = 224` (`:10-15`)
- ELK spacing `32` between cards and `64` between layers (`:80-81`). ELK only orders the cards in a column and sets their `y`; columns are placed at `padding + step × columnWidth` (`:99`). `columnWidth` is the card width plus the same 64 px gap.
- cards start at `y = 64` (`:105`), below the column titles; long arrows use a lane at `top = 44` (`:119`) and curve by 36 px (`:137-149`)

None of these come from text metrics. The card's content is `px-3 py-2.5 text-xs`, a header row with the state icon and a `text-[10px]` repository chip, a two-line title with `leading-4`, and a row of label dots (`BlockingMapBand.tsx:274-329`). By that arithmetic it needs about 93 px of the 112. The column titles sit at `top-5` in `text-[11px]` (`BlockingMapBand.tsx:177`). Branch badges are `text-[10px]` (`:376`). The layout runs again only when the map or its root changes (`BlockingMapBand.tsx:57-72`). Keyboard moves and scrolling in the map use the layout's own coordinates (`map-navigation.ts`); only `revealMapCard`'s 16 px margin is a constant (`:40-42`).

### List navigation and scroll anchoring

- No list is virtualized, and no code holds a row height.
- Keyboard moves scroll the selected row into view with `scrollIntoView({ block: "nearest" })` (`use-list-pane.ts:145`, `Sidebar.tsx:100`, `IssuePagePane.tsx:286`). A list row's `scroll-mt-7` (`IssueRow.tsx:192`) equals the sticky header's `h-7` (`IssueRow.tsx:97`), so a row is not scrolled under the header. These two must stay equal.
- Scroll anchoring measures the DOM. `noteAnchor` and `keepAnchored` compare `getBoundingClientRect()` tops (`scroll-anchor.ts:19-60,82-85`) after every render (`use-list-pane.ts:150-158`, `IssuePagePane.tsx:289-298`). A change of text size re-renders and keeps the anchored row in place.
- Page scrolling moves by `0.85 × clientHeight` (`IssuePagePane.tsx:211-213`).
- Each list and issue visit remembers its `scrollTop` in pixels for the session and restores it as is (`use-list-pane.ts:124`, `IssuePagePane.tsx:278`). After a text size change, a list opened later lands slightly off. The selected row is not affected.

## Growing text but not spacing

**(a) Zoom.** `webContents.setZoomFactor` "Changes the zoom factor to the specified factor"; zoom levels scale by "1.2 ^ level", and Chromium keeps one zoom per origin by default ([webContents](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoomfactorfactor)). It scales CSS pixels, so spacing, icons and the sidebar grow with the text. Verdandi already has it through the View menu, and Chromium keeps it ([#63](https://github.com/chris-metz/verdandi/issues/63)). It is not what [#66](https://github.com/chris-metz/verdandi/issues/66) asks for, but works on top of either option below.

**(b) A larger root font size, spacing pinned to pixels.** Setting `html { font-size }` grows every `rem`. Since Tailwind's spacing is rem too, spacing would grow unless pinned, for example `@theme { --spacing: 4px }` (Tailwind's docs show `--spacing: 1px` as a customization). At the default size this renders exactly as today. Besides the shared work below, it means:

- pinning `--radius` (`index.css:62`) and the five container sizes in use
- deciding the 8 arbitrary rem sizes, and the 3 rem values in `github-markdown.css` (`:141,394,414`)
- converting the 24 pixel text sizes to rem
- converting the 6 pixel font sizes in `github-markdown.css` to rem

`webPreferences.defaultFontSize` would do the same at window creation, but a change would then need a new window.

**(c) A `--text-scale` multiplied into text sizes.** The renderer sets `--text-scale` (`text_size / 14`) on `<html>`, as `showTheme` sets colours (`theme.ts:12-19`). `index.css` overrides the five text tokens in use, e.g. `--text-xs: calc(0.75rem * var(--text-scale))`. The root stays 16 px, so no spacing, radius or container moves and no rem needs auditing. Line heights of the text utilities are unitless and follow. Besides the shared work below, it means:

- giving the 24 pixel text sizes and `text-[0.8rem]` scaled tokens, e.g. three new ones for 10, 11 and 13 px. `Avatar.tsx:21` can stay, since the avatar does not grow.
- `.markdown-body` at `calc(14px * var(--text-scale))`, and the 5 other pixel font sizes in `github-markdown.css` likewise

The scale shrinks and grows the small sizes too. At `text_size = 11`, the low end of [#66](https://github.com/chris-metz/verdandi/issues/66)'s example range, `text-xs` becomes 9.4 px and the 10 px chips 7.9 px; at 20 they become 17.1 px and 14.3 px. If 7.9 px is too small, the range starts higher, or the smallest tokens get a floor with CSS `max()` ([MDN max()](https://developer.mozilla.org/en-US/docs/Web/CSS/max)).

**Shared work, either way:**

1. The 10 fixed line heights in classes, and the 2 in `github-markdown.css` (`:207,558`), become unitless or scaled.
2. The 14 fixed heights around text become minimum heights or heights computed from the text (row height = line height + fixed padding). `scroll-mt-7` must follow the sticky header's new height, e.g. through one shared custom property.
3. The 5 list column widths grow with the text.
4. The blocking map takes the text size as an input. Card width and height, the column title offset, the arrow lane and `y = 64` derive from it in `blocking-layout.ts`. `columnWidth` must grow with the card width, or wider cards eat the gap between columns. [#66](https://github.com/chris-metz/verdandi/issues/66) also sizes the gaps between cards from the text size: ELK's `32` and `64` and the gap inside `columnWidth`, all constants in the same file. The outer `padding` stays. `BlockingMapBand.tsx` lays out again when the text size changes.
5. Optionally, remembered scroll positions are dropped when the text size changes.

**Size.** Option (c) touches about 20 files and roughly 80 sites, almost all class or CSS changes. The blocking map is the only place that needs logic. Option (b) touches the same sites plus the rem audit. Neither changes scroll anchoring or list navigation.

## Recommendations

1. **Listing installed fonts: use `queryLocalFonts()` in the renderer, and order code fonts by a canvas width check.** It needs no new dependency, no native code and no main-process work. It works in Verdandi's sandboxed, context-isolated window today, and lists what Chromium itself can render. Call it while the window is visible and keep the family list; deduplicate faces into families, and add the families the app ships. If Verdandi adds a permission check handler, as Electron's security guide suggests, it must allow `local-fonts` for the app's own page, or the call silently returns an empty list. For "monospace first", the canvas check is fast and found every monospace family here; a misjudged family only moves in the list. Parse `post.isFixedPitch` only if that ordering proves wrong in practice. Avoid `system_profiler` (8.8 s, hidden fonts) and the native modules (last published 2021–22, node-gyp, packaging). Sources: [MDN queryLocalFonts](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts), [MDN FontData](https://developer.mozilla.org/en-US/docs/Web/API/FontData), [Electron session](https://www.electronjs.org/docs/latest/api/session#sessetpermissioncheckhandlerhandler), [Electron permission manager](https://github.com/electron/electron/blob/v44.4.5/shell/browser/electron_permission_manager.cc), [Chromium font access manager](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_access_manager.cc), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security#5-handle-session-permission-requests-from-remote-content), [font-list](https://github.com/oldj/node-font-list), [font-scanner](https://github.com/axosoft/font-scanner).

2. **Checking a font exists: put the default after the chosen family in `font-family`, and check the name against the family list from startup.** CSS then falls back by itself and nothing waits. The check only produces the notice and the picker's "not installed". Compare case-insensitively, and count the families the app ships as installed. At startup, check once the family list arrives; after a change to `config.toml`, check against the kept family list, since the window may be hidden then. Because the family list misses fonts installed after launch, the notice should say to restart Verdandi if the font was installed since. On macOS a canvas measurement can confirm a newly installed font is already usable. Do not use `document.fonts.check()`. The core keeps reading the key and its type; whether the installed check also goes into the core, through the family list the renderer sends it, is a design choice for [#65](https://github.com/chris-metz/verdandi/issues/65). Sources: [MDN font-family](https://developer.mozilla.org/en-US/docs/Web/CSS/font-family), [CSS Fonts 4 §5.1](https://drafts.csswg.org/css-fonts-4/#localized-name-matching), [MDN FontFaceSet.check](https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/check), [CSS Font Loading](https://drafts.csswg.org/css-font-loading/#font-face-set-check), [Electron page visibility](https://www.electronjs.org/docs/latest/api/browser-window#page-visibility), [font_enumeration_cache.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/font_access/font_enumeration_cache.cc), [fontconfig_util.cc](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/ui/gfx/linux/fontconfig_util.cc), [theme_helper_mac.mm](https://chromium.googlesource.com/chromium/src/+/refs/tags/152.0.7977.130/content/browser/theme_helper_mac.mm).

3. **Text size: use a `--text-scale` multiplied into Tailwind's `--text-*` tokens and the Markdown root size (option c), with 14 px as the default.** It keeps the 16 px root, so the 465 spacing uses, radii and containers stay as they are without an audit. The work is option (c)'s own token changes (the 24 pixel text sizes, `text-[0.8rem]` and the Markdown font sizes) plus the shared work above: 12 line heights, 14 fixed heights, 5 column widths, `scroll-mt-7`, and a blocking map that sizes cards, columns and gaps from the text size. Check the range's low end against the 10 px chips. Tests for `blocking-layout.ts` can cover the card sizes at the smallest and largest sizes. Zoom stays as it is and multiplies with the text size. Sources: [Tailwind theme variables](https://tailwindcss.com/docs/theme), [Tailwind font-size](https://tailwindcss.com/docs/font-size), [Tailwind padding](https://tailwindcss.com/docs/padding), [MDN length units](https://developer.mozilla.org/en-US/docs/Web/CSS/length), [Electron webContents zoom](https://www.electronjs.org/docs/latest/api/web-contents#contentssetzoomfactorfactor), [Electron web-preferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences).

**Evidence limits:**

- Observations are dated 2026-10-02, on one Mac with macOS 27.0.1 (Apple silicon) and its installed fonts, with Electron 44.4.5 from the repository's `node_modules`, run in a scratch app outside the repository. They are not from Verdandi itself. A `file://` page, as the packaged app loads, was tested; the dev server origin (`ELECTRON_RENDERER_URL`) was not.
- Linux and Windows were not tested. For them, what `queryLocalFonts()` lists, the native modules, `fc-list` and DirectWrite rest on docs and source reading.
- Read in source, not tested: Chromium's session cache of the font list, the macOS font change notification, fontconfig rescans disabled on Linux, the Windows font proxy's snapshot, and the opaque-origin check on Chromium's main branch. No font was installed during a run.
- The monospace comparisons (CoreText trait, `post` table, canvas widths, `font-list`) cover the 182 families on this Mac only. CoreText is the reference here, and it is itself only a font's own claim.
- The timings come from one to three runs each.
- The class counts come from a script over string literals in the renderer source on 2026-10-02 (commit `adb2d86`), so a class built at runtime from parts would be missed. Line numbers refer to that commit. The compiled forms of `h-8`, `leading-4` and `text-[11px]` were read from the existing build output in `electron/apps/desktop/out/`.
- Options (b) and (c) were not prototyped. The site counts and the card arithmetic are estimates from reading the code.
