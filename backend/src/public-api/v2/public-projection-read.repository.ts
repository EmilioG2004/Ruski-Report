import {
  CanonicalMatchDetailEnvelope,
  CanonicalMatchListEnvelope,
  CanonicalTournamentDetailEnvelope,
  CanonicalTournamentDiscoveryItem
} from "../../tournament-engine/public-projection";

export const PUBLIC_PROJECTION_READ_REPOSITORY = Symbol(
  "PUBLIC_PROJECTION_READ_REPOSITORY"
);

export interface VisiblePublicMatchReference {
  matchId: string;
  tournamentId: string;
  projectionVersion: number;
}

export interface PublicProjectionReadRepository {
  listActiveTournaments(): Promise<readonly CanonicalTournamentDiscoveryItem[]>;
  hasPublicTournament(tournamentId: string): Promise<boolean>;
  findTournament(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalTournamentDetailEnvelope | null>;
  findTournamentMatches(
    tournamentId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchListEnvelope | null>;
  findMatch(
    matchId: string,
    projectionVersion?: number
  ): Promise<CanonicalMatchDetailEnvelope | null>;
  findVisibleMatchReference(
    matchId: string
  ): Promise<VisiblePublicMatchReference | null>;
}
