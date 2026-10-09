import SwiftUI
import VerdandiKit

/// Signing in to GitHub, until the app has a token GitHub accepts.
struct SignInView: View {
    @Environment(AppModel.self) private var model
    let problem: SetupProblem
    @State private var token = ""
    @State private var error: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("Sign in to GitHub").font(.largeTitle.bold())
            SecureField("Personal access token", text: $token)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 420)
            if let error { Text(error).foregroundStyle(.red) }
            Button("Sign In") {
                Task {
                    do { try await model.signIn(token: token) } catch { self.error = error.localizedDescription }
                }
            }
            .buttonStyle(.glassProminent)
            .disabled(token.isEmpty)
        }
        .padding()
    }
}
