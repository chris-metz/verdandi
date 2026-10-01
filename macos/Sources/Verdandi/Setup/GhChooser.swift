import AppKit
import VerdandiCore

/// Asks the user for the gh executable to use, in a sheet on the key
/// window, and hands it to the model. Returns why the file chosen cannot be
/// used, or `nil` once it is used or nothing was chosen.
func chooseGhExecutable(for model: AppModel) async -> UnusableGh? {
  let panel = NSOpenPanel()
  panel.title = "Choose GitHub CLI"
  panel.message = "Choose the gh executable for Verdandi to use. In Terminal, “command -v gh” says where yours is."
  panel.prompt = "Use This gh"
  panel.canChooseFiles = true
  panel.canChooseDirectories = false
  panel.allowsMultipleSelection = false
  // Version managers such as mise keep gh in hidden folders.
  panel.showsHiddenFiles = true
  panel.treatsFilePackagesAsDirectories = true
  panel.directoryURL = model.gh?.url.deletingLastPathComponent() ?? URL(fileURLWithPath: "/opt/homebrew/bin")
  let response =
    if let window = NSApp.keyWindow {
      await panel.beginSheetModal(for: window)
    } else {
      panel.runModal()
    }
  guard response == .OK, let url = panel.url else { return nil }
  return await model.chooseGh(url)
}
