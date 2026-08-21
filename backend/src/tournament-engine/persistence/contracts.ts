import { CopiedTournamentConfiguration } from "../configuration";
import {
  MatchId,
  MatchRevisionId,
  MatchStatus,
  PodId,
  RosterMembershipId,
  ScoreAvailability,
  ScoringEventId,
  ScoringWriterMode,
  TournamentId,
  TournamentLifecycle,
  TournamentPlayerId,
  TournamentTeamId,
  TournamentVisibility
} from "../domain";

export type EngineMetadata = Record<string, unknown>;

export interface EngineAuditActor {
  kind: "administrator" | "system" | "legacy_backfill";
  id?: string;
}

export interface EngineAuditCommand {
  eventId: string;
  commandType: string;
  actor: EngineAuditActor;
  occurredAt: string;
  correlationId?: string;
  causationId?: string;
  details?: EngineMetadata;
}

export interface DraftPlayerInput {
  id: TournamentPlayerId;
  publicKey: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  membershipId: RosterMembershipId;
  membershipPublicKey: string;
  rosterSlot: number;
  metadata?: EngineMetadata;
}

export interface DraftTeamInput {
  id: TournamentTeamId;
  publicKey: string;
  name: string;
  normalizedName: string;
  sequence: number;
  podId: PodId;
  initialSeed: number;
  players: readonly DraftPlayerInput[];
  metadata?: EngineMetadata;
}

export interface DraftPodInput {
  id: PodId;
  publicKey: string;
  name: string;
  normalizedName: string;
  sequence: number;
  metadata?: EngineMetadata;
}

export interface CreateTournamentDraftInput {
  tournament: {
    id: TournamentId;
    publicKey: string;
    gameType: string;
    year: number;
    name: string;
    visibility: TournamentVisibility;
    metadata?: EngineMetadata;
  };
  configuration: CopiedTournamentConfiguration;
  pods: readonly DraftPodInput[];
  teams: readonly DraftTeamInput[];
  createdAt: string;
  audit: EngineAuditCommand;
}

export interface PublishTournamentSetupInput {
  tournamentId: TournamentId;
  expectedRowVersion: number;
  expectedPreviewDigest: string;
  visibility: TournamentVisibility;
  publishedAt: string;
  audit: EngineAuditCommand;
}

export interface TournamentCommandResult {
  tournamentId: TournamentId;
  lifecycle: TournamentLifecycle;
  rowVersion: number;
}

