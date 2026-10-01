import AppKit
import SwiftUI

/// A command to run in Terminal, selectable, with a button that copies it.
struct CommandField: View {
  var command: GuidanceCommand
  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text(command.label)
        .font(.caption)
        .foregroundStyle(.secondary)
      HStack(spacing: 10) {
        Text("\(Text("$").foregroundStyle(.tertiary)) \(command.command)")
          .font(.system(.callout, design: .monospaced))
          .textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
        Button {
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(command.command, forType: .string)
          copied = true
        } label: {
          Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
            .labelStyle(.iconOnly)
            .contentTransition(.symbolEffect(.replace))
            .foregroundStyle(copied ? AnyShapeStyle(.green) : AnyShapeStyle(.secondary))
            .frame(width: 18, height: 18)
        }
        .buttonStyle(.borderless)
        .help("Copy")
        .accessibilityLabel("Copy \(command.command)")
      }
      .padding(.leading, 12)
      .padding(.trailing, 8)
      .padding(.vertical, 8)
      .background(.background.secondary.opacity(0.7), in: .rect(cornerRadius: 10))
      .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator, lineWidth: 0.5))
    }
    .task(id: copied) {
      guard copied else { return }
      try? await Task.sleep(for: .seconds(1.5))
      copied = false
    }
  }
}
