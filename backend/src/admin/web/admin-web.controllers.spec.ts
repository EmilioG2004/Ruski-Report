import { ArgumentsHost } from "@nestjs/common";

import { loadAdministratorAuthConfig } from "../../config/admin-auth.config";
import { AppError } from "../../errors";
import {
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService
} from "../security";
import { AdminTournamentSetupService } from "../tournament-setup";
import { AdminWebAuthenticationController } from "./admin-web-auth.controller";
import { AdministratorWebExceptionFilter } from "./admin-web.errors";
import { AdminWebTournamentsController } from "./admin-web-tournaments.controller";
import { AdminWebRequest, AdminWebResponse } from "./admin-web.types";

describe("administrator web controllers", () => {
  it("sets opaque cookies and redirects after sign in without rendering tokens", async () => {
    const security = {
      login: jest.fn().mockResolvedValue({
        principal: PRINCIPAL,
        rawSessionToken: "raw-session",
        rawCsrfToken: "raw-csrf"
      })
    } as unknown as AdministratorSecurityService;
    const controller = new AdminWebAuthenticationController(security, CONFIG);
    const response = responseRecorder();

    await controller.signIn({
      _csrf: "preauth-csrf",
      loginName: "operator",
      password: "correct horse battery staple"
    }, request(), response);

    expect(security.login).toHaveBeenCalledWith({
      loginName: "operator",
      password: "correct horse battery staple"
    }, expect.any(Object));
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "/api/admin/app/tournaments"
    );
    expect(response.cookies.join(" ")).toContain("raw-session");
    expect(response.body).toBe("");
  });

  it("does not reflect a rejected invitation token or password", async () => {
    const security = {
      acceptInvitation: jest.fn().mockRejectedValue(new AppError({
        code: "BAD_REQUEST",
        message: "The administrator token is invalid or no longer available.",
        statusCode: 400,
        details: [{ path: "token", message: "Invitation is unavailable." }]
      }))
    } as unknown as AdministratorSecurityService;
    const controller = new AdminWebAuthenticationController(security, CONFIG);
    const response = responseRecorder();

    await controller.acceptInvitation({
      _csrf: "preauth-csrf",
      token: "raw-secret-invitation-token-value",
      password: "raw-secret-password"
    }, request(), response);

    expect(response.body).not.toContain("raw-secret-invitation-token-value");
    expect(response.body).not.toContain("raw-secret-password");
    expect(response.body).toContain("Invitation is unavailable.");
    expect(response.statusCode).toBe(400);
  });

  it("completes recovery then redirects to a non-secret sign-in status", async () => {
    const security = {
      completeRecovery: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityService;
    const controller = new AdminWebAuthenticationController(security, CONFIG);
    const response = responseRecorder();

    await controller.completeRecovery({
      _csrf: "preauth-csrf",
      token: "raw-secret-recovery-token-value",
      password: "raw-secret-new-password"
    }, request(), response);

    expect(security.completeRecovery).toHaveBeenCalledWith({
      token: "raw-secret-recovery-token-value",
      password: "raw-secret-new-password"
    }, expect.any(Object));
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "/api/admin/app/sign-in?recovered=1"
    );
    expect(response.body).toBe("");
    expect(JSON.stringify(response.redirect.mock.calls)).not.toContain(
      "raw-secret-recovery-token-value"
    );
  });

  it("never reflects rejected recovery credentials", async () => {
    const security = {
      completeRecovery: jest.fn().mockRejectedValue(new AppError({
        code: "BAD_REQUEST",
        message: "The recovery token is invalid or no longer available.",
        statusCode: 400,
        details: [{ path: "token", message: "Recovery is unavailable." }]
      }))
    } as unknown as AdministratorSecurityService;
    const controller = new AdminWebAuthenticationController(security, CONFIG);
    const response = responseRecorder();

    await controller.completeRecovery({
      _csrf: "preauth-csrf",
      token: "raw-secret-recovery-token-value",
      password: "raw-secret-new-password"
    }, request(), response);

    expect(response.body).not.toContain("raw-secret-recovery-token-value");
    expect(response.body).not.toContain("raw-secret-new-password");
    expect(response.body).toContain("Recovery is unavailable.");
  });

  it("redirects unauthorized protected-page failures to sign in", () => {
    const response = responseRecorder();
    const host = {
      switchToHttp: () => ({
        getRequest: () => request(),
        getResponse: () => response
      })
    } as unknown as ArgumentsHost;
    new AdministratorWebExceptionFilter().catch(new AppError({
      code: "UNAUTHORIZED",
      message: "Sign in.",
      statusCode: 401
    }), host);
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      "/api/admin/app/sign-in"
    );
  });

  it("never logs exception secrets or URL query values", () => {
    const response = responseRecorder();
    const filter = new AdministratorWebExceptionFilter();
    const logger = (filter as unknown as {
      logger: { error: jest.Mock };
    }).logger;
    jest.spyOn(logger, "error").mockImplementation(() => undefined);
    const host = {
      switchToHttp: () => ({
        getRequest: () => request({
          "x-request-id": "123e4567-e89b-42d3-a456-426614174000"
        }, {
          method: "POST",
          url: "/api/admin/app/recovery/complete?token=raw-query-secret"
        }),
        getResponse: () => response
      })
    } as unknown as ArgumentsHost;

    filter.catch(new Error("password=raw-error-secret"), host);

    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).toContain("Administrator web request failed.");
    expect(logged).toContain("/api/admin/app/recovery/complete");
    expect(logged).toContain("123e4567-e89b-42d3-a456-426614174000");
    expect(logged).not.toContain("raw-query-secret");
    expect(logged).not.toContain("raw-error-secret");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("token=");
  });

  it("uses PRG after tournament creation and never sends matches on publish", async () => {
    const tournaments = {
      create: jest.fn().mockResolvedValue({ tournament: { id: TOURNAMENT_ID } }),
      get: jest.fn().mockResolvedValue(DETAIL),
      preview: jest.fn().mockResolvedValue(PREVIEW),
      publish: jest.fn().mockResolvedValue({})
    } as unknown as AdminTournamentSetupService;
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityService;
    const securityAudit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const controller = new AdminWebTournamentsController(
      tournaments,
      CONFIG,
      security,
      securityAudit
    );
    const response = responseRecorder();
    const webRequest = request({
      cookie: `${CONFIG.csrfCookieName}=csrf-cookie`
    });

    await controller.create({
      _csrf: "csrf-cookie",
      name: "Tournament",
      year: "2027",
      "configuration.kind": "preset",
      "configuration.value.teamCount": "32",
      "configuration.value.podCount": "8",
      "configuration.value.podSize": "4",
      "configuration.value.playersPerTeam": "2",
      "configuration.value.gamesPerPair": "1",
      "configuration.value.qualifiersPerPod": "2",
      "configuration.value.bracketSize": "16"
    }, PRINCIPAL, webRequest, response);
    expect(response.redirect).toHaveBeenCalledWith(
      303,
      `/api/admin/app/tournaments/${TOURNAMENT_ID}/setup`
    );

    const publishResponse = responseRecorder();
    await controller.publish(TOURNAMENT_ID, {
      _csrf: "csrf-cookie",
      expectedRowVersion: "1",
      previewDigest: "a".repeat(64),
      visibility: "public"
    }, PRINCIPAL, webRequest, publishResponse);
    expect(tournaments.publish).toHaveBeenCalledWith(
      TOURNAMENT_ID,
      {
        expectedRowVersion: 1,
        previewDigest: "a".repeat(64),
        visibility: "public"
      },
      PRINCIPAL
    );
    expect(security.enforceSensitiveOperatorAction).toHaveBeenCalledWith(
      {
        action: "tournament_setup_publish",
        targetType: "tournament",
        targetId: TOURNAMENT_ID
      },
      PRINCIPAL,
      expect.any(Object)
    );
    expect(tournaments.publish).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ matches: expect.anything() }),
      expect.anything()
    );
    expect(publishResponse.redirect).toHaveBeenCalledWith(
      303,
      "/api/admin/app/tournaments?published=1"
    );
  });

  it("best-effort audits browser command rejections before and around setup service calls", async () => {
    const stale = new AppError({
      code: "CONFLICT",
      message: "Tournament setup changed.",
      statusCode: 409,
      details: [{ code: "STALE_TOURNAMENT_VERSION", message: "Stale." }]
    });
    const tournaments = {
      create: jest.fn(),
      get: jest.fn()
        .mockRejectedValueOnce(new AppError({
          code: "BAD_REQUEST",
          message: "Tournament ID is invalid.",
          statusCode: 400,
          details: [{ code: "INVALID_TOURNAMENT_ID", message: "Invalid." }]
        }))
        .mockResolvedValue(DETAIL)
        .mockResolvedValue(DETAIL),
      replaceDraft: jest.fn().mockRejectedValue(stale),
      preview: jest.fn().mockResolvedValue(PREVIEW),
      publish: jest.fn()
    } as unknown as AdminTournamentSetupService;
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockRejectedValue(new AppError({
        code: "RATE_LIMITED",
        message: "Try again later.",
        statusCode: 429,
        details: [{ code: "ADMIN_RATE_LIMITED", message: "Limited." }]
      }))
    } as unknown as AdministratorSecurityService;
    const audit = {
      recordEvent: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityAuditService;
    const controller = new AdminWebTournamentsController(
      tournaments,
      CONFIG,
      security,
      audit
    );
    const webRequest = request({
      cookie: `${CONFIG.csrfCookieName}=csrf-cookie`,
      "x-request-id": "request-setup-1"
    }, { method: "POST", url: "/api/admin/app/tournaments/new" });

    await controller.create({
      _csrf: "csrf-cookie",
      name: "Tournament",
      password: "must-not-be-audited"
    }, PRINCIPAL, webRequest, responseRecorder());

    await expect(controller.saveSetup(
      "invalid-id-with-secret",
      { _csrf: "csrf-cookie" },
      PRINCIPAL,
      webRequest,
      responseRecorder()
    )).rejects.toBeInstanceOf(AppError);

    await controller.saveSetup(
      TOURNAMENT_ID,
      validSetupBody(),
      PRINCIPAL,
      webRequest,
      responseRecorder()
    );

    await controller.publish(
      TOURNAMENT_ID,
      {
        _csrf: "csrf-cookie",
        unexpected: "publish-form-secret"
      },
      PRINCIPAL,
      webRequest,
      responseRecorder()
    );

    await controller.publish(
      TOURNAMENT_ID,
      {
        _csrf: "csrf-cookie",
        expectedRowVersion: "1",
        previewDigest: "a".repeat(64),
        visibility: "public"
      },
      PRINCIPAL,
      webRequest,
      responseRecorder()
    );

    const calls = (audit.recordEvent as jest.Mock).mock.calls
      .map(([event]) => event);
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "administrator_web_command",
        outcome: "rejected",
        details: { command: "tournament_create" }
      }),
      expect.objectContaining({
        reasonCode: "INVALID_TOURNAMENT_ID",
        targetId: undefined,
        details: { command: "tournament_setup_save" }
      }),
      expect.objectContaining({
        reasonCode: "STALE_TOURNAMENT_VERSION",
        targetId: TOURNAMENT_ID,
        details: { command: "tournament_setup_save" }
      }),
      expect.objectContaining({
        reasonCode: "BAD_REQUEST",
        details: { command: "tournament_setup_publish" }
      }),
      expect.objectContaining({
        reasonCode: "ADMIN_RATE_LIMITED",
        details: { command: "tournament_setup_publish" }
      })
    ]));
    const serializedAudit = JSON.stringify(calls);
    expect(serializedAudit).not.toContain("must-not-be-audited");
    expect(serializedAudit).not.toContain("invalid-id-with-secret");
    expect(serializedAudit).not.toContain("publish-form-secret");
  });

  it("keeps a browser command rejected when rejection-audit storage fails", async () => {
    const controller = new AdminWebTournamentsController(
      { create: jest.fn() } as unknown as AdminTournamentSetupService,
      CONFIG,
      {} as AdministratorSecurityService,
      {
        recordEvent: jest.fn().mockRejectedValue(new Error("audit unavailable"))
      } as unknown as AdministratorSecurityAuditService
    );
    const response = responseRecorder();

    await expect(controller.create({
      _csrf: "csrf-cookie",
      unexpected: "rejected"
    }, PRINCIPAL, request({
      cookie: `${CONFIG.csrfCookieName}=csrf-cookie`
    }), response)).resolves.toBeUndefined();
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain("Unexpected form field");
  });
});

