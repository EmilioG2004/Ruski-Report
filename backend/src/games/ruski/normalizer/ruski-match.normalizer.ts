import {
  GameEvent,
  MatchDetail,
  MatchParticipant,
  MatchStatus,
  TeamId,
  TournamentId
} from "../../../domain";
import { ParsedScorebookSheet, ParsedScorebookSide } from "../../parsed-scorebook";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_PHASE_IDS
} from "../definition";
import { ruskiScorecardDefinition } from "../definition";
import { calculateRuskiBoxScore } from "./ruski-box-score";
import { createStableId } from "./ruski-id";
import { normalizeRuskiScorecard } from "./ruski-scorecard.normalizer";
import {
  RuskiTeamDirectory,
  RuskiTeamResolution
} from "./ruski-team-directory";

interface NormalizedSide {
  side: ParsedScorebookSide;
  resolution: RuskiTeamResolution;
}

export function normalizeRuskiGameSheet(
  sheet: ParsedScorebookSheet,
  tournamentId: TournamentId,
  teamDirectory: RuskiTeamDirectory,
  updatedAt: string
): MatchDetail {
  if (sheet.game === undefined) {
    throw new Error(`Cannot normalize game sheet '${sheet.name}' without game data.`);
  }

  const matchId = createStableId("match", sheet.name);
  const resolutions = teamDirectory.resolveGameSheet(sheet);
  const normalizedSides = sheet.game.sides.map((side, index) => ({
    side,
    resolution: resolutions[index]
  }));
  const { rows, events, subjects } = normalizeRuskiScorecard(
    matchId,
    tournamentId,
    normalizedSides,
    teamDirectory
  );
  const status = mapGameStatus(sheet.game.status);
  const participants = normalizedSides.map(({ side, resolution }) =>
    createParticipant(side, resolution, events, status)
  );
  const winnerTeamId = getWinnerTeamId(participants, status);

  return {
    id: matchId,
    tournamentId,
    gameType: RUSKI_GAME_TYPE,
    status,
    participants: participants.map((participant) => ({
      ...participant,
      result: getParticipantResult(participant.teamId, winnerTeamId, status)
    })),
    score: {
      participants: participants.map((participant) => ({
        teamId: participant.teamId,
        score: participant.score
      })),
      winnerTeamId,
      isFinal: status === "final"
    },
    currentPhase: {
      id: RUSKI_PHASE_IDS.normal,
      type: RUSKI_PHASE_IDS.normal,
      label: "Normal Play",
      sequence: 2,
      status: status === "final" ? "completed" : "active"
    },
    boxScore: calculateRuskiBoxScore(matchId, events, subjects),
    scorecard: {
      definition: ruskiScorecardDefinition,
      rows
    },
    events,
    commentsSummary: {
      matchId,
      count: 0
    },
    metadata: {
      sourceSheetName: sheet.name,
      sourceSheetIndex: sheet.index
    },
    version: 1,
    updatedAt
  };
}

function createParticipant(
  side: ParsedScorebookSide,
  resolution: RuskiTeamResolution,
  events: readonly GameEvent[],
  status: MatchStatus
): MatchParticipant {
  return {
    teamId: resolution.team.id,
    playerIds: resolution.playerIds,
    score: events.filter(
      (event) =>
        event.teamId === resolution.team.id &&
        event.type === RUSKI_EVENT_TYPE_IDS.make
    ).length,
    result: status === "final" ? "pending" : "pending",
    metadata: {
      sideId: side.id,
      label: side.label
    }
  };
}

function mapGameStatus(status: string | null): MatchStatus {
  return status === "FINAL" ? "final" : "in_progress";
}

function getWinnerTeamId(
  participants: readonly MatchParticipant[],
  status: MatchStatus
): TeamId | undefined {
  if (status !== "final" || participants.length !== 2) {
    return undefined;
  }

  const [first, second] = participants;

  if (first.score === second.score) {
    return undefined;
  }

  return first.score > second.score ? first.teamId : second.teamId;
}

function getParticipantResult(
  teamId: TeamId,
  winnerTeamId: TeamId | undefined,
  status: MatchStatus
): "win" | "loss" | "tie" | "pending" {
  if (status !== "final") {
    return "pending";
  }

  if (winnerTeamId === undefined) {
    return "tie";
  }

  return teamId === winnerTeamId ? "win" : "loss";
}
