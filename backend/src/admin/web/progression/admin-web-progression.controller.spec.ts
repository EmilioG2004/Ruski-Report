import { loadAdministratorAuthConfig } from "../../../config/admin-auth.config";
import { AppError } from "../../../errors";
import {
  AdministratorSecurityAuditService,
  AdministratorSecurityService
} from "../../security";
import { AdminWebResponse } from "../admin-web.types";
import { AdminWebTournamentProgressionController } from "./admin-web-progression.controller";

describe("administrator progression web controller", () => {
  it("rate-gates bracket publication and uses PRG after success", async () => {
    const progression = {
      publishBracket: jest.fn().mockResolvedValue({})
    };
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityService;
    const audit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const controller = new AdminWebTournamentProgressionController(
      progression as never,
      security,
      audit,
      CONFIG
    );
    const response = responseRecorder();

    await controller.publishBracket(
      TOURNAMENT_ID,
      {
        _csrf: "csrf-token",
        expectedTournamentRowVersion: "5",
        confirmationDigest: "a".repeat(64)
      },
      PRINCIPAL,
      request(),
      response
    );

    expect(security.enforceSensitiveOperatorAction).toHaveBeenCalledWith({
      action: "tournament_progression_bracket_publish",
      targetType: "tournament",
      targetId: TOURNAMENT_ID
    }, PRINCIPAL, expect.any(Object));
    expect(progression.publishBracket).toHaveBeenCalledWith(
      TOURNAMENT_ID,
      {
        expectedTournamentRowVersion: 5,
        confirmationDigest: "a".repeat(64)
      },
      PRINCIPAL
    );
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      `/api/admin/app/tournaments/${TOURNAMENT_ID}/progression?notice=bracket-published`
    );
  });

  it("audits rejected previews without recording the operator reason", async () => {
    const progression = {
      get: jest.fn().mockResolvedValue({}),
      previewMatchResolution: jest.fn().mockRejectedValue(new AppError({
        code: "CONFLICT",
        message: "Progression changed.",
        statusCode: 409,
        details: [{ code: "PROGRESSION_CONFLICT", message: "Retry." }]
      }))
    };
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityService;
    const audit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const controller = new AdminWebTournamentProgressionController(
      progression as never,
      security,
      audit,
      CONFIG
    );
    const sensitiveReason = "private operational reason";

    await expect(controller.previewMatch(
      TOURNAMENT_ID,
      {
        _csrf: "csrf-token",
        matchId: uuid(9),
        expectedTournamentRowVersion: "5",
        expectedMatchRowVersion: "2",
        commandType: "cancel",
        reason: sensitiveReason
      },
      PRINCIPAL,
      request(),
      responseRecorder()
    )).rejects.toThrow("Progression changed");

    expect(audit.recordEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "administrator_web_command",
      outcome: "rejected",
      reasonCode: "PROGRESSION_CONFLICT",
      targetType: "tournament",
      targetId: TOURNAMENT_ID,
      details: { command: "match_resolution_preview" }
    }));
    expect(JSON.stringify((audit.recordEvent as jest.Mock).mock.calls))
      .not.toContain(sensitiveReason);
  });
});

const CONFIG = loadAdministratorAuthConfig({
  NODE_ENV: "test",
  ADMIN_AUTH_SECURITY_SECRET: "test-only-administrator-security-secret"
});

const TOURNAMENT_ID = uuid(1);
const PRINCIPAL = {
  administratorId: uuid(2),
  loginName: "operator",
  displayName: "Operator",
  sessionId: uuid(3),
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2027-01-02T00:00:00.000Z"
};

function request() {
  return {
    headers: {
      cookie: `${CONFIG.csrfCookieName}=csrf-token`,
      "user-agent": "sanitized-test-agent",
      "x-request-id": "request-1"
    },
    ip: "192.0.2.10"
  };
}

function responseRecorder(): AdminWebResponse & {
  redirect: jest.Mock;
} {
  return {
    append: jest.fn(),
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn(),
    redirect: jest.fn(),
    setHeader: jest.fn()
  };
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
