import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  UseGuards
} from "@nestjs/common";

import {
  AdministratorAuthenticatedRequest,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext
} from "../security";
import {
  AdminTournamentDetailResponse,
  AdminTournamentSetupPreviewResponse,
  AdminTournamentSetupPublicationResponse,
  AdminTournamentSummaryResponse,
  CreateAdminTournamentRequest,
  PreviewAdminTournamentSetupRequest,
  PublishAdminTournamentSetupRequest,
  ReplaceAdminTournamentSetupRequest
} from "./admin-tournament-setup.contracts";
import { AdminTournamentSetupService } from "./admin-tournament-setup.service";

@Controller("admin/tournaments")
@UseGuards(AdministratorSessionGuard)
export class AdminTournamentsController {
  constructor(
    private readonly tournaments: AdminTournamentSetupService,
    private readonly security: AdministratorSecurityService
  ) {}

  @Get()
  list(): Promise<AdminTournamentSummaryResponse[]> {
    return this.tournaments.list();
  }

  @Post()
  @UseGuards(AdministratorCsrfGuard)
  create(
    @Body() request: CreateAdminTournamentRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal
  ): Promise<AdminTournamentDetailResponse> {
    return this.tournaments.create(request, principal);
  }

  @Get(":tournamentId")
  get(
    @Param("tournamentId") tournamentId: string
  ): Promise<AdminTournamentDetailResponse> {
    return this.tournaments.get(tournamentId);
  }

  @Put(":tournamentId/setup")
  @UseGuards(AdministratorCsrfGuard)
  replaceDraft(
    @Param("tournamentId") tournamentId: string,
    @Body() request: ReplaceAdminTournamentSetupRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal
  ): Promise<AdminTournamentDetailResponse> {
    return this.tournaments.replaceDraft(tournamentId, request, principal);
  }

  @Post(":tournamentId/setup/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  preview(
    @Param("tournamentId") tournamentId: string,
    @Body() request: PreviewAdminTournamentSetupRequest | null | undefined
  ): Promise<AdminTournamentSetupPreviewResponse> {
    return this.tournaments.preview(tournamentId, request);
  }

  @Post(":tournamentId/setup/publish")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  async publish(
    @Param("tournamentId") tournamentId: string,
    @Body() request: PublishAdminTournamentSetupRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() httpRequest: AdministratorAuthenticatedRequest
  ): Promise<AdminTournamentSetupPublicationResponse> {
    await this.security.enforceSensitiveOperatorAction(
      {
        action: "tournament_setup_publish",
        targetType: "tournament",
        targetId: tournamentId
      },
      principal,
      administratorRequestContext(httpRequest)
    );
    return this.tournaments.publish(tournamentId, request, principal);
  }
}
