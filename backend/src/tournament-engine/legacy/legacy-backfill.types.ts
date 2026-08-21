export const LEGACY_BACKFILL_SCHEMA_VERSION = 2;
export const LEGACY_TOURNAMENT_YEAR = 2026;

export type LegacyLifecycle = "completed";
export type LegacyVisibility = "public";

export interface LegacyTournamentSource {
  legacyTournamentId: string;
  snapshotVersion: number;
  snapshotPublishedAt: string;
  year: number;
  name: string;
  gameType: string;
  status: string;
  format: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tournamentStatistics: LegacyTournamentStatisticTableSource[];
  teams: LegacyTeamSource[];
  players: LegacyPlayerSource[];
  rosterMemberships: LegacyRosterMembershipSource[];
  pods: LegacyPodSource[];
  matches: LegacyMatchSource[];
  standings: LegacyStandingSource[];
  bracket?: LegacyBracketSource;
  matchIdentities: LegacyMatchIdentitySource[];
}

export interface LegacyTeamSource {
  legacyTeamId: string;
  name: string;
  sequence: number;
  podSeed?: number;
  overallSeed?: number;
}

export interface LegacyPlayerSource {
  legacyPlayerId: string;
  displayName: string;
}

export interface LegacyRosterMembershipSource {
  legacyTeamId: string;
  legacyPlayerId: string;
  sequence: number;
}

export interface LegacyPodSource {
  legacyPodId: string;
  name: string;
  sequence: number;
  legacyTeamIds: string[];
  legacyMatchIds: string[];
}

export type LegacyMatchStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "cancelled"
  | "forfeited";

export interface LegacyMatchSource {
  legacyMatchId: string;
  sequence: number;
  status: LegacyMatchStatus;
  legacyPodId?: string;
  legacyBracketMatchId?: string;
  participants: LegacyMatchParticipantSource[];
  score: LegacyMatchScoreSource;
  events: LegacyMatchEventSource[];
  statistics: LegacyMatchStatisticSource[];
  scorecardRows: LegacyScorecardRowSource[];
  detailAvailability?: "recorded" | "unrecorded";
  updatedAt: string;
}

export interface LegacyMatchEventSource {
  legacyEventId: string;
  sequence: number;
  type: "make" | "miss" | "splash-out" | "guy" | "tri" | "di" | "vom";
  legacyTeamId: string;
  legacyPlayerId: string;
  legacyScorecardRowId?: string;
  attributionMethod:
    | "source_event_player_id"
    | "scorecard_player_id"
    | "stable_participant_key_alias"
    | "legacy_2026_explicit_alias";
  occurredAt?: string;
  phase?: string;
  turnNumber?: number;
  teamTurnOrder?: number;
  shotInTeamTurn?: number;
}

export interface LegacyMatchStatisticSource {
  subjectType: "team" | "player";
  legacyTeamId?: string;
  legacyPlayerId?: string;
  metricValues: Record<string, number | null>;
}

export interface LegacyScorecardRowSource {
  legacyScorecardRowId: string;
  sequence: number;
  legacyTeamId?: string;
  legacyPlayerId?: string;
  legacyEventIds: string[];
  values: Record<string, boolean | number | string | null>;
}

export interface LegacyTournamentStatisticTableSource {
  legacyTableId: string;
  scope: "season" | "playoffs";
  subjectType: "team" | "player";
  rows: LegacyTournamentStatisticRowSource[];
}

export interface LegacyTournamentStatisticRowSource {
  rank: number;
  legacyTeamId?: string;
  legacyPlayerId?: string;
  metricValues: Record<string, number | null>;
}

export interface LegacyMatchParticipantSource {
  legacyTeamId: string;
  legacyPlayerIds: string[];
  seed?: number;
  score?: number;
  result?: "win" | "loss" | "tie" | "pending";
}

