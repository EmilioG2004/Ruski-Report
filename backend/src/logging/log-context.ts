import { GameType, MatchId, Metadata, TournamentId } from "../domain";

export type LogLevel = "debug" | "info" | "warning" | "error";

export interface LogContext {
  component?: string;
  operation?: string;
  requestId?: string;
  gameType?: GameType;
  tournamentId?: TournamentId;
  matchId?: MatchId;
  uploadId?: string;
  error?: Error;
  metadata?: Metadata;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  component?: string;
  operation?: string;
  requestId?: string;
  gameType?: GameType;
  tournamentId?: TournamentId;
  matchId?: MatchId;
  uploadId?: string;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
  metadata?: Metadata;
}
