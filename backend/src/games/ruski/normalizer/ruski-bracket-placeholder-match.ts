/**
 * Creates a navigable match record when the bracket contains a resolved game
 * but the workbook has no corresponding scorecard tab. Known results remain
 * visible while missing scores and event data stay explicitly unrecorded.
 */
import {
  BracketMatch,
  BracketMatchStatus,
  MatchDetail,
  MatchStatus,
  Team,
  TeamId,
  TournamentId
} from "../../../domain";
import {
  RUSKI_GAME_TYPE,
  ruskiScorecardDefinition
} from "../definition";
import { createStableId } from "./ruski-id";

export const RUSKI_BRACKET_ONLY_DETAIL = "bracket-only";

export function createRuskiBracketPlaceholderMatch(
  tournamentId: TournamentId,
  bracketMatch: BracketMatch,
  teamsById: ReadonlyMap<TeamId, Team>,
  updatedAt: string
): MatchDetail | undefined {
  const slots = bracketMatch.slots.filter(
    (slot): slot is typeof slot & { teamId: TeamId } => slot.teamId !== undefined
  );

  if (slots.length !== 2) {
    return undefined;
  }

  const matchId = createStableId("match", bracketMatch.id);
  const status = mapStatus(bracketMatch.status);

  return {
    id: matchId,
    tournamentId,
    gameType: RUSKI_GAME_TYPE,
    status,
    participants: slots.map((slot) => ({
      teamId: slot.teamId,
      seed: slot.seed,
      playerIds: teamsById.get(slot.teamId)?.players.map((player) => player.id),
      result: participantResult(slot.teamId, bracketMatch.winnerTeamId, status)
    })),
    score: {
      participants: [],
      winnerTeamId: bracketMatch.winnerTeamId,
      isFinal: status === "final",
      metadata: { availability: "unrecorded" }
    },
    bracketMatchId: bracketMatch.id,
    boxScore: {
      matchId,
      gameType: RUSKI_GAME_TYPE,
      rows: [],
      metadata: { availability: "unrecorded" }
    },
    scorecard: {
      definition: ruskiScorecardDefinition,
      rows: []
    },
    events: [],
    commentsSummary: { matchId, count: 0 },
    metadata: {
      source: "playoff-bracket-sheet",
      detailAvailability: RUSKI_BRACKET_ONLY_DETAIL
    },
    version: 1,
    updatedAt
  };
}

function mapStatus(status: BracketMatchStatus): MatchStatus {
  switch (status) {
  case "completed": return "final";
  case "in_progress": return "in_progress";
  case "scheduled":
  case "pending":
    return "scheduled";
  }
}

function participantResult(
  teamId: TeamId,
  winnerTeamId: TeamId | undefined,
  status: MatchStatus
): "win" | "loss" | "pending" {
  if (status !== "final" || winnerTeamId === undefined) {
    return "pending";
  }

  return teamId === winnerTeamId ? "win" : "loss";
}
