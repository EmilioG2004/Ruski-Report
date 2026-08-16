import {
  GameEventId,
  GamePhaseId,
  GameType,
  ISODateTimeString,
  MatchId,
  Metadata,
  PlayerId,
  TeamId,
  TournamentId
} from "./common";

export interface GameEvent {
  id: GameEventId;
  matchId: MatchId;
  tournamentId?: TournamentId;
  gameType: GameType;
  type: string;
  sequence: number;
  occurredAt?: ISODateTimeString;
  phaseId?: GamePhaseId;
  teamId?: TeamId;
  playerId?: PlayerId;
  value?: number;
  metadata?: Metadata;
}
