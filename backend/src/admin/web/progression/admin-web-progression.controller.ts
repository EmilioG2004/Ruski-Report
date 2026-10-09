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

import { AppError } from "../../../errors";
import { isStableUuid } from "../../../tournament-engine/domain";
import {
  OperatorMatchResolutionPreview,
  TournamentProgressionRecord
} from "../../../tournament-engine/persistence";
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
} from "../../security";
import {
  AdminBracketPreviewResponse,
  AdminTournamentProgressionService,
  ApplyAdminMatchResolutionRequest,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminBracketRequest,
  PreviewAdminMatchResolutionRequest,
  PublishAdminBracketRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "../../tournament-progression";
import {
  AdministratorWebExceptionFilter,
  isExpectedWebError
} from "../admin-web.errors";
import {
  ADMIN_WEB_ROOT,
  AdminWebRequest,
  AdminWebResponse,
  redirectAdmin,
  sendAdminHtml
} from "../admin-web.types";
import {
  parseBracketForm,
  parseGlobalSeedTieForm,
  parseMatchResolutionApplyForm,
  parseMatchResolutionPreviewForm,
  parsePodFinalizationForm,
  parsePodTieForm,
  parseSeedOverrideForm
} from "./admin-web-progression.form";
import {
  renderBracketConfirmationPage,
  renderGlobalSeedTieConfirmationPage,
  renderMatchResolutionConfirmationPage,
  renderPodFinalizationConfirmationPage,
  renderPodTieConfirmationPage,
  renderSeedOverrideConfirmationPage,
  renderTournamentProgressionPage
} from "./admin-web-progression.pages";

type AuthenticatedAdminWebRequest = AdminWebRequest &
  AdministratorAuthenticatedRequest;

interface ProgressionWebService {
  get(tournamentId: string): Promise<TournamentProgressionRecord>;
  previewMatchResolution(
    tournamentId: string,
    matchId: string,
    request: PreviewAdminMatchResolutionRequest
  ): Promise<OperatorMatchResolutionPreview>;
  applyMatchResolution(
    tournamentId: string,
    matchId: string,
    request: ApplyAdminMatchResolutionRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
  previewPodTieResolution(
    tournamentId: string,
    podId: string,
    request: ResolveAdminStandingTieRequest
  ): Promise<{ confirmationDigest: string }>;
  resolvePodTie(
    tournamentId: string,
    podId: string,
    request: ResolveAdminStandingTieRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
  previewPodFinalization(
    tournamentId: string,
    podId: string,
    request: FinalizeAdminPodRequest
  ): Promise<{ confirmationDigest: string }>;
  finalizePod(
    tournamentId: string,
    podId: string,
    request: FinalizeAdminPodRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
  previewGlobalSeedTie(
    tournamentId: string,
    request: ResolveAdminGlobalSeedTieRequest
  ): Promise<{ confirmationDigest: string }>;
  resolveGlobalSeedTie(
    tournamentId: string,
    request: ResolveAdminGlobalSeedTieRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
  previewSeedOverride(
    tournamentId: string,
    request: OverrideAdminSeedOrderRequest
  ): Promise<{ confirmationDigest: string }>;
  overrideSeeds(
    tournamentId: string,
    request: OverrideAdminSeedOrderRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
  previewBracket(
    tournamentId: string,
    request: PreviewAdminBracketRequest
  ): Promise<AdminBracketPreviewResponse>;
  publishBracket(
    tournamentId: string,
    request: PublishAdminBracketRequest,
    principal: AdministratorPrincipal
  ): Promise<unknown>;
}

@Controller("admin/app/tournaments/:tournamentId/progression")
@UseGuards(AdministratorSessionGuard)
@UseFilters(AdministratorWebExceptionFilter)
export class AdminWebTournamentProgressionController {
  constructor(
    @Inject(AdminTournamentProgressionService)
    private readonly progression: ProgressionWebService,
    private readonly security: AdministratorSecurityService,
    private readonly securityAudit: AdministratorSecurityAuditService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  @Get()
  async page(
    @Param("tournamentId") tournamentId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse,
    @Query("notice") notice?: string
  ): Promise<void> {
    sendAdminHtml(response, renderTournamentProgressionPage({
      principal,
      csrfToken: this.csrfToken(request),
      progression: await this.progression.get(tournamentId),
      ...(noticeText(notice) === undefined ? {} : { notice: noticeText(notice) })
    }));
  }

  @Post("matches/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewMatch(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("match_resolution_preview", tournamentId, principal, request,
      async () => {
        const parsed = parseMatchResolutionPreviewForm(body);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewMatchResolution(
            tournamentId,
            parsed.matchId,
            parsed.request
          )
        ]);
        sendAdminHtml(response, renderMatchResolutionConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          matchId: parsed.matchId,
          request: parsed.request,
          preview
        }));
      });
  }

  @Post("matches/:matchId/apply")
  @UseGuards(AdministratorCsrfGuard)
  async applyMatch(
    @Param("tournamentId") tournamentId: string,
    @Param("matchId") matchId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("match_resolution_apply", tournamentId, principal, request,
      async () => {
        await this.progression.applyMatchResolution(
          tournamentId,
          matchId,
          parseMatchResolutionApplyForm(body).request,
          principal
        );
        this.redirect(response, tournamentId, "match-resolution");
      });
  }

  @Post("pods/:podId/ties/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewPodTie(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("pod_tie_preview", tournamentId, principal, request,
      async () => {
        const parsed = parsePodTieForm(body, false);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewPodTieResolution(
            tournamentId,
            podId,
            parsed.request
          )
        ]);
        sendAdminHtml(response, renderPodTieConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          podId,
          request: parsed.request,
          confirmationDigest: preview.confirmationDigest
        }));
      });
  }

  @Post("pods/:podId/ties")
  @UseGuards(AdministratorCsrfGuard)
  async resolvePodTie(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("pod_tie_apply", tournamentId, principal, request,
      async () => {
        await this.progression.resolvePodTie(
          tournamentId,
          podId,
          parsePodTieForm(body, true).request,
          principal
        );
        this.redirect(response, tournamentId, "pod-tie");
      });
  }

  @Post("pods/:podId/finalizations/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewPodFinalization(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("pod_finalization_preview", tournamentId, principal, request,
      async () => {
        const parsed = parsePodFinalizationForm(body, false);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewPodFinalization(
            tournamentId,
            podId,
            parsed.request
          )
        ]);
        sendAdminHtml(response, renderPodFinalizationConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          podId,
          request: parsed.request,
          confirmationDigest: preview.confirmationDigest
        }));
      });
  }

  @Post("pods/:podId/finalizations")
  @UseGuards(AdministratorCsrfGuard)
  async finalizePod(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("pod_finalization_apply", tournamentId, principal, request,
      async () => {
        await this.progression.finalizePod(
          tournamentId,
          podId,
          parsePodFinalizationForm(body, true).request,
          principal
        );
        this.redirect(response, tournamentId, "pod-finalized");
      });
  }

  @Post("seeds/ties/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewGlobalTie(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("global_seed_tie_preview", tournamentId, principal, request,
      async () => {
        const parsed = parseGlobalSeedTieForm(body, false);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewGlobalSeedTie(tournamentId, parsed.request)
        ]);
        sendAdminHtml(response, renderGlobalSeedTieConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          request: parsed.request,
          confirmationDigest: preview.confirmationDigest
        }));
      });
  }

  @Post("seeds/ties")
  @UseGuards(AdministratorCsrfGuard)
  async resolveGlobalTie(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("global_seed_tie_apply", tournamentId, principal, request,
      async () => {
        await this.progression.resolveGlobalSeedTie(
          tournamentId,
          parseGlobalSeedTieForm(body, true).request,
          principal
        );
        this.redirect(response, tournamentId, "global-seed-tie");
      });
  }

  @Post("seeds/overrides/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewSeedOverride(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("seed_override_preview", tournamentId, principal, request,
      async () => {
        const parsed = parseSeedOverrideForm(body, false);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewSeedOverride(tournamentId, parsed.request)
        ]);
        sendAdminHtml(response, renderSeedOverrideConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          request: parsed.request,
          confirmationDigest: preview.confirmationDigest
        }));
      });
  }

  @Post("seeds/overrides")
  @UseGuards(AdministratorCsrfGuard)
  async applySeedOverride(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("seed_override_apply", tournamentId, principal, request,
      async () => {
        await this.progression.overrideSeeds(
          tournamentId,
          parseSeedOverrideForm(body, true).request,
          principal
        );
        this.redirect(response, tournamentId, "seed-override");
      });
  }

  @Post("bracket/preview")
  @UseGuards(AdministratorCsrfGuard)
  async previewBracket(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("bracket_preview", tournamentId, principal, request,
      async () => {
        const parsed = parseBracketForm(body, false);
        const [progression, preview] = await Promise.all([
          this.progression.get(tournamentId),
          this.progression.previewBracket(
            tournamentId,
            parsed.request as PreviewAdminBracketRequest
          )
        ]);
        sendAdminHtml(response, renderBracketConfirmationPage({
          principal,
          csrfToken: this.csrfToken(request),
          progression,
          preview
        }));
      });
  }

  @Post("bracket")
  @UseGuards(AdministratorCsrfGuard)
  async publishBracket(
    @Param("tournamentId") tournamentId: string,
    @Body() body: unknown,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AuthenticatedAdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.command("bracket_publish", tournamentId, principal, request,
      async () => {
        await this.progression.publishBracket(
          tournamentId,
          parseBracketForm(body, true).request as PublishAdminBracketRequest,
          principal
        );
        this.redirect(response, tournamentId, "bracket-published");
      });
  }

  private async command(
    command: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AuthenticatedAdminWebRequest,
    operation: () => Promise<void>
  ): Promise<void> {
    try {
      await this.security.enforceSensitiveOperatorAction(
        safeTarget(`tournament_progression_${command}`, tournamentId),
        principal,
        administratorRequestContext(request)
      );
      await operation();
    } catch (error) {
      await this.recordRejected(command, tournamentId, principal, request, error);
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
      await this.securityAudit.recordEvent({
        eventType: "administrator_web_command",
        outcome: "rejected",
        reasonCode: rejectionReason(error),
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        ...(isStableUuid(tournamentId)
          ? { targetType: "tournament", targetId: tournamentId }
          : {}),
        ...administratorRequestContext(request),
        details: { command }
      });
    } catch {
      // Preserve the original command failure if rejected-audit storage fails.
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

  private redirect(
    response: AdminWebResponse,
    tournamentId: string,
    notice: string
  ): void {
    redirectAdmin(
      response,
      `${ADMIN_WEB_ROOT}/tournaments/${encodeURIComponent(tournamentId)}/progression?notice=${notice}`
    );
  }
}

function safeTarget(action: string, tournamentId: string) {
  return {
    action,
    targetType: "tournament",
    ...(isStableUuid(tournamentId) ? { targetId: tournamentId } : {})
  };
}

function rejectionReason(error: unknown): string {
  if (!isExpectedWebError(error) || !(error instanceof AppError)) {
    return "INTERNAL_ERROR";
  }
  const value = error.details[0]?.code ?? error.code;
  return /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : "PROGRESSION_COMMAND_REJECTED";
}

function noticeText(value: string | undefined): string | undefined {
  switch (value) {
    case "match-resolution": return "Match resolution applied.";
    case "pod-tie": return "Pod tie resolution applied.";
    case "pod-finalized": return "Pod finalized.";
    case "global-seed-tie": return "Qualifier tie resolution applied.";
    case "seed-override": return "Effective seed override applied.";
    case "bracket-published": return "Bracket and cumulative workbook published.";
    default: return undefined;
  }
}
