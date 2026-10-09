import { AppError } from "../../errors";
import {
  AdministratorAuthConfig,
  AdministratorAuthenticatedRequest,
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService
} from "../security";
import { AdminTournamentSetupService } from "../tournament-setup";
import { AdminTournamentWorkbookService } from "./admin-tournament-workbook.service";
import { AdminWebTournamentWorkbooksController } from "./admin-web-tournament-workbooks.controller";
import { AdminTournamentWorkbooksController } from "./admin-tournament-workbooks.controller";
import { AdministratorMultipartCsrfVerifier } from "./administrator-multipart-csrf.verifier";

const TOURNAMENT_ID = "10000000-0000-4000-8000-000000000001";
const WORKBOOK_ID = "20000000-0000-4000-8000-000000000001";

describe("AdminTournamentWorkbooksController", () => {
  it("verifies multipart CSRF before rate limiting and parsing upload bytes", async () => {
    const calls: string[] = [];
    const workbooks = {
      preview: jest.fn().mockImplementation(() => {
        calls.push("service");
        return Promise.resolve({ id: "preview" });
      })
    } as unknown as AdminTournamentWorkbookService;
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockImplementation(() => {
        calls.push("rate");
        return Promise.resolve();
      })
    } as unknown as AdministratorSecurityService;
    const multipart = {
      verify: jest.fn().mockImplementation(() => {
        calls.push("csrf");
        return Promise.resolve();
      })
    } as unknown as AdministratorMultipartCsrfVerifier;
    const controller = new AdminTournamentWorkbooksController(
      workbooks,
      security,
      audit(),
      multipart
    );
    const file = {
      buffer: Buffer.from("PK\u0003\u0004"),
      originalname: "private-name.xlsx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: 4
    };

    await controller.preview(
      TOURNAMENT_ID,
      file,
      PRINCIPAL,
      REQUEST
    );

    expect(calls).toEqual(["csrf", "rate", "service"]);
    expect(workbooks.preview).toHaveBeenCalledWith(
      TOURNAMENT_ID,
      file,
      PRINCIPAL
    );
  });

  it("preserves a sensitive-action denial without invoking generation", async () => {
    const denial = new AppError({
      code: "RATE_LIMITED",
      message: "Try again later.",
      statusCode: 429,
      details: [{
        code: "RATE_LIMITED",
        message: "Try again later.",
        metadata: { retryAfterSeconds: 30 }
      }]
    });
    const workbooks = {
      generate: jest.fn()
    } as unknown as AdminTournamentWorkbookService;
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockRejectedValue(denial)
    } as unknown as AdministratorSecurityService;
    const controller = new AdminTournamentWorkbooksController(
      workbooks,
      security,
      audit(),
      {} as AdministratorMultipartCsrfVerifier
    );

    await expect(controller.generate(
      TOURNAMENT_ID,
      { expectedTournamentRowVersion: 2 },
      PRINCIPAL,
      REQUEST
    )).rejects.toBe(denial);
    expect(workbooks.generate).not.toHaveBeenCalled();
  });

  it("downloads only the exact stored artifact with fixed safe headers", async () => {
    const workbooks = {
      download: jest.fn().mockResolvedValue({
        artifact: Buffer.from("exact-generated-bytes"),
        artifactSizeBytes: 21,
        filename: "ruski-report-2027-main-r1.xlsx"
      })
    } as unknown as AdminTournamentWorkbookService;
    const controller = new AdminTournamentWorkbooksController(
      workbooks,
      {} as AdministratorSecurityService,
      audit(),
      {} as AdministratorMultipartCsrfVerifier
    );
    const response = binaryResponse();

    await controller.download(TOURNAMENT_ID, WORKBOOK_ID, response);

    expect(response.headers).toMatchObject({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        "attachment; filename=\"ruski-report-2027-main-r1.xlsx\"",
      "Content-Length": "21",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    expect(response.send).toHaveBeenCalledWith(
      Buffer.from("exact-generated-bytes")
    );
  });

  it("never starts a browser workbook mutation after its detail read fails", async () => {
    const detailFailure = new AppError({
      code: "NOT_FOUND",
      message: "Tournament not found.",
      statusCode: 404
    });
    const workbooks = {
      preview: jest.fn(),
      findPreview: jest.fn().mockResolvedValue({ observations: [] }),
      apply: jest.fn()
    } as unknown as AdminTournamentWorkbookService;
    const tournaments = {
      get: jest.fn().mockRejectedValue(detailFailure)
    } as unknown as AdminTournamentSetupService;
    const security = {
      enforceSensitiveOperatorAction: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorSecurityService;
    const multipart = {
      verify: jest.fn().mockResolvedValue(undefined)
    } as unknown as AdministratorMultipartCsrfVerifier;
    const controller = new AdminWebTournamentWorkbooksController(
      workbooks,
      tournaments,
      security,
      audit(),
      multipart,
      {} as AdministratorAuthConfig
    );

    await expect(controller.preview(
      TOURNAMENT_ID,
      undefined,
      PRINCIPAL,
      REQUEST,
      {} as never
    )).rejects.toBe(detailFailure);
    await expect(controller.apply(
      TOURNAMENT_ID,
      "50000000-0000-4000-8000-000000000001",
      {},
      PRINCIPAL,
      REQUEST,
      {} as never
    )).rejects.toBe(detailFailure);

    expect(workbooks.preview).not.toHaveBeenCalled();
    expect(workbooks.apply).not.toHaveBeenCalled();
  });
});

function binaryResponse() {
  const response: {
    headers: Record<string, string>;
    setHeader: jest.Mock;
    status: jest.Mock;
    send: jest.Mock;
  } = {
    headers: {},
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn()
  };
  response.setHeader.mockImplementation((name: string, value: string) => {
    response.headers[name] = value;
  });
  response.status.mockReturnValue(response);
  return response;
}

function audit(): AdministratorSecurityAuditService {
  return {
    recordEvent: jest.fn().mockResolvedValue(undefined)
  } as unknown as AdministratorSecurityAuditService;
}

const PRINCIPAL: AdministratorPrincipal = {
  administratorId: "30000000-0000-4000-8000-000000000001",
  loginName: "operator",
  displayName: "Tournament Operator",
  sessionId: "40000000-0000-4000-8000-000000000001",
  authenticatedAt: "2026-08-20T12:00:00.000Z",
  expiresAt: "2026-08-20T20:00:00.000Z"
};

const REQUEST = {
  administratorPrincipal: PRINCIPAL,
  headers: { origin: "http://localhost:3000" }
} as AdministratorAuthenticatedRequest;
