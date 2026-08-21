import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";

import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  AdministratorAuthenticatedRequest,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext
} from "../security";
import {
  ApplyAdminMatchResolutionRequest,
  FinalizeAdminPodRequest,
  OverrideAdminSeedOrderRequest,
  PreviewAdminBracketRequest,
  PreviewAdminMatchResolutionRequest,
  PublishAdminBracketRequest,
  ResolveAdminGlobalSeedTieRequest,
  ResolveAdminStandingTieRequest
} from "./admin-tournament-progression.contracts";
import { AdminTournamentProgressionService } from "./admin-tournament-progression.service";

@Controller("admin/tournaments/:tournamentId/progression")
@UseGuards(AdministratorSessionGuard)
export class AdminTournamentProgressionController {
  constructor(
    private readonly progression: AdminTournamentProgressionService,
    private readonly security: AdministratorSecurityService,
    private readonly audit: AdministratorSecurityAuditService
  ) {}

  @Get()
  get(@Param("tournamentId") tournamentId: string) {
    return this.progression.get(tournamentId);
  }

  @Post("matches/:matchId/resolutions/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewMatchResolution(
    @Param("tournamentId") tournamentId: string,
    @Param("matchId") matchId: string,
    @Body() body: PreviewAdminMatchResolutionRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("match_resolution_preview", tournamentId, principal, request,
      () => this.progression.previewMatchResolution(tournamentId, matchId, body));
  }

  @Post("matches/:matchId/resolutions")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  applyMatchResolution(
    @Param("tournamentId") tournamentId: string,
    @Param("matchId") matchId: string,
    @Body() body: ApplyAdminMatchResolutionRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("match_resolution_apply", tournamentId, principal, request,
      () => this.progression.applyMatchResolution(
        tournamentId, matchId, body, principal
      ));
  }

  @Post("pods/:podId/ties/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewPodTie(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: ResolveAdminStandingTieRequest,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("pod_tie_preview", tournamentId, principal, request,
      () => this.progression.previewPodTieResolution(tournamentId, podId, body));
  }

  @Post("pods/:podId/ties")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  resolvePodTie(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: ResolveAdminStandingTieRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("pod_tie_apply", tournamentId, principal, request,
      () => this.progression.resolvePodTie(tournamentId, podId, body, principal));
  }

  @Post("pods/:podId/finalizations/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewFinalization(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: FinalizeAdminPodRequest,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("pod_finalization_preview", tournamentId, principal, request,
      () => this.progression.previewPodFinalization(tournamentId, podId, body));
  }

  @Post("pods/:podId/finalizations")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  finalizePod(
    @Param("tournamentId") tournamentId: string,
    @Param("podId") podId: string,
    @Body() body: FinalizeAdminPodRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("pod_finalization_apply", tournamentId, principal, request,
      () => this.progression.finalizePod(tournamentId, podId, body, principal));
  }

  @Post("seeds/ties/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewGlobalTie(
    @Param("tournamentId") tournamentId: string,
    @Body() body: ResolveAdminGlobalSeedTieRequest,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("global_seed_tie_preview", tournamentId, principal, request,
      () => this.progression.previewGlobalSeedTie(tournamentId, body));
  }

  @Post("seeds/ties")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  resolveGlobalTie(
    @Param("tournamentId") tournamentId: string,
    @Body() body: ResolveAdminGlobalSeedTieRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("global_seed_tie_apply", tournamentId, principal, request,
      () => this.progression.resolveGlobalSeedTie(tournamentId, body, principal));
  }

  @Post("seeds/overrides/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewSeedOverride(
    @Param("tournamentId") tournamentId: string,
    @Body() body: OverrideAdminSeedOrderRequest,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("seed_override_preview", tournamentId, principal, request,
      () => this.progression.previewSeedOverride(tournamentId, body));
  }

  @Post("seeds/overrides")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  applySeedOverride(
    @Param("tournamentId") tournamentId: string,
    @Body() body: OverrideAdminSeedOrderRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("seed_override_apply", tournamentId, principal, request,
      () => this.progression.overrideSeeds(tournamentId, body, principal));
  }

  @Post("bracket/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  previewBracket(
    @Param("tournamentId") tournamentId: string,
    @Body() body: PreviewAdminBracketRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("bracket_preview", tournamentId, principal, request,
      () => this.progression.previewBracket(tournamentId, body));
  }

  @Post("bracket")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  publishBracket(
    @Param("tournamentId") tournamentId: string,
    @Body() body: PublishAdminBracketRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    return this.command("bracket_publish", tournamentId, principal, request,
      () => this.progression.publishBracket(tournamentId, body, principal));
  }

  private async command<T>(
    command: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AdministratorAuthenticatedRequest,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      await this.security.enforceSensitiveOperatorAction(
        safeTarget(`tournament_progression_${command}`, tournamentId),
        principal,
        administratorRequestContext(request)
      );
      return await operation();
    } catch (error) {
      await this.recordRejected(command, tournamentId, principal, request, error);
      throw error;
    }
  }

  private async recordRejected(
    command: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AdministratorAuthenticatedRequest,
    error: unknown
  ): Promise<void> {
    try {
      await this.audit.recordEvent({
        eventType: "administrator_progression_command",
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
      // Preserve the original rejection if security-audit storage fails.
    }
  }
}

function safeTarget(action: string, targetId: string) {
  return {
    action,
    targetType: "tournament",
    ...(isStableUuid(targetId) ? { targetId } : {})
  };
}

function rejectionReason(error: unknown): string {
  if (!(error instanceof AppError)) return "INTERNAL_ERROR";
  const value = error.details[0]?.code ?? error.code;
  return /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : "PROGRESSION_COMMAND_REJECTED";
}
