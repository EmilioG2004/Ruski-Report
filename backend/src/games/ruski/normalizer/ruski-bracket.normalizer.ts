import {
  Bracket,
  BracketMatch,
  BracketRound,
  MatchDetail,
  TeamId,
  TournamentId
} from "../../../domain";
import { ParsedScorebookRow } from "../../parsed-scorebook";
import { createStableId } from "./ruski-id";
import { RuskiTeamDirectory } from "./ruski-team-directory";

export interface NormalizedRuskiBracket {
  bracket: Bracket;
  matches: MatchDetail[];
}

interface BracketSlotSourceRow {
  roundId: string;
  roundName: string;
  roundSequence: number;
  bracketMatchId: string;
  matchSequence: number;
  slotSequence: number;
  seed: number | null;
  teamName: string | null;
  winner: boolean;
  sourceMatchId: string | null;
}

export function normalizeRuskiBracket(
  tournamentId: TournamentId,
  rows: readonly ParsedScorebookRow[],
  directory: RuskiTeamDirectory,
  matches: readonly MatchDetail[]
): NormalizedRuskiBracket {
  const championName = readChampion(rows);
  const championTeamId = championName === null
    ? undefined
    : directory.resolveTeamLabel(championName)?.id;
  const slotRows = rows.filter((row) => row.values.bracketMatchId !== undefined)
    .map(readSlotRow);
  const roundGroups = groupBy(slotRows, (row) => row.roundId);
  const usedMatchIds = new Set<string>();
  const linkedBracketMatchIdByMatchId = new Map<string, string>();
  const rounds = [...roundGroups.values()]
    .map((roundRows): BracketRound => {
      const matchGroups = groupBy(roundRows, (row) => row.bracketMatchId);
      const bracketMatches = [...matchGroups.values()]
        .map((matchRows) => normalizeBracketMatch(
          matchRows,
          directory,
          matches,
          usedMatchIds,
          linkedBracketMatchIdByMatchId,
          championTeamId
        ))
        .sort((first, second) => first.sequence - second.sequence);

      return {
        id: createStableId("bracket-round", roundRows[0].roundId),
        name: roundRows[0].roundName,
        sequence: roundRows[0].roundSequence,
        matches: bracketMatches
      };
    })
    .sort((first, second) => first.sequence - second.sequence);
  const linkedMatches = matches.map((match) => {
    const bracketMatchId = linkedBracketMatchIdByMatchId.get(match.id);
    return bracketMatchId === undefined ? match : { ...match, bracketMatchId };
  });

  return {
    bracket: {
      id: createStableId("bracket", `${tournamentId}-playoffs`),
      tournamentId,
      name: "Playoff Bracket",
      rounds,
      metadata: {
        source: "playoff-bracket-sheet",
        championTeamId
      }
    },
    matches: linkedMatches
  };
}

function normalizeBracketMatch(
  rows: readonly BracketSlotSourceRow[],
  directory: RuskiTeamDirectory,
  matches: readonly MatchDetail[],
  usedMatchIds: Set<string>,
  linkedBracketMatchIdByMatchId: Map<string, string>,
  championTeamId?: TeamId
): BracketMatch {
  const orderedRows = [...rows].sort((first, second) => first.slotSequence - second.slotSequence);
  const slots = orderedRows.map((row) => {
    const team = row.teamName === null ? undefined : directory.resolveTeamLabel(row.teamName);

    if (row.teamName !== null && team === undefined) {
      throw new Error(`Could not resolve bracket team '${row.teamName}'.`);
    }

    return {
      seed: row.seed ?? undefined,
      teamId: team?.id,
      source: row.sourceMatchId === null
        ? team === undefined
          ? { type: "tbd" as const }
          : { type: "team" as const }
        : { type: "match-winner" as const, sourceMatchId: row.sourceMatchId }
    };
  });
  const teamIds = slots.flatMap((slot) => slot.teamId ?? []);
  const linkedMatch = findLinkedMatch(matches, teamIds, usedMatchIds);

  if (linkedMatch !== undefined) {
    usedMatchIds.add(linkedMatch.id);
    linkedBracketMatchIdByMatchId.set(linkedMatch.id, orderedRows[0].bracketMatchId);
  }

  const flaggedWinnerIndex = orderedRows.findIndex((row) => row.winner);
  const winnerTeamId = flaggedWinnerIndex >= 0
    ? slots[flaggedWinnerIndex]?.teamId
    : orderedRows[0].roundId === "championship"
      ? championTeamId
      : linkedMatch?.score.winnerTeamId;

  return {
    id: orderedRows[0].bracketMatchId,
    matchId: linkedMatch?.id,
    sequence: orderedRows[0].matchSequence,
    status: linkedMatch?.status === "in_progress"
      ? "in_progress"
      : winnerTeamId !== undefined || linkedMatch?.status === "final"
        ? "completed"
        : teamIds.length === 2
          ? "scheduled"
          : "pending",
    slots,
    winnerTeamId
  };
}

function findLinkedMatch(
  matches: readonly MatchDetail[],
  teamIds: readonly TeamId[],
  usedMatchIds: ReadonlySet<string>
): MatchDetail | undefined {
  if (teamIds.length !== 2) {
    return undefined;
  }

  const target = [...teamIds].sort().join("|");
  return matches
    .filter((match) => !usedMatchIds.has(match.id))
    .filter((match) =>
      match.participants.map((participant) => participant.teamId).sort().join("|") === target
    )
    .sort((first, second) => sourceSheetIndex(second) - sourceSheetIndex(first))[0];
}

function sourceSheetIndex(match: MatchDetail): number {
  const value = match.metadata?.sourceSheetIndex;
  return typeof value === "number" ? value : -1;
}

function readChampion(rows: readonly ParsedScorebookRow[]): string | null {
  const value = rows.find((row) => row.values.champion !== undefined)?.values.champion;
  return typeof value === "string" ? value : null;
}

function readSlotRow(row: ParsedScorebookRow): BracketSlotSourceRow {
  return {
    roundId: requireString(row, "roundId"),
    roundName: requireString(row, "roundName"),
    roundSequence: requireNumber(row, "roundSequence"),
    bracketMatchId: requireString(row, "bracketMatchId"),
    matchSequence: requireNumber(row, "matchSequence"),
    slotSequence: requireNumber(row, "slotSequence"),
    seed: optionalNumber(row, "seed"),
    teamName: optionalString(row, "team"),
    winner: row.values.winner === true,
    sourceMatchId: optionalString(row, "sourceMatchId")
  };
}

function requireString(row: ParsedScorebookRow, key: string): string {
  const value = row.values[key];
  if (typeof value !== "string") {
    throw new Error(`Expected bracket string '${key}'.`);
  }
  return value;
}

function optionalString(row: ParsedScorebookRow, key: string): string | null {
  const value = row.values[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`Expected optional bracket string '${key}'.`);
  }
  return value;
}

function requireNumber(row: ParsedScorebookRow, key: string): number {
  const value = row.values[key];
  if (typeof value !== "number") {
    throw new Error(`Expected bracket number '${key}'.`);
  }
  return value;
}

function optionalNumber(row: ParsedScorebookRow, key: string): number | null {
  const value = row.values[key];
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number") {
    throw new Error(`Expected optional bracket number '${key}'.`);
  }
  return value;
}

function groupBy<T>(
  values: readonly T[],
  key: (value: T) => string
): Map<string, T[]> {
  return values.reduce((groups, value) => {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
    return groups;
  }, new Map<string, T[]>());
}