export interface AdminTournamentSummaryRecord {
  tournamentId: TournamentId;
  publicKey: string;
  gameType: string;
  year: number;
  name: string;
  lifecycle: TournamentLifecycle;
  visibility: TournamentVisibility;
  rowVersion: number;
  setupPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminTournamentSetupPlayerRecord extends DraftPlayerInput {}

export interface AdminTournamentSetupTeamRecord extends DraftTeamInput {}

export interface AdminTournamentSetupRecord {
  tournament: AdminTournamentSummaryRecord;
  configuration: CopiedTournamentConfiguration;
  pods: readonly DraftPodInput[];
  teams: readonly AdminTournamentSetupTeamRecord[];
}

export interface ReplaceTournamentDraftInput {
  tournamentId: TournamentId;
  expectedRowVersion: number;
  pods: readonly DraftPodInput[];
  teams: readonly DraftTeamInput[];
  updatedAt: string;
  audit: EngineAuditCommand;
}

export interface PublishedTournamentSetupResult extends TournamentCommandResult {
  matchCount: number;
  setupPublishedAt: string;
}

export interface ReplaceRosterPlayerInput {
  tournamentId: TournamentId;
  teamId: TournamentTeamId;
  expectedTournamentRowVersion: number;
  replacedMembershipId: RosterMembershipId;
  replacement: DraftPlayerInput;
  effectiveAt: string;
  reason: string;
  actorId: string;
  audit: EngineAuditCommand;
}

export interface RosterReplacementResult extends TournamentCommandResult {
  closedMembershipId: RosterMembershipId;
  openedMembershipId: RosterMembershipId;
  playerId: TournamentPlayerId;
}

export interface MatchRevisionTeamInput {
  sideNumber: 1 | 2;
  teamId: TournamentTeamId;
  displayName: string;
  score?: number;
  result: "pending" | "win" | "loss" | "tie" | "cancelled" | "forfeited";
  players: readonly {
    playerId: TournamentPlayerId;
    rosterMembershipId?: RosterMembershipId;
    rosterSlot: number;
    displayName: string;
    metadata?: EngineMetadata;
  }[];
  metadata?: EngineMetadata;
}

export interface MatchRevisionEventInput {
  id: ScoringEventId;
  sequence: number;
  type:
    | "shot_attempt"
    | "vom"
    | "forfeit"
    | "cancellation"
    | "postponement"
    | "phase_transition"
    | "operator_correction";
  teamId?: TournamentTeamId;
  playerId?: TournamentPlayerId;
  occurredAt?: string;
  sourceReference?: string;
  shotAttempt?: {
    outcome: "make" | "miss";
    classification?: "guy" | "di" | "tri" | "splash_out";
    cupDelta: number;
    phase?: string;
    turnNumber?: number;
    teamTurnOrder?: number;
    shotInTeamTurn?: number;
  };
  metadata?: EngineMetadata;
}

export interface ActivateMatchRevisionInput {
  tournamentId: TournamentId;
  matchId: MatchId;
  expectedMatchRowVersion: number;
  revision: {
    id: MatchRevisionId;
    publicKey: string;
    revisionNumber: number;
    previousRevisionId?: MatchRevisionId;
    status: MatchStatus;
    scoreAvailability: ScoreAvailability;
    reason:
      | "initial"
      | "workbook_update"
      | "correction"
      | "operator_resolution"
      | "in_app_scoring"
      | "legacy_backfill";
    sourceAdapter:
      | "excel_import"
      | "in_app_live"
      | "operator_correction"
      | "legacy_backfill";
    sourceReference?: string;
    actorId: string;
    correctionReason?: string;
    confirmationDigest?: string;
    createdAt: string;
    metadata?: EngineMetadata;
  };
  teams: readonly MatchRevisionTeamInput[];
  events: readonly MatchRevisionEventInput[];
  writerFence?: {
    mode: ScoringWriterMode;
    holderId: string;
    fencingToken: number;
    checkedAt: string;
  };
  audit: EngineAuditCommand;
}

export interface MatchRevisionActivationResult {
  tournamentId: TournamentId;
  matchId: MatchId;
  revisionId: MatchRevisionId;
  matchRowVersion: number;
}

export interface AcquireMatchWriterInput {
  tournamentId: TournamentId;
  matchId: MatchId;
  mode: ScoringWriterMode;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
}

export type MatchWriterLeaseResult =
  | {
      acquired: true;
      fencingToken: number;
      expiresAt: string;
    }
  | {
      acquired: false;
      activeMode: ScoringWriterMode;
      activeHolderId: string;
      expiresAt: string;
    };

export interface ReleaseMatchWriterInput {
  tournamentId: TournamentId;
  matchId: MatchId;
  holderId: string;
  fencingToken: number;
  releasedAt: string;
}

export interface CreateProjectionVersionInput {
  tournamentId: TournamentId;
  version: number;
  payloadSchemaVersion: number;
  sourceDigest: string;
  createdAt: string;
  readyAt: string;
  legacyProjection?: {
    tournamentId: string;
    snapshotVersion: number;
  };
  metadata?: EngineMetadata;
}

export interface ActivateProjectionVersionInput {
  tournamentId: TournamentId;
  version: number;
  expectedTournamentRowVersion: number;
  activatedAt: string;
  audit: EngineAuditCommand;
}

export interface ProjectionActivationResult extends TournamentCommandResult {
  projectionVersion: number;
}

export interface TournamentSetupRepositoryContract {
  list(): Promise<readonly AdminTournamentSummaryRecord[]>;
  findById(tournamentId: TournamentId): Promise<AdminTournamentSetupRecord | null>;
  createDraft(input: CreateTournamentDraftInput): Promise<TournamentCommandResult>;
  replaceDraft(
    input: ReplaceTournamentDraftInput
  ): Promise<TournamentCommandResult>;
  publishSetup(
    input: PublishTournamentSetupInput
  ): Promise<PublishedTournamentSetupResult>;
}

export interface RosterRepositoryContract {
  replacePlayer(input: ReplaceRosterPlayerInput): Promise<RosterReplacementResult>;
}

export interface MatchRevisionRepositoryContract {
  activateRevision(
    input: ActivateMatchRevisionInput
  ): Promise<MatchRevisionActivationResult>;
}

export interface MatchWriterRepositoryContract {
  acquire(input: AcquireMatchWriterInput): Promise<MatchWriterLeaseResult>;
  release(input: ReleaseMatchWriterInput): Promise<boolean>;
}

export interface ProjectionRepositoryContract {
  createReadyVersion(input: CreateProjectionVersionInput): Promise<void>;
  activate(
    input: ActivateProjectionVersionInput
  ): Promise<ProjectionActivationResult>;
}
