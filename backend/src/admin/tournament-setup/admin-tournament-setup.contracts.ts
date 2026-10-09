import {
  CopiedTournamentConfiguration,
  TournamentFormatConfiguration
} from "../../tournament-engine/configuration";
import {
  TournamentLifecycle,
  TournamentVisibility
} from "../../tournament-engine/domain";

export interface AdminTournamentValidationIssue {
  code: string;
  message: string;
  path: string;
}

export interface AdminScheduledPodMatchResponse {
  id: string;
  tournamentId: string;
  podId: string;
  stage: "pod_play";
  sequence: number;
  sequenceInPod: number;
  roundNumber: number;
  gameNumberForPair: number;
  participantTeamIds: readonly [string, string];
  status: "scheduled";
  scoreAvailability: "not_started";
  scheduledAt: string | null;
}

export interface CreateAdminTournamentRequest {
  name?: unknown;
  year?: unknown;
  configuration?: unknown;
}

export type ValidatedTournamentConfigurationSelection =
  | { kind: "preset"; presetId: "ruski-main-32-team" }
  | { kind: "advanced"; value: TournamentFormatConfiguration };

export interface ReplaceAdminTournamentSetupRequest {
  expectedRowVersion?: unknown;
  pods?: unknown;
  teams?: unknown;
}

export interface PreviewAdminTournamentSetupRequest {
  expectedRowVersion?: unknown;
}

export interface PublishAdminTournamentSetupRequest {
  expectedRowVersion?: unknown;
  previewDigest?: unknown;
  visibility?: unknown;
}

export interface AdminTournamentSummaryResponse {
  id: string;
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

export interface AdminTournamentSetupPlayerResponse {
  id: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
}

export interface AdminTournamentSetupTeamResponse {
  id: string;
  name: string;
  sequence: number;
  podId: string;
  initialSeed: number;
  players: AdminTournamentSetupPlayerResponse[];
}

export interface AdminTournamentSetupPodResponse {
  id: string;
  name: string;
  sequence: number;
}

export interface AdminTournamentDetailResponse {
  tournament: AdminTournamentSummaryResponse;
  configuration: CopiedTournamentConfiguration;
  pods: AdminTournamentSetupPodResponse[];
  teams: AdminTournamentSetupTeamResponse[];
  validation: {
    publishable: boolean;
    issues: readonly AdminTournamentValidationIssue[];
  };
}

export interface AdminTournamentSetupPreviewResponse {
  tournamentId: string;
  rowVersion: number;
  publishable: boolean;
  issues: readonly AdminTournamentValidationIssue[];
  previewDigest: string | null;
  matchCount: number;
  matches: readonly AdminScheduledPodMatchResponse[];
}

export interface AdminTournamentSetupPublicationResponse {
  tournamentId: string;
  lifecycle: Extract<TournamentLifecycle, "setup_published">;
  visibility: TournamentVisibility;
  rowVersion: number;
  setupPublishedAt: string;
  matchCount: number;
}