const CONFIG = loadAdministratorAuthConfig({});
const TOURNAMENT_ID = "00000000-0000-4000-8000-000000000001";
const POD_ID = "00000000-0000-4000-8000-000000000002";

const PRINCIPAL: AdministratorPrincipal = {
  administratorId: "admin-1",
  loginName: "operator",
  displayName: "Operator",
  sessionId: "session-1",
  authenticatedAt: "2027-01-01T00:00:00.000Z",
  expiresAt: "2099-01-01T12:00:00.000Z"
};

const DETAIL = {
  tournament: {
    id: TOURNAMENT_ID,
    publicKey: TOURNAMENT_ID,
    gameType: "ruski",
    year: 2027,
    name: "Tournament",
    lifecycle: "draft_setup" as const,
    visibility: "private" as const,
    rowVersion: 1,
    setupPublishedAt: null,
    createdAt: "2027-01-01T00:00:00.000Z",
    updatedAt: "2027-01-01T00:00:00.000Z"
  },
  configuration: {
    formatVersion: 1,
    formatType: "pod_and_single_elimination" as const,
    teamCount: 1,
    podCount: 1,
    podSizes: [1],
    playersPerTeam: 1,
    gamesPerPair: 1,
    qualifiersPerPod: 1,
    bracketSize: 2,
    allowByes: true,
    standingsRules: ["record", "cupDifferential", "teamShootingPercentage", "administratorResolution"] as const
  },
  pods: [{ id: POD_ID, name: "Pod 1", sequence: 1 }],
  teams: [],
  validation: { publishable: false, issues: [] }
};

