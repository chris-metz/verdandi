import SwiftUI
import VerdandiKit

/// An issue's or a comment's body, as GitHub renders it to HTML: untrusted,
/// so it is shown without its scripts. As tall as its content, so that it
/// scrolls with the page. (A placeholder, to be built: it shows the text
/// only.)
struct BodyHTMLView: View {
    /// GitHub's HTML for the body.
    var html: String
    /// The issue whose page shows it.
    var issueId: String
    /// The issue's ID for its body, or the comment's for a comment's.
    var bodyId: String

    var body: some View {
        Text(
            html.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
