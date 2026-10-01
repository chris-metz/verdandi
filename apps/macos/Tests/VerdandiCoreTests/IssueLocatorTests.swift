import Testing

@testable import VerdandiCore

@Test(arguments: [
  ("chris-metz/verdandi#12", "chris-metz/verdandi", 12),
  ("chris-metz/verdandi #12", "chris-metz/verdandi", 12),
  ("chris-metz/verdandi 12", "chris-metz/verdandi", 12),
  ("  cli/cli#9000  ", "cli/cli", 9000),
  ("https://github.com/cli/cli/issues/42", "cli/cli", 42),
  ("https://github.com/cli/cli/issues/42#issuecomment-7", "cli/cli", 42),
  ("github.com/cli/cli/issues/42/", "cli/cli", 42),
  ("https://www.GitHub.com/cli/cli/pull/7?tab=files", "cli/cli", 7),
])
func readsQualifiedIssues(text: String, repository: String, number: Int) throws {
  let locator = try #require(IssueLocator(parsing: text))
  #expect(locator.repository == RepositoryAddress(repository))
  #expect(locator.number == number)
}

@Test(arguments: ["#12", "12", " #12 "])
func readsBareNumbers(text: String) throws {
  let locator = try #require(IssueLocator(parsing: text))
  #expect(locator.repository == nil)
  #expect(locator.number == 12)
  #expect(locator.description == "#12")
}

@Test(arguments: [
  "", "#", "0", "#0", "-3", "abc", "cli/cli", "cli/cli#", "cli#12", "a/b/c#12",
  "https://github.com/cli/cli", "https://gitlab.com/cli/cli/issues/1", "99999999999",
])
func rejectsWhatNamesNoIssue(text: String) {
  #expect(IssueLocator(parsing: text) == nil)
}