export interface LegacyMatchScoreSource {
  participants: Array<{
    legacyTeamId: string;
    score: number;
  }>;
  legacyWinnerTeamId?: string;
  isFinal: boolean;
  availability?: "recorded" | "unrecorded";
}

export interface LegacyStandingSource {
  legacyStandingId: string;
  legacyTeamId: string;
  legacyPodId?: string;
  scope: "pod" | "tournament";
  rank: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  points?: number;
  metricValues: Record<string, number | null>;
}

export interface LegacyBracketSource {
  legacyBracketId: string;
  name: string;
  rounds: LegacyBracketRoundSource[];
}

export interface LegacyBracketRoundSource {
  legacyRoundId: string;
  name: string;
  sequence: number;
  matches: LegacyBracketMatchSource[];
}

export interface LegacyBracketMatchSource {
  legacyBracketMatchId: string;
  legacyMatchId?: string;
  sequence: number;
  status: "scheduled" | "in_progress" | "completed" | "pending";
  slots: LegacyBracketSlotSource[];
  legacyWinnerTeamId?: string;
}

export interface LegacyBracketSlotSource {
  sequence: number;
  seed?: number;
  legacyTeamId?: string;
  sourceType?: "team" | "match-winner" | "match-loser" | "bye" | "tbd";
  legacySourceBracketMatchId?: string;
  label?: string;
}

export interface LegacyMatchIdentitySource {
  legacyMatchId: string;
  commentIds: string[];
  reportIds: string[];
}

export type LegacyEntityKind =
  | "tournament"
  | "team"
  | "player"
  | "roster_membership"
  | "pod"
  | "match"
  | "match_revision"
  | "scoring_event"
  | "standing_calculation"
  | "standing"
  | "pod_finalization"
  | "seed_calculation"
  | "seed"
  | "bracket"
  | "bracket_round"
  | "bracket_match"
  | "bracket_slot";

export interface LegacyIdentityMapping {
  entityKind: LegacyEntityKind;
  legacyKey: string;
  canonicalId: string;
  publicKey: string;
}

export interface CanonicalLegacyTournament {
  id: string;
  publicKey: string;
  legacyTournamentId: string;
  year: number;
  name: string;
  gameType: string;
  lifecycle: LegacyLifecycle;
  visibility: LegacyVisibility;
  format: Record<string, unknown>;
  configuration: CanonicalLegacyTournamentConfiguration;
  sourceStatistics: LegacyTournamentStatisticTableSource[];
}

export interface CanonicalLegacyTournamentConfiguration {
  formatVersion: 1;
  formatType: "pod_and_single_elimination";
  teamCount: number;
  podCount: number;
  podSizes: number[];
  playersPerTeam: number;
  gamesPerPair: 1;
  qualifiersPerPod: number;
  bracketSize: number;
  allowByes: boolean;
  standingsRules: [
    "record",
    "cupDifferential",
    "teamShootingPercentage",
    "administratorResolution"
  ];
}

export interface CanonicalLegacyTeam {
  id: string;
  publicKey: string;
  legacyTeamId: string;
  name: string;
  sequence: number;
  initialPodSeed?: number;
}

export interface CanonicalLegacyPlayer {
  id: string;
  publicKey: string;
  legacyPlayerId: string;
  displayName: string;
}

export interface CanonicalLegacyRosterMembership {
  id: string;
  publicKey: string;
  legacyTeamId: string;
  legacyPlayerId: string;
  teamId: string;
  playerId: string;
  sequence: number;
  effectiveFrom: string;
}

export interface CanonicalLegacyPod {
  id: string;
  publicKey: string;
  legacyPodId: string;
  name: string;
  sequence: number;
  teamIds: string[];
  matchIds: string[];
}

export type CanonicalMatchStage = "pod_play" | "playoffs" | "legacy_unknown";
export type CanonicalScoreAvailability =
  | "not_started"
  | "partial"
  | "complete"
  | "unrecorded"
  | "not_applicable";

