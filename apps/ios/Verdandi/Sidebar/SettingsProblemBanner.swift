import SwiftUI
import VerdandiKit

/// Why repositories and views cannot be changed: the settings file is
/// invalid, or from a newer Verdandi. The sidebar keeps showing what it last
/// read and changes nothing until the file can be written again. Reload
/// reads it again; Reset, only for an invalid file, keeps it as a dated
/// backup and starts empty, once confirmed.
struct SettingsProblemBanner: View {
    @Environment(AppModel.self) private var model
    @Environment(\.palette) private var palette
    var status: SettingsStatus
    @State private var busy = false
    @State private var resetAsked = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.warning)
            Text(message)
                .font(.footnote)
                .foregroundStyle(palette.foreground)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
            Text(invalid ? "Changes are off until it is fixed. Reset keeps a backup and starts empty." : "Changes are off until it is fixed.")
                .font(.footnote)
                .foregroundStyle(palette.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                Button("Reload", systemImage: "arrow.clockwise") {
                    run { await SidebarActions(model: model).reloadSettings() }
                }
                if invalid {
                    Button("Reset…", systemImage: "arrow.counterclockwise", role: .destructive) { resetAsked = true }
                        .tint(palette.destructive)
                }
            }
            .buttonStyle(.glass)
            .controlSize(.small)
            .disabled(busy)
            .padding(.top, 2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.warning.opacity(0.12), in: .rect(cornerRadius: 14))
        .confirmationDialog("Reset the settings?", isPresented: $resetAsked, titleVisibility: .visible) {
            Button("Reset", role: .destructive) {
                run { await SidebarActions(model: model).resetSettings() }
            }
        } message: {
            Text(
                "settings.json is kept as a dated backup beside it, and Verdandi starts with no tracked repositories and no views."
            )
        }
    }

    private var invalid: Bool {
        if case .invalid = status { return true }
        return false
    }

    private var title: String {
        invalid ? "settings.json can’t be read" : "settings.json is from a newer Verdandi"
    }

    private var message: String {
        switch status {
        case .writable: ""
        case .invalid(let message), .newerVersion(let message): message
        }
    }

    private func run(_ action: @escaping () async -> Void) {
        busy = true
        Task {
            await action()
            busy = false
        }
    }
}
