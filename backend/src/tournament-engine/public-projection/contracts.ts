import { CopiedTournamentConfiguration } from "../configuration";

export const PUBLIC_PROJECTION_CONTRACT_VERSION = 2 as const;

export type PublicTournamentLifecycle =
  | "draft_setup"
  | "setup_published"
  | "pod_play"
  | "seeding_review"
  | "playoffs"
  | "completed"
  | "archived";

export type PublicMatchStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "forfeited"
  | "cancelled"
  | "postponed";

export type PublicScoreAvailability =
  | "not_started"
  | "partial"
  | "complete"
  | "unrecorded"
  | "not_applicable";

export interface CanonicalPublicProjectionRef {
  tournamentId: string;
  version: number;
  activatedAt: string;
  source: "canonical";
}

export interface CanonicalPublicPlayer {
  id: string;
  displayName: string;
  rosterSlot: number;
}

export interface CanonicalPublicTeamIdentity {
  id: string;
  name: string;
}

export interface CanonicalPublicRosterTeam extends CanonicalPublicTeamIdentity {
  podId: string;
  initialPodSeed: number;
  players: readonly CanonicalPublicPlayer[];
}

export type CanonicalPublicParticipantResult =
  | "win"
  | "loss"
  | "tie"
  | "cancelled"
  | "forfeited";

export interface CanonicalPublicMatchParticipant {
  side: 1 | 2;
  role: "home" | "away";
  team: CanonicalPublicTeamIdentity;
  players: readonly CanonicalPublicPlayer[];
  seed: number | null;
  score: number | null;
  result: CanonicalPublicParticipantResult | null;
}

export interface CanonicalPublicMatchCorrection {
  isCorrection: boolean;
  reason: string | null;
  previousRevision: number | null;
  replacesMatchId: string | null;
  replacedByMatchId: string | null;
}

