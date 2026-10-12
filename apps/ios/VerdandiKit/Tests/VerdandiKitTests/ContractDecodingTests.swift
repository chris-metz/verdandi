import Foundation
import Testing

@testable import VerdandiKit

private func decode<T: Decodable>(_ type: T.Type, _ text: String) throws -> T {
    try JSONDecoder().decode(type, from: Data(text.utf8))
}

@Suite struct ReadingTheContract {
    // A tag the contract does not have means the core and these types have
    // drifted apart: read as some other case, it would go unseen.
    @Test func rejectsATagTheContractDoesNotHave() {
        #expect(throws: DecodingError.self) { try decode(OpenIssueCount.self, #"{"status":"counted","count":3}"#) }
        #expect(throws: DecodingError.self) {
            try decode(LoadingState.self, #"{"status":"outdated","updatedAt":1,"problem":{"kind":"interrupted"}}"#)
        }
        #expect(throws: DecodingError.self) { try decode(Problem.self, #"{"kind":"offline","message":"No"}"#) }
        #expect(throws: DecodingError.self) { try decode(Setup.self, #"{"status":"waiting"}"#) }
        #expect(throws: DecodingError.self) { try decode(BlockingEnd.self, #"{"kind":"nothing"}"#) }
    }

    @Test func readsEveryTagItHas() throws {
        #expect(try decode(OpenIssueCount.self, #"{"status":"loading"}"#) == .loading)
        #expect(try decode(Setup.self, #"{"status":"checking"}"#) == .checking)
        #expect(try decode(BlockingEnd.self, #"{"kind":"none"}"#) == BlockingEnd.none)
        #expect(
            try decode(Problem.self, #"{"kind":"error","message":"Broken"}"#) == .error(message: "Broken"))
    }
}
