export type * from "./contract.ts";
export { createCore, type CoreOptions } from "./core.ts";
export { createGhAdapter, type GhAdapterOptions } from "./github/gh-adapter.ts";
export type { CommandResult, CommandRunner } from "./github/command-runner.ts";
export type {
  AuthStatus,
  GitHubAccess,
  GitHubError,
  GitHubResult,
  Issue,
  IssuePage,
  IssueReference,
  RepositoryAccess,
  RepositorySummary,
  SuggestionPage,
} from "./github/port.ts";
export { runCommand } from "./github/run-command.ts";
export { createConfigFile } from "./settings/config-file.ts";
export { createLocalStateFile } from "./settings/local-state-file.ts";
export { createSettingsFile } from "./settings/settings-file.ts";
export type {
  ConfigStorage,
  LocalState,
  LocalStateStorage,
  Settings,
  SettingsResult,
  SettingsStorage,
  ThemeCatalogue,
} from "./settings/port.ts";
export {
  configDirectory,
  desktopStateDirectory,
  userDataDirectory,
  type HostEnvironment,
} from "./directories.ts";
