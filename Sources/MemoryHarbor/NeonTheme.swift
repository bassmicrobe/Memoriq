import SwiftUI

enum NeonTheme {
    static let background = Color(red: 13 / 255, green: 15 / 255, blue: 20 / 255)
    static let surface = Color(red: 21 / 255, green: 24 / 255, blue: 32 / 255)
    static let line = Color(red: 46 / 255, green: 51 / 255, blue: 65 / 255)
    static let text = Color(red: 241 / 255, green: 243 / 255, blue: 248 / 255)
    static let muted = Color(red: 163 / 255, green: 170 / 255, blue: 187 / 255)
    static let lime = Color(red: 203 / 255, green: 255 / 255, blue: 94 / 255)
    static let lilac = Color(red: 179 / 255, green: 157 / 255, blue: 255 / 255)
    static let amber = Color(red: 255 / 255, green: 202 / 255, blue: 118 / 255)
    static let rose = Color(red: 255 / 255, green: 137 / 255, blue: 161 / 255)

    static func bytes(_ value: UInt64) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(clamping: value), countStyle: .binary)
    }

    static func pressureColor(_ value: String) -> Color {
        switch value {
        case "normal": lime
        case "warning": amber
        case "critical": rose
        default: muted
        }
    }
}

struct MemoriqMark: View {
    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            Capsule().fill(NeonTheme.lime).frame(width: 5, height: 16)
            Capsule().fill(NeonTheme.lime).frame(width: 5, height: 30)
            Capsule().fill(NeonTheme.lilac).frame(width: 5, height: 22)
        }
        .frame(width: 42, height: 44)
        .background(NeonTheme.surface, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(NeonTheme.line))
        .accessibilityHidden(true)
    }
}

struct NeonButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    var prominent = false
    var compact = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: compact ? 11 : 13, weight: .semibold))
            .padding(.horizontal, compact ? 10 : 14)
            .padding(.vertical, compact ? 7 : 12)
            .foregroundStyle(prominent ? NeonTheme.background : NeonTheme.text)
            .background(prominent ? NeonTheme.lime : NeonTheme.surface,
                        in: RoundedRectangle(cornerRadius: 8))
            .overlay(RoundedRectangle(cornerRadius: 8)
                .strokeBorder(prominent ? NeonTheme.lime : NeonTheme.line))
            .opacity(isEnabled ? (configuration.isPressed ? 0.75 : 1) : 0.45)
            .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}
