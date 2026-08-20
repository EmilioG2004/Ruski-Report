import {
  MatchId,
  PodId,
  RosterMembershipId,
  TournamentId,
  TournamentLifecycle,
  TournamentPlayerId,
  TournamentTeamId
} from "../../domain";

export interface CanonicalWorkbookGenerationIdentity {
  readonly id: string;
  readonly revision: number;
  readonly sourceDigest: string;
  readonly generatedAt: string;
}

export interface CanonicalWorkbookTournamentInput {
  readonly id: TournamentId;
  readonly name: string;
  readonly year: number;
  readonly lifecycle: TournamentLifecycle;
}

export interface CanonicalWorkbookPodInput {
  readonly id: PodId;
  readonly name: string;
  readonly sequence: number;
}

export interface CanonicalWorkbookPlayerInput {
  readonly id: TournamentPlayerId;
  readonly rosterMembershipId: RosterMembershipId;
  readonly rosterSlot: number;
  readonly displayName: string;
}

export interface CanonicalWorkbookTeamInput {
  readonly id: TournamentTeamId;
  readonly name: string;
  readonly sequence: number;
  readonly podId: PodId;
  readonly initialSeed: number;
  readonly players: readonly CanonicalWorkbookPlayerInput[];
}

export interface CanonicalWorkbookPodMatchInput {
  readonly id: MatchId;
  readonly podId: PodId;
  readonly stage: "pod_play";
  readonly sequence: number;
  readonly sequenceInPod: number;
  readonly roundNumber: number;
  readonly gameNumberForPair: number;
  readonly participantTeamIds: readonly [TournamentTeamId, TournamentTeamId];
  readonly participantRosters?: readonly [
    CanonicalWorkbookMatchParticipantRoster,
    CanonicalWorkbookMatchParticipantRoster
  ];
}

export interface CanonicalWorkbookMatchParticipantRoster {
  readonly teamId: TournamentTeamId;
  readonly players: readonly CanonicalWorkbookPlayerInput[];
}

export interface CanonicalWorkbookGenerationInput {
  readonly generation: CanonicalWorkbookGenerationIdentity;
  readonly tournament: CanonicalWorkbookTournamentInput;
  readonly pods: readonly CanonicalWorkbookPodInput[];
  readonly teams: readonly CanonicalWorkbookTeamInput[];
  readonly matches: readonly CanonicalWorkbookPodMatchInput[];
}

export type CanonicalWorkbookSheetManifestEntry =
  | {
      readonly order: number;
      readonly sheetId: "control" | "metadata";
      readonly sheetName: string;
      readonly sheetKind: "control" | "metadata";
      readonly matchId: null;
      readonly teamIds: readonly [];
      readonly baselineFingerprint: null;
    }
  | {
      readonly order: number;
      readonly sheetId: "blank-scorecard";
      readonly sheetName: string;
      readonly sheetKind: "blank";
      readonly matchId: null;
      readonly stage: null;
      readonly podId: null;
      readonly bracketMatchId: null;
      readonly teamIds: readonly [];
      readonly baselineFingerprint: string;
    }
  | {
      readonly order: number;
      readonly sheetId: string;
      readonly sheetName: string;
      readonly sheetKind: "game";
      readonly matchId: MatchId;
      readonly stage: "pod_play";
      readonly podId: PodId;
      readonly bracketMatchId: null;
      readonly teamIds: readonly [TournamentTeamId, TournamentTeamId];
      readonly baselineFingerprint: string;
    };

export interface GeneratedCanonicalWorkbook {
  readonly buffer: Buffer;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly semanticDigest: string;
  readonly manifest: readonly CanonicalWorkbookSheetManifestEntry[];
  readonly baselineFingerprints: Readonly<Record<string, string>>;
}
