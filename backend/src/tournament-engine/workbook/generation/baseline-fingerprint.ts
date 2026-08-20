import { canonicalSha256 } from "../canonical-json";
import {
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_WORKBOOK_SCHEMA_VERSION
} from "../schema";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookPodMatchInput,
  CanonicalWorkbookTeamInput
} from "./types";

export interface ScheduledScorecardBaselineInput {
  readonly tournamentId: string;
  readonly match: CanonicalWorkbookPodMatchInput;
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
  return canonicalSha256(createScheduledScorecardBaseline(input));
}

export function createScheduledScorecardBaseline(
  input: ScheduledScorecardBaselineInput
): unknown {
  return {
    workbookSchemaVersion: CANONICAL_WORKBOOK_SCHEMA_VERSION,
    scorecardLayoutVersion: CANONICAL_SCORECARD_LAYOUT_VERSION,
    tournamentId: input.tournamentId,
    matchId: input.match.id,
    stage: input.match.stage,
    podId: input.match.podId,
    bracketMatchId: null,
    status: "SCHEDULED",
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
      shotRows: []
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