export interface CanonicalLegacyMatch {
  id: string;
  publicKey: string;
  legacyMatchId?: string;
  legacyBracketMatchId?: string;
  sequence?: number;
  stage: CanonicalMatchStage;
  status?: LegacyMatchStatus;
  scoreAvailability: CanonicalScoreAvailability;
  podId?: string;
  bracketMatchId?: string;
  identityOnly: boolean;
  sourceSnapshotBacked: boolean;
}

export interface CanonicalLegacyMatchRevision {
  id: string;
  publicKey: string;
  legacyMatchId?: string;
  matchId: string;
  revisionNumber: 1;
  sourceSnapshotVersion: number;
  sourceUpdatedAt: string;
  participants: CanonicalLegacyMatchParticipant[];
  scores: CanonicalLegacyTeamScore[];
  winnerTeamId?: string;
  isFinal: boolean;
  events: CanonicalLegacyMatchEvent[];
  sourceStatistics: CanonicalLegacyMatchStatistic[];
  sourceScorecardRows: LegacyScorecardRowSource[];
}

export interface CanonicalLegacyMatchStatistic {
  subjectType: "team" | "player";
  teamId?: string;
  playerId?: string;
  metricValues: Record<string, number | null>;
}

export interface CanonicalLegacyMatchEvent {
  id: string;
  publicKey: string;
  legacyEventId: string;
  sequence: number;
  type: "shot_attempt" | "vom";
  teamId: string;
  playerId: string;
  legacyScorecardRowId?: string;
  attributionMethod: LegacyMatchEventSource["attributionMethod"];
  occurredAt?: string;
  sourceReference: string;
  shotAttempt?: {
    outcome: "make" | "miss";
    classification?: "guy" | "di" | "tri" | "splash_out";
    cupDelta: number;
    phase?: string;
    turnNumber?: number;
    teamTurnOrder?: number;
    shotInTeamTurn?: number;
  };
}

export interface CanonicalLegacyStandingCalculation {
  id: string;
  scope: "pod" | "tournament";
  podId?: string;
  inputDigest: string;
  standingIds: string[];
}

export interface CanonicalLegacyPodFinalization {
  id: string;
  podId: string;
  calculationId: string;
}

export interface CanonicalLegacyMatchParticipant {
  teamId: string;
  playerIds: string[];
  seed?: number;
  score?: number;
  result?: "win" | "loss" | "tie" | "pending";
}

export interface CanonicalLegacyTeamScore {
  teamId: string;
  score: number;
}

export interface CanonicalLegacyStanding {
  id: string;
  publicKey: string;
  calculationId: string;
  legacyStandingId: string;
  teamId: string;
  podId?: string;
  scope: "pod" | "tournament";
  rank: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
  points?: number;
  metricValues: Record<string, number | null>;
}

export interface CanonicalLegacySeed {
  id: string;
  publicKey: string;
  legacyTeamId: string;
  legacySeedKey: string;
  teamId: string;
  initialPodSeed?: number;
  calculatedPlayoffSeed?: number;
  effectivePlayoffSeed?: number;
  qualified: boolean;
}

export interface CanonicalLegacySeedCalculation {
  id: string;
  inputDigest: string;
}

export interface CanonicalLegacyBracket {
  id: string;
  publicKey: string;
  legacyBracketId: string;
  name: string;
  rounds: CanonicalLegacyBracketRound[];
}

export interface CanonicalLegacyBracketRound {
  id: string;
  publicKey: string;
  legacyRoundId: string;
  name: string;
  sequence: number;
  matches: CanonicalLegacyBracketMatch[];
}

export interface CanonicalLegacyBracketMatch {
  id: string;
  publicKey: string;
  legacyBracketMatchId: string;
  matchId: string;
  sequence: number;
  status: "scheduled" | "in_progress" | "completed" | "pending";
  winnerTeamId?: string;
  slots: CanonicalLegacyBracketSlot[];
}

