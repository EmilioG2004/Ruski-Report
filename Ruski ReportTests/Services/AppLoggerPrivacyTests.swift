import Testing
@testable import Ruski_Report

struct AppLoggerPrivacyTests {
    @Test func stripsErrorsIdentifiersURLsAndUnsafeMessages() {
        let payload = sanitizedAppLogPayload(
            message: "Unable to load match detail",
            metadata: [
                "error": "private-canary-error",
                "matchId": "private-match-id",
                "operation": "history_discovery",
                "url": "https://example.invalid/private"
            ]
        )

        #expect(payload.message == "Unable to load match detail")
        #expect(payload.metadataDescription == "operation=history_discovery")

        let unsafe = sanitizedAppLogPayload(
            message: "password=private-canary",
            metadata: [:]
        )
        #expect(unsafe.message == "Application event")
    }
}
