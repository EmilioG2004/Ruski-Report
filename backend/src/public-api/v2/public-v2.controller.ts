import { Controller, Get, Param, Query } from "@nestjs/common";

import {
  CanonicalMatchDetailEnvelope,
  CanonicalMatchListEnvelope,
  CanonicalTournamentDetailEnvelope,
  CanonicalTournamentDiscoveryEnvelope
} from "../../tournament-engine/public-projection";
import { parseProjectionVersion } from "./projection-version";
import { PublicV2Service } from "./public-v2.service";

@Controller("v2")
export class PublicV2Controller {
  constructor(private readonly service: PublicV2Service) {}

  @Get("tournaments")
  listActiveTournaments(): Promise<CanonicalTournamentDiscoveryEnvelope> {
    return this.service.listActiveTournaments();
  }

  @Get("tournaments/:tournamentId/matches")
  getTournamentMatches(
    @Param("tournamentId") tournamentId: string,
    @Query("projectionVersion") projectionVersion?: string
  ): Promise<CanonicalMatchListEnvelope> {
    return this.service.getTournamentMatches(
      tournamentId,
      parseProjectionVersion(projectionVersion)
    );
  }

  @Get("tournaments/:tournamentId")
  getTournament(
    @Param("tournamentId") tournamentId: string,
    @Query("projectionVersion") projectionVersion?: string
  ): Promise<CanonicalTournamentDetailEnvelope> {
    return this.service.getTournament(
      tournamentId,
      parseProjectionVersion(projectionVersion)
    );
  }

  @Get("matches/:matchId")
  getMatch(
    @Param("matchId") matchId: string,
    @Query("projectionVersion") projectionVersion?: string
  ): Promise<CanonicalMatchDetailEnvelope> {
    return this.service.getMatch(
      matchId,
      parseProjectionVersion(projectionVersion)
    );
  }
}
