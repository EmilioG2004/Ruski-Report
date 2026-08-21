import { canonicalSha256 } from "../canonical-json";
import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_SCHEMA_VERSION
} from "../schema";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookMatchInput,
  CanonicalWorkbookTeamInput
} from "./types";

export interface ScheduledScorecardBaselineInput {
  readonly tournamentId: string;
  readonly match: CanonicalWorkbookMatchInput;
  readonly teams: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput];
}

export function createBlankScorecardBaselineFingerprint(
  tournamentId: string
): string {
  return canonicalSha256({
    workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
    scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
    tournamentId,
    matchId: null,
    stage: null,
    podId: null,
    bracketMatchId: null,
    status: "SCHEDULED",
    sides: []
  });
}

export function createScheduledScorecardBaselineFingerprint(
  input: ScheduledScorecardBaselineInput
): string {
  return canonicalSha256(createScorecardBaseline(input));
}

export function createScheduledScorecardBaseline(
  input: ScheduledScorecardBaselineInput
): unknown {
  return createScorecardBaseline(input);
}

function createScorecardBaseline(
  input: ScheduledScorecardBaselineInput
): unknown {
  const source = input.match.scorecardSource;
  return {
    workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
    scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
    tournamentId: input.tournamentId,
    matchId: input.match.id,
    stage: input.match.stage,
    podId: input.match.stage === "pod_play" ? input.match.podId : null,
    bracketMatchId: input.match.stage === "playoffs"
      ? input.match.bracketMatchId
      : null,
    status: source?.status ?? "SCHEDULED",
    sides: input.teams.map((team, sideIndex) => ({
      sideNumber: sideIndex + 1,
      teamId: team.id,
      players: [...team.players]
        .sort((left, right) => left.rosterSlot - right.rosterSlot)
        .map((player) => ({
          playerId: player.id,
          rosterMembershipId: player.rosterMembershipId,
          rosterSlot: player.rosterSlot
        })),
      shotRows: (source?.rows ?? [])
        .filter((row) =>
          row.sideNumber === sideIndex + 1 && Object.values(row.markers).some(Boolean)
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
  };
}

export function createWorkbookSemanticModel(
  input: CanonicalWorkbookGenerationInput,
  matchSheets: ReadonlyArray<{
    sheetId: string;
    sheetName: string;
    matchId: string;
    baselineFingerprint: string;
  }>
): unknown {
  return {
    generation: input.generation,
    tournament: input.tournament,
    pods: [...input.pods].sort((left, right) => left.sequence - right.sequence),
    teams: [...input.teams]
      .sort((left, right) => left.sequence - right.sequence)
      .map((team) => ({
        ...team,
        players: [...team.players].sort(
          (left, right) => left.rosterSlot - right.rosterSlot
        )
      })),
    matches: [...input.matches].sort(
      (left, right) => left.sequence - right.sequence
    ),
    matchSheets
  };
}
