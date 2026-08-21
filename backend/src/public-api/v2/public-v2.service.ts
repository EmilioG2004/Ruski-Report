import { Inject, Injectable } from "@nestjs/common";

import {
  CanonicalMatchDetailEnvelope,
  CanonicalMatchListEnvelope,
  CanonicalPublicMatchSummary,
  CanonicalPublicProjectionRef,
  CanonicalTournamentDetailEnvelope,
  CanonicalTournamentDiscoveryEnvelope,
  PUBLIC_PROJECTION_CONTRACT_VERSION,
  PublicMatchStatus,
  PublicScoreAvailability
} from "../../tournament-engine/public-projection";
import {
  PUBLIC_PROJECTION_READ_REPOSITORY,
  PublicProjectionReadRepository
} from "./public-projection-read.repository";
import {
  invalidMaterializedProjection,
  publicResourceNotFound
} from "./public-v2.errors";

const MATCH_STATUSES = new Set<PublicMatchStatus>([
  "scheduled",
  "in_progress",
  "final",
  "forfeited",
  "cancelled",
  "postponed"
]);
const SCORE_AVAILABILITIES = new Set<PublicScoreAvailability>([
  "not_started",
  "partial",
  "complete",
  "unrecorded",
  "not_applicable"
]);

@Injectable()
export class PublicV2Service {
  constructor(
    @Inject(PUBLIC_PROJECTION_READ_REPOSITORY)
    private readonly repository: PublicProjectionReadRepository
  ) {}

  async listActiveTournaments(): Promise<CanonicalTournamentDiscoveryEnvelope> {
    const tournaments = await this.repository.listActiveTournaments();
    for (const item of tournaments) {
      assertProjection(item.projection);
      if (
        !isRecord(item.tournament) ||
        item.tournament.id !== item.projection.tournamentId
      ) {
        throw invalidMaterializedProjection();
      }
    }

    return {
      contractVersion: PUBLIC_PROJECTION_CONTRACT_VERSION,
      tournaments
    };
  }

  async getTournament(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalTournamentDetailEnvelope> {
    const envelope = await this.repository.findTournament(
      tournamentId,
      projectionVersion
    );
    if (envelope === null) {
      return this.throwTournamentNotFound(tournamentId, projectionVersion);
    }

    assertEnvelope(envelope, tournamentId, projectionVersion);
    if (!isRecord(envelope.tournament) || envelope.tournament.id !== tournamentId) {
      throw invalidMaterializedProjection();
    }
    for (const match of envelope.tournament.matches) {
      assertDisplayReadyMatch(match);
    }
    return envelope;
  }

  async getTournamentMatches(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchListEnvelope> {
    const envelope = await this.repository.findTournamentMatches(
      tournamentId,
      projectionVersion
    );
    if (envelope === null) {
      return this.throwTournamentNotFound(tournamentId, projectionVersion);
    }

    assertEnvelope(envelope, tournamentId, projectionVersion);
    if (!Array.isArray(envelope.matches)) {
      throw invalidMaterializedProjection();
    }
    for (const match of envelope.matches) {
      assertDisplayReadyMatch(match);
    }
    return envelope;
  }

  async getMatch(
    matchId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchDetailEnvelope> {
    const envelope = await this.repository.findMatch(matchId, projectionVersion);
    if (envelope === null) {
      throw publicResourceNotFound(
        "PUBLIC_MATCH_NOT_FOUND",
        "matchId",
        matchId
      );
    }

    assertEnvelope(envelope, undefined, projectionVersion);
    assertDisplayReadyMatch(envelope.match);
    if (envelope.match.id !== matchId) {
      throw invalidMaterializedProjection();
    }
    return envelope;
  }

  private async throwTournamentNotFound(
    tournamentId: string,
    projectionVersion: number | undefined
  ): Promise<never> {
    if (
      projectionVersion !== undefined &&
      await this.repository.hasPublicTournament(tournamentId)
    ) {
      throw publicResourceNotFound(
        "PUBLIC_PROJECTION_NOT_FOUND",
        "projectionVersion",
        projectionVersion
      );
    }

    throw publicResourceNotFound(
      "PUBLIC_TOURNAMENT_NOT_FOUND",
      "tournamentId",
      tournamentId
    );
  }
}

function assertEnvelope(
  envelope: {
    contractVersion: number;
    projection: CanonicalPublicProjectionRef;
  },
  tournamentId: string | undefined,
  requestedVersion: number | undefined
): void {
  if (envelope.contractVersion !== PUBLIC_PROJECTION_CONTRACT_VERSION) {
    throw invalidMaterializedProjection();
  }
  assertProjection(envelope.projection);
  if (
    (tournamentId !== undefined &&
      envelope.projection.tournamentId !== tournamentId) ||
    (requestedVersion !== undefined &&
      envelope.projection.version !== requestedVersion)
  ) {
    throw invalidMaterializedProjection();
  }
}

function assertProjection(projection: CanonicalPublicProjectionRef): void {
  if (
    !isRecord(projection) ||
    typeof projection.tournamentId !== "string" ||
    projection.tournamentId.length === 0 ||
    !Number.isSafeInteger(projection.version) ||
    projection.version <= 0 ||
    typeof projection.activatedAt !== "string" ||
    !Number.isFinite(Date.parse(projection.activatedAt)) ||
    projection.source !== "canonical"
  ) {
    throw invalidMaterializedProjection();
  }
}

function assertDisplayReadyMatch(match: CanonicalPublicMatchSummary): void {
  if (
    !isRecord(match) ||
    typeof match.id !== "string" ||
    match.id.length === 0 ||
    !MATCH_STATUSES.has(match.status) ||
    !SCORE_AVAILABILITIES.has(match.scoreAvailability) ||
    !Array.isArray(match.participants) ||
    match.participants.length !== 2
  ) {
    throw invalidMaterializedProjection();
  }

  const sides = new Set<number>();
  for (const participant of match.participants) {
    if (
      !isRecord(participant) ||
      (participant.side !== 1 && participant.side !== 2) ||
      !isRecord(participant.team) ||
      typeof participant.team.id !== "string" ||
      participant.team.id.length === 0 ||
      typeof participant.team.name !== "string" ||
      participant.team.name.length === 0 ||
      !Array.isArray(participant.players) ||
      participant.players.some((player) =>
        !isRecord(player) ||
        typeof player.id !== "string" ||
        player.id.length === 0 ||
        typeof player.displayName !== "string" ||
        player.displayName.length === 0
      )
    ) {
      throw invalidMaterializedProjection();
    }
    sides.add(participant.side);
  }

  if (sides.size !== 2) {
    throw invalidMaterializedProjection();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
