import { createLogEntry } from "./console-app-logger";

describe("createLogEntry", () => {
  it("creates structured log entries with workflow context", () => {
    const error = new Error("Validation failed");
    const entry = createLogEntry("warning", "Scorebook validation failed", {
      component: "ScorebookIngestionService",
      operation: "validateScorebook",
      requestId: "request-1",
      gameType: "ruski",
      tournamentId: "tournament-2026",
      uploadId: "upload-1",
      error,
      metadata: {
        sheet: "Blank Scorecard"
      }
    });

    expect(entry).toMatchObject({
      level: "warning",
      message: "Scorebook validation failed",
      component: "ScorebookIngestionService",
      operation: "validateScorebook",
      requestId: "request-1",
      gameType: "ruski",
      tournamentId: "tournament-2026",
      uploadId: "upload-1",
      error: {
        name: "Error",
        message: "Validation failed"
      },
      metadata: {
        sheet: "Blank Scorecard"
      }
    });
    expect(entry.timestamp).toEqual(expect.any(String));
  });
});
