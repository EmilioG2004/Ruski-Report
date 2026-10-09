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
  UseFilters,
  UseGuards
} from "@nestjs/common";

import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext,
  readAdministratorCookie,
  safeAdministratorRequestId
} from "../security";
import {
  AdminTournamentDetailResponse,
  AdminTournamentSetupService
} from "../tournament-setup";
import {
  parseCreateTournamentForm,
  parsePublishForm,
  parseSetupForm
} from "./admin-web.form";
import {
  AdministratorWebExceptionFilter,
  adminWebPageError,
  isExpectedWebError
} from "./admin-web.errors";
import {
  renderCreateTournamentPage,
  renderTournamentListPage
} from "./admin-web-tournament-list.pages";
import {
  renderSchedulePreviewPage,
  renderTournamentSetupPage
} from "./admin-web-setup.pages";
import {
  ADMIN_WEB_ROOT,
  AdminWebRequest,
  AdminWebResponse,
  redirectAdmin,
  sendAdminErrorHtml,
  sendAdminHtml
} from "./admin-web.types";

@Controller("admin/app/tournaments")
@UseGuards(AdministratorSessionGuard)
@UseFilters(AdministratorWebExceptionFilter)
export class AdminWebTournamentsController {
  constructor(
    private readonly tournaments: AdminTournamentSetupService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig,
    private readonly security: AdministratorSecurityService,
    private readonly securityAudit: AdministratorSecurityAuditService
  ) {}

  @Get()
  async list(
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse,
    @Query("published") published?: string
  ): Promise<void> {
    sendAdminHtml(response, renderTournamentListPage({
      principal,
      csrfToken: this.csrfToken(request),
      tournaments: await this.tournaments.list(),
      published: published === "1"
    }));
  }

  @Get("new")
  createPage(
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): void {
    sendAdminHtml(response, renderCreateTournamentPage({
      principal,
      csrfToken: this.csrfToken(request)
    }));
  }

  @Post("new")
  @UseGuards(AdministratorCsrfGuard)
  async create(
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrfToken = this.csrfToken(request);
    try {
      const parsed = parseCreateTournamentForm(body);
      const created = await this.tournaments.create(parsed.request, principal);
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments/${created.tournament.id}/setup`);
    } catch (error) {
      await this.recordRejectedWebCommand(
        "tournament_create",
        principal,
        request,
        undefined,
        error
      );
      if (!isExpectedWebError(error)) {
        throw error;
      }
      const values = safeCreateValues(body);
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderCreateTournamentPage({
        principal,
        csrfToken,
        values,
        error: pageError
      }), pageError);
    }
  }

  @Get(":tournamentId/setup")
  async setup(
    @Param("tournamentId") tournamentId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse,
    @Query("saved") saved?: string
  ): Promise<void> {
    const detail = await this.tournaments.get(tournamentId);
    sendAdminHtml(response, renderTournamentSetupPage({
      principal,
      csrfToken: this.csrfToken(request),
      detail,
      saved: saved === "1"
    }));
  }

  @Post(":tournamentId/setup")
  @UseGuards(AdministratorCsrfGuard)
  async saveSetup(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrfToken = this.csrfToken(request);
    let detail: AdminTournamentDetailResponse | undefined;
    try {
      detail = await this.tournaments.get(tournamentId);
      const parsed = parseSetupForm(body, detail);
      await this.tournaments.replaceDraft(tournamentId, parsed.request, principal);
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments/${tournamentId}/setup?saved=1`);
    } catch (error) {
      await this.recordRejectedWebCommand(
        "tournament_setup_save",
        principal,
        request,
        tournamentId,
        error
      );
      if (!isExpectedWebError(error) || detail === undefined) {
        throw error;
      }
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderTournamentSetupPage({
        principal,
        csrfToken,
        detail,
        values: safeSetupValues(body),
        error: pageError
      }), pageError);
    }
  }

  @Get(":tournamentId/setup/preview")
  async preview(
    @Param("tournamentId") tournamentId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const detail = await this.tournaments.get(tournamentId);
    const preview = await this.tournaments.preview(tournamentId, {
      expectedRowVersion: detail.tournament.rowVersion
    });
    sendAdminHtml(response, renderSchedulePreviewPage({
      principal,
      csrfToken: this.csrfToken(request),
      detail,
      preview
    }));
  }

  @Post(":tournamentId/setup/publish")
  @UseGuards(AdministratorCsrfGuard)
  async publish(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    let detail: AdminTournamentDetailResponse | undefined;
    let preview: Awaited<ReturnType<AdminTournamentSetupService["preview"]>> |
      undefined;
    try {
      detail = await this.tournaments.get(tournamentId);
      preview = await this.tournaments.preview(tournamentId, {
        expectedRowVersion: detail.tournament.rowVersion
      });
      const parsed = parsePublishForm(body);
      await this.security.enforceSensitiveOperatorAction(
        {
          action: "tournament_setup_publish",
          targetType: "tournament",
          targetId: tournamentId
        },
        principal,
        administratorRequestContext(request)
      );
      await this.tournaments.publish(tournamentId, parsed.request, principal);
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments?published=1`);
    } catch (error) {
      await this.recordRejectedWebCommand(
        "tournament_setup_publish",
        principal,
        request,
        tournamentId,
        error
      );
      if (!isExpectedWebError(error) || detail === undefined ||
          preview === undefined) {
        throw error;
      }
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderSchedulePreviewPage({
        principal,
        csrfToken: this.csrfToken(request),
        detail,
        preview,
        error: pageError
      }), pageError);
    }
  }

  private async recordRejectedWebCommand(
    command: "tournament_create" | "tournament_setup_save" |
      "tournament_setup_publish",
    principal: AdministratorPrincipal,
    request: AdminWebRequest,
    targetId: string | undefined,
    error: unknown
  ): Promise<void> {
    try {
      await this.securityAudit.recordEvent({
        eventType: "administrator_web_command",
        outcome: "rejected",
        reasonCode: webRejectionReason(error),
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        targetType: targetId === undefined ? undefined : "tournament",
        targetId: targetId !== undefined && isStableUuid(targetId)
          ? targetId
          : undefined,
        ...webAuditRequestContext(request),
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

function webRejectionReason(error: unknown): string {
  if (!(error instanceof AppError)) {
    return "INTERNAL_ERROR";
  }
  const candidate = error.details[0]?.code ?? error.code;
  return candidate !== undefined && /^[A-Za-z0-9_.:-]{1,100}$/u.test(candidate)
    ? candidate
    : "WEB_COMMAND_REJECTED";
}

function webAuditRequestContext(request: AdminWebRequest): {
  requestId?: string;
  networkIdentity?: string;
  userAgent?: string;
} {
  const { requestId, ...hashedContext } = administratorRequestContext(request);
  return {
    ...hashedContext,
    ...(safeAdministratorRequestId(requestId) !== undefined
      ? { requestId: safeAdministratorRequestId(requestId) }
      : {})
  };
}

function safeCreateValues(body: unknown): Readonly<Record<string, string>> {
  return safeFlatValues(body, (name) => name === "name" || name === "year" ||
    name.startsWith("configuration."));
}

function safeSetupValues(body: unknown): Readonly<Record<string, string>> {
  return safeFlatValues(body, (name) => name.startsWith("pods.") ||
    name.startsWith("teams."));
}

function safeFlatValues(
  body: unknown,
  accept: (name: string) => boolean
): Readonly<Record<string, string>> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {};
  }
  return Object.fromEntries(Object.entries(body).flatMap(([name, value]) =>
    accept(name) && typeof value === "string" ? [[name, value]] : []
  ));
}
