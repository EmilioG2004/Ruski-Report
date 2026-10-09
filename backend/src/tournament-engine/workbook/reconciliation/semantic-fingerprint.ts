import { canonicalSha256 } from "../canonical-json";
import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_SCHEMA_VERSION
} from "../schema";
import {
  NormalizedWorkbookShotRow,
  WorkbookParticipantIdentity
} from "./types";

export interface SemanticSheetFingerprintInput {
  readonly tournamentId: string;
  readonly matchId: string;
  readonly stage: string;
  readonly podId?: string;
  readonly bracketMatchId?: string;
  readonly teamIds: readonly [string, string];
  readonly participants: readonly WorkbookParticipantIdentity[];
  readonly status: string;
  readonly rows: readonly NormalizedWorkbookShotRow[];
}

export function createSemanticSheetFingerprint(
  input: SemanticSheetFingerprintInput
): string {
  return canonicalSha256({
    workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
    scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
    tournamentId: input.tournamentId,
    matchId: input.matchId,
    stage: input.stage,
    podId: input.podId ?? null,
    bracketMatchId: input.bracketMatchId ?? null,
    status: input.status,
    sides: [1, 2].map((sideNumber) => ({
      sideNumber,
      teamId: input.teamIds[sideNumber - 1],
      players: [...input.participants]
        .filter((participant) => participant.sideNumber === sideNumber)
        .sort(compareParticipant)
        .map((participant) => ({
          playerId: participant.playerId,
          rosterMembershipId: participant.rosterMembershipId,
          rosterSlot: participant.rosterSlot
        })),
      shotRows: input.rows
        .filter((row) =>
          row.sideNumber === sideNumber && Object.values(row.markers).some(Boolean)
        )
        .map((row) => ({
          worksheetRow: row.worksheetRow,
          shotNumber: row.shotNumber,
          playerId: row.playerId,
          rosterMembershipId: row.rosterMembershipId,
          rosterSlot: row.rosterSlot,
          markers: row.markers
        }))
    }))
  });
}

export function createWorkbookParticipantDigest(
  participants: readonly WorkbookParticipantIdentity[]
): string {
  return canonicalSha256(
    [...participants]
      .sort(compareParticipant)
      .map((participant) => ({
        sideNumber: participant.sideNumber,
        teamId: participant.teamId,
        playerId: participant.playerId,
        rosterMembershipId: participant.rosterMembershipId,
        rosterSlot: participant.rosterSlot
      }))
  );
}

function compareParticipant(
  left: WorkbookParticipantIdentity,
  right: WorkbookParticipantIdentity
): number {
  return left.sideNumber - right.sideNumber ||
    left.rosterSlot - right.rosterSlot ||
    left.playerId.localeCompare(right.playerId);
}
