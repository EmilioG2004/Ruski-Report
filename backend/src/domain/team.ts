import { Metadata, TeamId, TournamentId } from "./common";
import { Player } from "./player";

export interface TeamSeed {
  overall?: number;
  pod?: number;
  label?: string;
}

export interface Team {
  id: TeamId;
  tournamentId: TournamentId;
  name: string;
  seed?: TeamSeed;
  players: Player[];
  metadata?: Metadata;
}
