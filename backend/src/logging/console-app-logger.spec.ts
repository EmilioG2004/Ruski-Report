import { createLogEntry } from "./console-app-logger";

describe("createLogEntry", () => {
  it("creates structured log entries with workflow context", () => {
    const error = new Error("private-canary-validation-message");
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
        name: "Error"
      },
      metadata: {
        sheet: "Blank Scorecard"
      }
    });
    expect(entry.timestamp).toEqual(expect.any(String));
    expect(JSON.stringify(entry)).not.toContain("private-canary");
  });

  it("normalizes an unsafe error name without serializing its message or stack", () => {
    const error = new Error("private-canary-error-message");
    error.name = "private-canary name";
    error.stack = "private-canary-stack";

    const entry = createLogEntry("error", "Request failed.", { error });

    expect(entry.error).toEqual({ name: "Error" });
    expect(JSON.stringify(entry)).not.toContain("private-canary");
  });
});