export interface CanonicalLegacyBracketSlot {
  id: string;
  publicKey: string;
  sequence: number;
  seed?: number;
  teamId?: string;
  sourceType?: "team" | "match-winner" | "match-loser" | "bye" | "tbd";
  sourceBracketMatchId?: string;
  label?: string;
}

export interface CanonicalLegacyIdentityReference {
  legacyMatchId: string;
  canonicalMatchId: string;
  commentIds: string[];
  reportIds: string[];
}

export interface LegacyBackfillCounts {
  tournaments: number;
  teams: number;
  players: number;
  rosterMemberships: number;
  pods: number;
  matches: number;
  identityOnlyMatches: number;
  matchRevisions: number;
  matchParticipants: number;
  standingCalculations: number;
  standingCalculationMatches: number;
  standings: number;
  podFinalizations: number;
  podFinalizationProvenance: number;
  seedCalculations: number;
  seeds: number;
  brackets: number;
  bracketRounds: number;
  bracketMatches: number;
  bracketSlots: number;
  scoringEvents: number;
  shotAttempts: number;
  shotClassifications: number;
  statisticRuns: number;
  statisticValues: number;
  activeStatisticRuns: number;
  activePodStandingCalculations: number;
  activeTournamentStandingCalculations: number;
  seedCalculationFinalizations: number;
  activeSeedCalculations: number;
  bracketPublications: number;
  activeBrackets: number;
  bracketResolutions: number;
  activeBracketResolutions: number;
  bracketAdvancements: number;
  projectionVersions: number;
  tournamentProjectionPayloads: number;
  matchProjectionPayloads: number;
  projectionActivations: number;
}

export interface LegacyBackfillPlan {
  schemaVersion: number;
  legacyTournamentId: string;
  sourceSnapshotVersion: number;
  sourceSnapshotPublishedAt: string;
  sourceDigest: string;
  planDigest: string;
  mappingDigest: string;
  counts: LegacyBackfillCounts;
  tournament: CanonicalLegacyTournament;
  teams: CanonicalLegacyTeam[];
  players: CanonicalLegacyPlayer[];
  rosterMemberships: CanonicalLegacyRosterMembership[];
  pods: CanonicalLegacyPod[];
  matches: CanonicalLegacyMatch[];
  matchRevisions: CanonicalLegacyMatchRevision[];
  standingCalculations: CanonicalLegacyStandingCalculation[];
  standings: CanonicalLegacyStanding[];
  podFinalizations: CanonicalLegacyPodFinalization[];
  seedCalculation?: CanonicalLegacySeedCalculation;
  seeds: CanonicalLegacySeed[];
  bracket?: CanonicalLegacyBracket;
  identityReferences: CanonicalLegacyIdentityReference[];
  mappings: LegacyIdentityMapping[];
}

export interface LegacyBackfillRecordedState {
  legacyTournamentId: string;
  sourceSnapshotVersion: number;
  sourceDigest: string;
  planDigest: string;
  mappingDigest: string;
  counts: LegacyBackfillCounts;
  /** Present only on the atomic apply path to distinguish a lock-race no-op. */
  wasApplied?: boolean;
}

export type LegacyBackfillRunStatus =
  | "dry_run"
  | "applied"
  | "no_op"
  | "mismatch"
  | "failed";

export interface LegacyBackfillIssue {
  code: string;
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface LegacyBackfillRunRecord {
  runId: string;
  legacyTournamentId: string;
  dryRun: boolean;
  status: LegacyBackfillRunStatus;
  startedAt: string;
  completedAt: string;
  sourceSnapshotVersion?: number;
  sourceDigest?: string;
  planDigest?: string;
  mappingDigest?: string;
  counts?: LegacyBackfillCounts;
  issues: LegacyBackfillIssue[];
}

export interface LegacyBackfillRunResult extends LegacyBackfillRunRecord {
  retryable: boolean;
}
