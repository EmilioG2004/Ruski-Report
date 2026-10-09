import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig,
  AdministratorAuthenticatedRequest,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext,
  readAdministratorCookie
} from "../security";
import { AdminTournamentSetupService } from "../tournament-setup";
import {
  AdministratorWebExceptionFilter,
  isExpectedWebError
} from "../web/admin-web.errors";
import {
  ADMIN_WEB_ROOT,
  AdminWebRequest,
  AdminWebResponse,
  redirectAdmin,
  sendAdminHtml
} from "../web/admin-web.types";
import { UploadedCanonicalWorkbookFile } from "./admin-tournament-workbook.contracts";
import {
  renderTournamentWorkbookPage,
  renderTournamentWorkbookPreviewPage,
  renderTournamentWorkbookResultPage
} from "./admin-tournament-workbook.pages";
import { AdminTournamentWorkbookService } from "./admin-tournament-workbook.service";
import {
  parseWorkbookApplyForm,
  parseWorkbookAssignmentForm
} from "./admin-tournament-workbook.validator";
import { AdministratorMultipartCsrfVerifier } from "./administrator-multipart-csrf.verifier";
import { AdministratorMultipartOriginGuard } from "./administrator-multipart-csrf.verifier";

type AuthenticatedAdminWebRequest = AdminWebRequest &
  AdministratorAuthenticatedRequest;

@Controller("admin/app/tournaments/:tournamentId/workbooks")
@UseGuards(AdministratorSessionGuard)
@UseFilters(AdministratorWebExceptionFilter)
export class AdminWebTournamentWorkbooksController {
  constructor(
    private readonly workbooks: AdminTournamentWorkbookService,
    private readonly tournaments: AdminTournamentSetupService,
    private readonly security: AdministratorSecurityService,
    private readonly securityAudit: AdministratorSecurityAuditService,
    private readonly multipartCsrf: AdministratorMultipartCsrfVerifier,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  @Get()
  async page(
    @Param("tournamentId") tournamentId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse,
    @Query("generated") generated?: string
  ): Promise<void> {
    const [detail, generations] = await Promise.all([
      this.tournaments.get(tournamentId),
      this.workbooks.listGenerations(tournamentId)
    ]);
    sendAdminHtml(response, renderTournamentWorkbookPage({
      principal,
      csrfToken: this.csrfToken(request),
      detail,
      generations,
      ...(generated === "1" ? { notice: "Workbook generated." } : {})
    }));
  }

  @Post("generate")
  @UseGuards(AdministratorCsrfGuard)
  async generate(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    try {
      const expected = flatString(body, "expectedTournamentRowVersion");
      await this.security.enforceSensitiveOperatorAction(
        safeTarget("canonical_workbook_generate", tournamentId),
        principal,
        administratorRequestContext(request)
      );
      await this.workbooks.generate(
        tournamentId,
        { expectedTournamentRowVersion: expected },
        principal
      );
      redirectAdmin(
        response,
        `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/workbooks?generated=1`
      );
    } catch (error) {
      await this.recordRejected("workbook_generate", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Post("imports/preview")
  @UseGuards(AdministratorMultipartOriginGuard)
  @UseInterceptors(FileInterceptor("file"))
  async preview(
    @Param("tournamentId") tournamentId: string,
    @UploadedFile() file: UploadedCanonicalWorkbookFile | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    try {
      await this.multipartCsrf.verify(request);
      await this.security.enforceSensitiveOperatorAction(
        safeTarget("canonical_workbook_preview", tournamentId),
        principal,
        administratorRequestContext(request)
      );
      const detail = await this.tournaments.get(tournamentId);
      const preview = await this.workbooks.preview(
        tournamentId,
        file,
        principal
      );
      sendAdminHtml(response, renderTournamentWorkbookPreviewPage({
        principal,
        csrfToken: this.csrfToken(request),
        detail,
        preview
      }));
    } catch (error) {
      await this.recordRejected("workbook_preview", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Get("imports/:batchId")
  async previewPage(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const [detail, preview] = await Promise.all([
      this.tournaments.get(tournamentId),
      this.workbooks.findPreview(tournamentId, batchId)
    ]);
    sendAdminHtml(response, renderTournamentWorkbookPreviewPage({
      principal,
      csrfToken: this.csrfToken(request),
      detail,
      preview
    }));
  }

  @Post("imports/:batchId/assignments")
  @UseGuards(AdministratorCsrfGuard)
  async assign(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    try {
      await this.security.enforceSensitiveOperatorAction(
        safeTarget("canonical_workbook_assignment", tournamentId),
        principal,
        administratorRequestContext(request)
      );
      const revised = await this.workbooks.assign(
        tournamentId,
        batchId,
        parseWorkbookAssignmentForm(body),
        principal
      );
      redirectAdmin(
        response,
        `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/workbooks/imports/${revised.id}`
      );
    } catch (error) {
      await this.recordRejected("workbook_assignment", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Post("imports/:batchId/apply")
  @UseGuards(AdministratorCsrfGuard)
  async apply(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    try {
      const preview = await this.workbooks.findPreview(tournamentId, batchId);
      const proposedIds = preview.observations.flatMap((observation) =>
        observation.classification === "proposed" ? [observation.id] : []
      );
      await this.security.enforceSensitiveOperatorAction(
        safeTarget("canonical_workbook_apply", tournamentId),
        principal,
        administratorRequestContext(request)
      );
      const detail = await this.tournaments.get(tournamentId);
      const result = await this.workbooks.apply(
        tournamentId,
        batchId,
        parseWorkbookApplyForm(body, proposedIds),
        principal
      );
      sendAdminHtml(response, renderTournamentWorkbookResultPage({
        principal,
        csrfToken: this.csrfToken(request),
        detail,
        result
      }));
    } catch (error) {
      await this.recordRejected("workbook_apply", tournamentId, principal, request, error);
      throw error;
    }
  }

  private async recordRejected(
    command: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AdminWebRequest,
    error: unknown
  ): Promise<void> {
    try {
      const context = administratorRequestContext(request);
      await this.securityAudit.recordEvent({
        eventType: "administrator_web_command",
        outcome: "rejected",
        reasonCode: rejectionReason(error),
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        ...(isStableUuid(tournamentId)
          ? { targetType: "tournament", targetId: tournamentId }
          : {}),
        ...context,
        details: { command }
      });
    } catch {
      // The original browser command remains rejected if audit storage fails.
    }
  }

  private csrfToken(request: AdminWebRequest): string {
    const token = readAdministratorCookie(request, this.config.csrfCookieName);
    if (token === undefined) {
      throw new AppError({
        code: "UNAUTHORIZED",
        message: "Sign in as an administrator to continue.",
        statusCode: 401
      });
    }
    return token;
  }
}

function safeTarget(action: string, targetId: string) {
  return {
    action,
    targetType: "tournament",
    ...(isStableUuid(targetId) ? { targetId } : {})
  };
}

function flatString(body: unknown, name: string): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function rejectionReason(error: unknown): string {
  if (!isExpectedWebError(error) || !(error instanceof AppError)) {
    return "INTERNAL_ERROR";
  }
  const value = error.details[0]?.code ?? error.code;
  return /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : "WORKBOOK_COMMAND_REJECTED";
}