const PREVIEW = {
  tournamentId: TOURNAMENT_ID,
  rowVersion: 1,
  publishable: true,
  issues: [],
  previewDigest: "a".repeat(64),
  matchCount: 0,
  matches: []
};

function validSetupBody(): Record<string, string> {
  return {
    _csrf: "csrf-cookie",
    expectedRowVersion: "1",
    "pods.0.id": POD_ID,
    "pods.0.name": "Pod 1",
    "teams.0.id": "",
    "teams.0.name": "",
    "teams.0.podId": POD_ID,
    "teams.0.initialSeed": "1",
    "teams.0.players.0.id": "",
    "teams.0.players.0.displayName": "",
    "teams.0.players.0.firstName": "",
    "teams.0.players.0.lastName": "",
    "teams.0.players.0.preferredName": ""
  };
}

function request(
  headers: Record<string, string | string[] | undefined> = {},
  metadata: Pick<AdminWebRequest, "method" | "url"> = {}
): AdminWebRequest {
  return { headers, ip: "127.0.0.1", ...metadata };
}

function responseRecorder(): AdminWebResponse & {
  cookies: string[];
  body: string;
  statusCode: number;
  redirect: jest.Mock;
} {
  const response: AdminWebResponse & {
    cookies: string[];
    body: string;
    statusCode: number;
    redirect: jest.Mock;
  } = {
    cookies: [] as string[],
    body: "",
    statusCode: 200,
    append: jest.fn((name: string, value: string): AdminWebResponse => {
      if (name === "Set-Cookie") response.cookies.push(value);
      return response;
    }),
    setHeader: jest.fn((): AdminWebResponse => response),
    status: jest.fn((statusCode: number): AdminWebResponse => {
      response.statusCode = statusCode;
      return response;
    }),
    type: jest.fn((): AdminWebResponse => response),
    send: jest.fn((body: string): AdminWebResponse => {
      response.body = body;
      return response;
    }),
    redirect: jest.fn((): AdminWebResponse => response)
  };
  return response;
}
