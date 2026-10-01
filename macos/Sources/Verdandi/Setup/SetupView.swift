import AppKit
import SwiftUI
import VerdandiCore

/// What the window shows until Verdandi can reach GitHub through gh: a
/// welcome card over a soft backdrop, saying what is missing and how to fix
/// it in Terminal. It checks again by itself as Verdandi becomes active
/// again, e.g. after signing in in Terminal.
struct SetupView: View {
  @Environment(AppModel.self) private var model
  /// The last state other than a check, shown while checking again, so the
  /// card does not jump.
  @State private var shown: SetupState?
  /// Why the gh the user chose cannot be used.
  @State private var rejectedChoice: UnusableGh?
  @State private var choosing = false

  var body: some View {
    GeometryReader { proxy in
      ScrollView {
        card
          .padding(24)
          .frame(maxWidth: .infinity)
          .frame(minHeight: proxy.size.height)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .background { SetupBackdrop().ignoresSafeArea() }
    .toolbar(removing: .title)
    .toolbarBackgroundVisibility(.hidden, for: .windowToolbar)
    .onChange(of: model.setup, initial: true) {
      if model.setup != .checking { shown = model.setup }
    }
    .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
      checkAgain()
    }
  }

  private var displayed: SetupState {
    model.setup == .checking ? shown ?? .checking : model.setup
  }

  private var isChecking: Bool { model.setup == .checking || choosing }

  private var card: some View {
    VStack(spacing: 24) {
      header
      if let guidance = SetupGuidance(displayed) {
        problem(guidance)
          .transition(.opacity.combined(with: .scale(scale: 0.98)))
      } else {
        HStack(spacing: 10) {
          ProgressView().controlSize(.small)
          Text("Looking for GitHub CLI…").foregroundStyle(.secondary)
        }
        .frame(height: 44)
        .transition(.opacity)
      }
    }
    .padding(.horizontal, 40)
    .padding(.vertical, 32)
    .frame(width: 560)
    .glassEffect(.regular, in: .rect(cornerRadius: 34))
    .animation(.smooth(duration: 0.35), value: displayed)
    .animation(.smooth(duration: 0.35), value: rejectedChoice)
  }

  private var header: some View {
    VStack(spacing: 10) {
      Image(nsImage: NSApp.applicationIconImage)
        .resizable()
        .interpolation(.high)
        .frame(width: 96, height: 96)
        .shadow(color: .black.opacity(0.18), radius: 12, y: 7)
        .accessibilityHidden(true)
      Text(model.settings.repositories.isEmpty ? "Welcome to Verdandi" : "Welcome Back to Verdandi")
        .font(.system(size: 30, weight: .bold))
        .padding(.top, 4)
      Text("Your GitHub issues across every repository, with their sub-issues and what blocks them — a keystroke away.")
        .font(.title3)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }
  }

  private func problem(_ guidance: SetupGuidance) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      Label {
        Text(guidance.title).font(.title3.weight(.semibold))
      } icon: {
        Image(systemName: guidance.symbol)
          .foregroundStyle(guidance.tint)
          .symbolRenderingMode(.hierarchical)
          .symbolEffect(.bounce, value: guidance.title)
      }
      .font(.title3)

      ForEach(guidance.explanation, id: \.self) { paragraph in
        Text(paragraph)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      if let detail = guidance.detail {
        Text(detail)
          .font(.callout.monospaced())
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(10)
          .background(.background.secondary.opacity(0.5), in: .rect(cornerRadius: 10))
      }

      ForEach(guidance.commands, id: \.self) { CommandField(command: $0) }

      if case .ghMissing(let unusable) = displayed {
        if !unusable.isEmpty { UnusableGhList(unusable: unusable) }
        DisclosureGroup("gh works in Terminal?") {
          VStack(alignment: .leading, spacing: 10) {
            Text(
              "Apps opened from the Dock or the Finder may not look where your shell does. Find gh in Terminal, then choose that file with Choose gh…."
            )
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            CommandField(command: GuidanceCommand(label: "Find gh", command: "command -v gh"))
          }
          .padding(.top, 8)
        }
      }

      if let rejectedChoice {
        ChoiceProblem(problem: rejectedChoice)
          .transition(.opacity.combined(with: .move(edge: .top)))
      }

      if let gh = model.gh, !guidance.choosesGh {
        Text("Using GitHub CLI \(gh.version) at \(gh.url.path.abbreviatingHome)")
          .font(.caption)
          .foregroundStyle(.tertiary)
          .textSelection(.enabled)
      }

      actions(guidance)
        .padding(.top, 4)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func actions(_ guidance: SetupGuidance) -> some View {
    HStack(spacing: 10) {
      if let link = guidance.link {
        Link(destination: link.url) {
          HStack(spacing: 3) {
            Text(link.title)
            Image(systemName: "arrow.up.forward").font(.caption.weight(.semibold))
          }
        }
        .font(.callout)
      }
      Spacer(minLength: 0)
      if guidance.choosesGh {
        checkAgainButton.buttonStyle(.glass)
        chooseButton.buttonStyle(.glassProminent).keyboardShortcut(.defaultAction)
      } else {
        checkAgainButton.buttonStyle(.glassProminent).keyboardShortcut(.defaultAction)
      }
    }
    .controlSize(.large)
    .disabled(isChecking)
  }

  private var checkAgainButton: some View {
    Button {
      rejectedChoice = nil
      Task { await model.checkSetup() }
    } label: {
      if model.setup == .checking {
        HStack(spacing: 6) {
          ProgressView().controlSize(.mini)
          Text("Checking…")
        }
      } else {
        Text("Check Again")
      }
    }
  }

  private var chooseButton: some View {
    Button("Choose gh…") {
      Task {
        choosing = true
        rejectedChoice = await chooseGhExecutable(for: model)
        choosing = false
      }
    }
  }

  /// Checks again as Verdandi becomes active, unless it works, is being
  /// checked, or shows a made-up state for a screenshot.
  private func checkAgain() {
    guard !LaunchOptions.pretendsSetup, !isChecking else { return }
    if case .ready = model.setup { return }
    Task { await model.checkSetup() }
  }
}

/// The gh executables found that cannot be used, each with why.
private struct UnusableGhList: View {
  var unusable: [UnusableGh]

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Found, but not usable")
        .font(.callout.weight(.medium))
      ForEach(unusable, id: \.self) { gh in
        HStack(alignment: .firstTextBaseline, spacing: 8) {
          Image(systemName: "xmark.circle.fill")
            .foregroundStyle(.red.opacity(0.85))
            .accessibilityHidden(true)
          VStack(alignment: .leading, spacing: 2) {
            Text(gh.url.path.abbreviatingHome)
              .font(.callout.monospaced())
              .textSelection(.enabled)
            Text(gh.reason)
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
        .font(.caption)
      }
    }
  }
}

/// Why the file the user chose cannot be used as gh.
struct ChoiceProblem: View {
  var problem: UnusableGh

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 3) {
        Text("This file can’t be used as gh").fontWeight(.medium)
        Text(problem.reason).foregroundStyle(.secondary)
        Text(problem.url.path.abbreviatingHome)
          .font(.caption.monospaced())
          .foregroundStyle(.secondary)
          .textSelection(.enabled)
      }
      .fixedSize(horizontal: false, vertical: true)
    } icon: {
      Image(systemName: "exclamationmark.octagon.fill").foregroundStyle(.red)
    }
    .font(.callout)
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(12)
    .background(.red.opacity(0.08), in: .rect(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(.red.opacity(0.25), lineWidth: 0.5))
  }
}

extension String {
  /// A path with the home folder as `~`.
  var abbreviatingHome: String { (self as NSString).abbreviatingWithTildeInPath }
}