export interface CanonicalPublicMatchTimestamps {
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export interface CanonicalPublicMatchSummary {
  id: string;
  sequence: number;
  stage: "pod_play" | "playoffs";
  podId: string | null;
  bracketMatchId: string | null;
  instance: number;
  revision: number | null;
  status: PublicMatchStatus;
  scoreAvailability: PublicScoreAvailability;
  correction: CanonicalPublicMatchCorrection;
  timestamps: CanonicalPublicMatchTimestamps;
  participants: readonly CanonicalPublicMatchParticipant[];
  winner: CanonicalPublicTeamIdentity | null;
}

export interface CanonicalPublicMatchEvent {
  id: string;
  sequence: number;
  type: string;
  teamId: string | null;
  playerId: string | null;
  occurredAt: string | null;
  details: Readonly<Record<string, unknown>>;
}

export interface CanonicalPublicBoxScoreColumn {
  key: string;
  label: string;
  format: "integer" | "percentage";
}

export interface CanonicalPublicBoxScoreRow {
  id: string;
  subject: { id: string; displayName: string; type: "player" | "team" };
  teamId: string;
  values: Readonly<Record<string, number | null>>;
}

export interface CanonicalPublicBoxScore {
  columns: readonly CanonicalPublicBoxScoreColumn[];
  rows: readonly CanonicalPublicBoxScoreRow[];
  totals: Readonly<Record<string, number | null>>;
}

export interface CanonicalPublicScorecardColumn {
  key: string;
  label: string;
  kind: "sequence" | "participant" | "value" | "marker";
}

export interface CanonicalPublicScorecardRow {
  id: string;
  sequence: number;
  side: 1 | 2;
  teamId: string;
  playerId: string | null;
  playerDisplayName: string | null;
  values: Readonly<Record<string, boolean | number | string | null>>;
}

export interface CanonicalPublicScorecard {
  columns: readonly CanonicalPublicScorecardColumn[];
  rows: readonly CanonicalPublicScorecardRow[];
}

export interface CanonicalPublicMatch extends CanonicalPublicMatchSummary {
  events: readonly CanonicalPublicMatchEvent[];
  statistics: readonly CanonicalPublicStatistic[];
  boxScore: CanonicalPublicBoxScore | null;
  scorecard: CanonicalPublicScorecard | null;
}

export interface CanonicalPublicStandingRow {
  team: CanonicalPublicTeamIdentity;
  rank: number | null;
  wins: number;
  losses: number;
  cupDifferential: number;
  makes: number;
  attempts: number;
  shootingPercentage: number | null;
  tieGroup: string | null;
  administratorResolved: boolean;
}

export interface CanonicalPublicPod {
  id: string;
  name: string;
  sequence: number;
  standingState: "zero_game" | "active" | "finalized" | "unresolved_tie";
  finalizedAt: string | null;
  standings: readonly CanonicalPublicStandingRow[];
}

export interface CanonicalPublicSeed {
  team: CanonicalPublicTeamIdentity;
  calculatedSeed: number | null;
  effectiveSeed: number | null;
  overridden: boolean;
}

export interface CanonicalPublicStatistic {
  scope: "match" | "player" | "team" | "pod" | "stage" | "tournament";
  scopeId: string;
  stage: "pod_play" | "playoffs" | null;
  subject: CanonicalPublicTeamIdentity | { id: string; displayName: string } | null;
  values: Readonly<Record<string, number | null>>;
}

export type CanonicalPublicBracketSlot =
  | {
      source: "team";
      team: CanonicalPublicTeamIdentity;
      seed: number | null;
    }
  | {
      source: "match_winner";
      sourceBracketMatchId: string;
      team: CanonicalPublicTeamIdentity | null;
      seed: number | null;
    }
  | { source: "bye"; team: null; seed: null }
  | { source: "tbd"; team: null; seed: null };

export interface CanonicalPublicBracketMatch {
  id: string;
  round: number;
  position: number;
  status: "pending" | "in_progress" | "completed" | "bye" | "corrected";
  matchId: string | null;
  replacedMatchId: string | null;
  slots: readonly [CanonicalPublicBracketSlot, CanonicalPublicBracketSlot];
  winner: CanonicalPublicTeamIdentity | null;
}

export interface CanonicalPublicBracketRound {
  id: string;
  name: string;
  sequence: number;
  matches: readonly CanonicalPublicBracketMatch[];
}

export interface CanonicalPublicBracket {
  id: string;
  name: string;
  size: number;
  rounds: readonly CanonicalPublicBracketRound[];
}

export interface CanonicalPublicTournamentSummary {
  id: string;
  gameType: string;
  year: number;
  name: string;
  lifecycle: PublicTournamentLifecycle;
}

export interface CanonicalPublicTournament extends CanonicalPublicTournamentSummary {
  format: CopiedTournamentConfiguration;
  rosters: readonly CanonicalPublicRosterTeam[];
  pods: readonly CanonicalPublicPod[];
  seeds: readonly CanonicalPublicSeed[];
  statistics: readonly CanonicalPublicStatistic[];
  matches: readonly CanonicalPublicMatchSummary[];
  bracket: CanonicalPublicBracket | null;
}

export interface CanonicalTournamentDiscoveryItem {
  projection: CanonicalPublicProjectionRef;
  tournament: CanonicalPublicTournamentSummary;
}

export interface CanonicalTournamentDiscoveryEnvelope {
  contractVersion: typeof PUBLIC_PROJECTION_CONTRACT_VERSION;
  tournaments: readonly CanonicalTournamentDiscoveryItem[];
}

export interface CanonicalTournamentDetailEnvelope {
  contractVersion: typeof PUBLIC_PROJECTION_CONTRACT_VERSION;
  projection: CanonicalPublicProjectionRef;
  tournament: CanonicalPublicTournament;
}

export interface CanonicalMatchListEnvelope {
  contractVersion: typeof PUBLIC_PROJECTION_CONTRACT_VERSION;
  projection: CanonicalPublicProjectionRef;
  matches: readonly CanonicalPublicMatchSummary[];
}

export interface CanonicalMatchDetailEnvelope {
  contractVersion: typeof PUBLIC_PROJECTION_CONTRACT_VERSION;
  projection: CanonicalPublicProjectionRef;
  match: CanonicalPublicMatch;
}

export interface CanonicalPublicProjectionPayloadSet {
  tournament: CanonicalPublicTournament;
  matches: readonly CanonicalPublicMatch[];
}
