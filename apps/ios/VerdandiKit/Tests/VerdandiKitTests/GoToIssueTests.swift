import Testing

@testable import VerdandiKit

private let api = RepositoryAddress(owner: "acme", name: "api")

@Suite struct ReadingTheGoToIssueField {
    @Test func takesANumberInTheRepositoryOnScreen() {
        #expect(IssueLocator(parsing: "#12") == IssueLocator(repository: nil, number: 12))
        #expect(IssueLocator(parsing: " 7 ") == IssueLocator(repository: nil, number: 7))
    }

    @Test(arguments: ["acme/api#12", "acme/api 12", "acme/api #12", " acme/api#12 "])
    func takesOwnerNameAndANumber(_ text: String) {
        #expect(IssueLocator(parsing: text) == IssueLocator(repository: api, number: 12))
    }

    @Test func takesDotsDashesAndUnderscores() {
        #expect(
            IssueLocator(parsing: "my-org/web.site_2#3")
                == IssueLocator(repository: RepositoryAddress(owner: "my-org", name: "web.site_2"), number: 3))
    }

    @Test(arguments: [
        "https://github.com/acme/api/issues/12",
        "https://github.com/acme/api/issues/12#issuecomment-99",
        "https://www.github.com/acme/api/issues/12/",
    ])
    func takesALinkToAnIssueOnGitHub(_ text: String) {
        #expect(IssueLocator(parsing: text) == IssueLocator(repository: api, number: 12))
    }

    @Test(arguments: [
        "", "#", "abc", "12a", "1.5", "-3", "0", "##12", "acme/api", "acme/api#", "acme#12", "a/b/c#12",
        "https://github.com/acme/api/pull/12",
        "https://example.com/acme/api/issues/12",
        "http://github.com/acme/api/issues/12",
        "ä/b#1",
    ])
    func takesNothingElse(_ text: String) {
        #expect(IssueLocator(parsing: text) == nil)
    }

    @Test func takesNoNumberGitHubCouldNotHave() {
        #expect(IssueLocator(parsing: "2147483647")?.number == 2_147_483_647)
        #expect(IssueLocator(parsing: "2147483648") == nil)
        #expect(IssueLocator(parsing: "acme/api#2147483648") == nil)
        #expect(IssueLocator(parsing: "99999999999999999999999") == nil)
    }
}

/// A recent issue, by `owner/name#12`.
private func recent(_ reference: String, _ title: String? = nil) -> RecentIssue {
    let parts = reference.split(separator: "#")
    let repository = RepositoryAddress(parsing: String(parts[0]))!
    return RecentIssue(
        id: "I_\(reference)", repository: repository, number: Int(parts[1])!, title: title ?? "Issue \(reference)")
}

@Suite struct WhatGoToIssueOffers {
    let recents = [
        recent("acme/api#3", "Crash on start"),
        recent("acme/web#12", "Slow page"),
        recent("acme/api#12", "Login fails"),
    ]

    @Test func offersEveryRecentIssueWhileNothingIsTyped() {
        let choices = GoToChoices("", from: nil, recents: recents)
        #expect(choices.destinations == recents.map(GoToDestination.recent))
        #expect(choices.hint == nil)
    }

    @Test func offersTheIssueTypedFirstThenTheRecentIssuesMatching() {
        #expect(
            GoToChoices("acme/web#1", from: nil, recents: recents).destinations == [
                .lookUp(RepositoryAddress(owner: "acme", name: "web"), number: 1), .recent(recents[1]),
            ])
        #expect(GoToChoices("CRASH", from: nil, recents: recents).destinations == [.recent(recents[0])])
    }

    @Test func offersARecentIssueTypedAsThatRecentIssueOnce() {
        #expect(GoToChoices("#12", from: api, recents: recents).destinations == [.recent(recents[2]), .recent(recents[1])])
        #expect(
            GoToChoices("https://github.com/ACME/API/issues/3", from: nil, recents: recents).destinations == [
                .recent(recents[0])
            ])
    }

    @Test func hasABareNumberNameTheRepositoryOnScreen() {
        let choices = GoToChoices("#4", from: api, recents: [])
        #expect(choices.destinations == [.lookUp(api, number: 4)])
        #expect(choices.hint == nil)
    }

    @Test func saysOwnerNameIsNeededWithoutARepositoryOnScreen() {
        let choices = GoToChoices("#4", from: nil, recents: [])
        #expect(choices.destinations.isEmpty)
        #expect(choices.hint == "#4 names an issue only within a repository: choose one in the sidebar, or type owner/name#4.")
    }

    @Test func saysWhatItTakesWhenWhatIsTypedNamesNoIssue() {
        #expect(GoToChoices("nothing", from: api, recents: recents).hint == "Type #12, owner/name#12 or a link to an issue on GitHub.")
        #expect(GoToChoices("nothing", from: nil, recents: recents).hint == "Type owner/name#12 or a link to an issue on GitHub.")
    }

    @Test func linksARecentIssueToItsPage() {
        #expect(recents[2].url == "https://github.com/acme/api/issues/12")
    }
}
