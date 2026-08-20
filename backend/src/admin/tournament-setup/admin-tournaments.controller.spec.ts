import { GUARDS_METADATA } from "@nestjs/common/constants";

import { AppError } from "../../errors";
import {
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityService,
  AdministratorSessionGuard
} from "../security";
import { AdminTournamentSetupService } from "./admin-tournament-setup.service";
import { AdminTournamentsController } from "./admin-tournaments.controller";

describe("AdminTournamentsController", () => {
  const principal: AdministratorPrincipal = {
    administratorId: "00000000-0000-4000-8000-000000009001",
    loginName: "operator",
    displayName: "Operator",
    sessionId: "00000000-0000-4000-8000-000000009002",
    authenticatedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-01-02T00:00:00.000Z"
  };

  it("requires an administrator session for every route", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminTournamentsController))
      .toContain(AdministratorSessionGuard);
  });

  it.each(["create", "replaceDraft", "preview", "publish"] as const)(
    "requires CSRF protection for %s",
    (method) => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        AdminTournamentsController.prototype[method]
      ) as unknown[];
      expect(guards).toContain(AdministratorCsrfGuard);
    }
  );

  it("delegates creation with the authenticated principal", async () => {
    const response = { tournament: { id: "tournament-1" } };
    const service = {
      create: jest.fn().mockResolvedValue(response)
    } as unknown as AdminTournamentSetupService;
    const controller = new AdminTournamentsController(service, securityService());
    const request = {
      name: "2027 Tournament",
      year: 2027,
      configuration: {
        kind: "preset",
        presetId: "ruski-main-32-team"
      }
    };

    await expect(controller.create(request, principal)).resolves.toBe(response);
    expect(service.create).toHaveBeenCalledWith(request, principal);
  });

  it("never accepts a client schedule in the publish contract", async () => {
    const service = {
      publish: jest.fn().mockResolvedValue({ lifecycle: "setup_published" })
    } as unknown as AdminTournamentSetupService;
    const security = securityService();
    const controller = new AdminTournamentsController(service, security);
    const request = {
      expectedRowVersion: 1,
      previewDigest: "a".repeat(64),
      visibility: "public"
    };

    await controller.publish(
      "00000000-0000-4000-8000-000000000001",
      request,
      principal,
      {
        headers: { "x-request-id": "request-1" },
        ip: "127.0.0.1"
      }
    );

    expect(security.enforceSensitiveOperatorAction).toHaveBeenCalledWith(
      {
        action: "tournament_setup_publish",
        targetType: "tournament",
        targetId: "00000000-0000-4000-8000-000000000001"
      },
      principal,
      {
        requestId: "request-1",
        networkIdentity: "127.0.0.1",
        userAgent: undefined
      }
    );
    expect(service.publish).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      request,
      principal
    );
    expect(request).not.toHaveProperty("schedule");
  });

  it("stops publication when the persisted sensitive-action limit rejects", async () => {
    const service = {
      publish: jest.fn()
    } as unknown as AdminTournamentSetupService;
    const security = securityService();
    security.enforceSensitiveOperatorAction.mockRejectedValue(new AppError({
      code: "RATE_LIMITED",
      message: "Try again later.",
      statusCode: 429,
      details: [{
        code: "RATE_LIMITED",
        message: "Try again later.",
        metadata: { retryAfterSeconds: 30 }
      }]
    }));
    const controller = new AdminTournamentsController(service, security);

    await expect(controller.publish(
      "00000000-0000-4000-8000-000000000001",
      {
        expectedRowVersion: 1,
        previewDigest: "a".repeat(64),
        visibility: "public"
      },
      principal,
      { headers: {}, ip: "127.0.0.1" }
    )).rejects.toMatchObject({
      code: "RATE_LIMITED",
      statusCode: 429,
      details: [expect.objectContaining({
        metadata: { retryAfterSeconds: 30 }
      })]
    });
    expect(service.publish).not.toHaveBeenCalled();
  });
});

function securityService(): AdministratorSecurityService & {
  enforceSensitiveOperatorAction: jest.Mock;
} {
  return {
    enforceSensitiveOperatorAction: jest.fn().mockResolvedValue(undefined)
  } as unknown as AdministratorSecurityService & {
    enforceSensitiveOperatorAction: jest.Mock;
  };
}
