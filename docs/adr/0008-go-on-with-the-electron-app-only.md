# Go on with the Electron app only

Verdandi goes on as the Electron app in `electron/` alone ([ADR 0001](0001-typescript-electron-stack.md)), and the native macOS app tried beside it is dropped. This supersedes [ADR 0006](0006-try-a-native-macos-app-beside-electron.md). Both things that decision named for the choice speak for Electron: it serves Windows and Linux as well as macOS, which the macOS app cannot, and its TypeScript core is covered by far more tests than the Swift port and handles cases the port does not. Two apps meant two cores that nothing kept in step.

## Consequences

- `macos/` is removed. Its last state is at the tag `macos-app-final`, should a native app be tried again.
- An issue no longer names an app: the `electron` and `macos` labels are gone, and the open `macos` issues are closed as not planned.
