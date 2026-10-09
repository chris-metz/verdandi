import SwiftUI
import VerdandiKit

/// A list's label filter, floating in glass at the bottom of the list: a
/// chip per label, tinted in its colour, which removes it, and Clear, which
/// removes them all. The list scrolls on under it. The chips morph in and
/// out as labels come and go.
struct LabelFilterBar: View {
    @Environment(\.palette) private var palette
    var labels: [IssueLabel]
    var remove: (IssueLabel) -> Void
    var clear: () -> Void
    @Namespace private var namespace

    var body: some View {
        GlassEffectContainer(spacing: 8) {
            HStack(spacing: 8) {
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(labels) { label in
                            chip(label)
                                .glassEffectID(label.id, in: namespace)
                        }
                    }
                    .padding(.horizontal, 2)
                    .padding(.vertical, 4)
                }
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
                Button("Clear", action: clear)
                    .font(.subheadline.weight(.medium))
                    .buttonStyle(.glass)
                    .keyboardShortcut(.escape, modifiers: [])
                    .glassEffectID("clear", in: namespace)
                    .accessibilityLabel("Clear label filter")
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        .animation(.bouncy, value: labels)
    }

    private func chip(_ label: IssueLabel) -> some View {
        Button {
            remove(label)
        } label: {
            HStack(spacing: 6) {
                Circle()
                    .fill(label.swatch)
                    .overlay(Circle().strokeBorder(palette.foreground.opacity(0.2), lineWidth: 0.5))
                    .frame(width: 9, height: 9)
                Text(label.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(palette.foreground)
                    .lineLimit(1)
                Image(systemName: "xmark")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(palette.muted)
            }
            .padding(.leading, 10)
            .padding(.trailing, 9)
            .padding(.vertical, 7)
            .contentShape(.capsule)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(label.swatch.opacity(0.25)).interactive(), in: .capsule)
        .hoverEffect(.highlight)
        .accessibilityLabel("Remove \(label.name) from the label filter")
    }
}
