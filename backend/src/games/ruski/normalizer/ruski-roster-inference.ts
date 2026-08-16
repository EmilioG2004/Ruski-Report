import { ParsedScorebookSheet } from "../../parsed-scorebook";
import { ruskiTournamentConfig } from "../config/ruski-tournament-config";
import { normalizeName } from "./ruski-id";
import { stringSimilarity, tokenCoverage } from "./ruski-string-similarity";
import {
  RuskiStandingSourceRow,
  RuskiStatisticSourceRow
} from "./ruski-tournament-source";

interface RosterCandidate {
  playerRows: [RuskiStatisticSourceRow, RuskiStatisticSourceRow];
  score: number;
}

const identityConfiguration = ruskiTournamentConfig.identity;

export function matchTeamStatistics(
  standings: readonly RuskiStandingSourceRow[],
  teamStatistics: readonly RuskiStatisticSourceRow[]
): Map<string, RuskiStatisticSourceRow> {
  const result = new Map<string, RuskiStatisticSourceRow>();

  standings.forEach((standing) => {
    const matches = teamStatistics.filter((row) => {
      const shooting = row.values.shootingPercentage;
      return shooting !== null &&
        Math.abs(shooting - standing.shootingPercentage) <=
          identityConfiguration.shootingPercentageTolerance;
    });

    if (matches.length !== 1) {
      throw new Error(
        `Expected one Team Stats identity for '${standing.teamName}', found ${matches.length}.`
      );
    }

    result.set(standing.teamName, matches[0]);
  });

  return result;
}

export function inferRosters(
  standings: readonly RuskiStandingSourceRow[],
  teamStatisticsByStanding: ReadonlyMap<string, RuskiStatisticSourceRow>,
  playerStatistics: readonly RuskiStatisticSourceRow[],
  gameSheets: readonly ParsedScorebookSheet[]
): Map<string, string[]> {
  const candidatesByTeam = new Map<string, RosterCandidate[]>();

  standings.forEach((standing) => {
    const teamStatistics = teamStatisticsByStanding.get(standing.teamName);
    const aliases = [
      standing.teamName,
      teamStatistics?.subjectLabel ?? standing.teamName
    ];
    candidatesByTeam.set(
      standing.teamName,
      teamStatistics === undefined
        ? []
        : createStatRosterCandidates(teamStatistics, playerStatistics, aliases)
    );
  });

  const result = new Map<string, string[]>();
  const assignedPlayerNames = new Set<string>();
  const orderedStandings = [...standings].sort((first, second) => {
    const firstCandidates = candidatesByTeam.get(first.teamName) ?? [];
    const secondCandidates = candidatesByTeam.get(second.teamName) ?? [];
    return (
      (secondCandidates[0]?.score ?? -1) - (firstCandidates[0]?.score ?? -1) ||
      firstCandidates.length - secondCandidates.length
    );
  });

  orderedStandings.forEach((standing) => {
    const candidate = (candidatesByTeam.get(standing.teamName) ?? []).find(
      (entry) =>
        entry.playerRows.every(
          (player) =>
            !assignedPlayerNames.has(normalizeName(player.subjectLabel))
        )
    );

    if (candidate !== undefined) {
      assignRoster(
        standing.teamName,
        candidate.playerRows.map((player) => player.subjectLabel),
        result,
        assignedPlayerNames
      );
    }
  });

  standings.forEach((standing) => {
    if (result.has(standing.teamName)) {
      return;
    }

    const aliases = [
      standing.teamName,
      teamStatisticsByStanding.get(standing.teamName)?.subjectLabel ??
        standing.teamName
    ];
    const fallback = gameSheets
      .flatMap((sheet) =>
        (sheet.game?.sides ?? []).map((side) =>
          side.players.map((player) => player.name)
        )
      )
      .filter((names) => names.length === 2)
      .filter((names) =>
        names.every(
          (name) => !assignedPlayerNames.has(normalizeName(name))
        )
      )
      .map((names) => ({
        names,
        score: Math.max(
          ...aliases.map((alias) => stringSimilarity(alias, names.join(" ")))
        )
      }))
      .sort((first, second) => second.score - first.score)[0];

    if (
      fallback === undefined ||
      fallback.score < identityConfiguration.minimumFallbackRosterScore
    ) {
      throw new Error(`Could not infer a roster for '${standing.teamName}'.`);
    }

    assignRoster(
      standing.teamName,
      fallback.names,
      result,
      assignedPlayerNames
    );
  });

  return result;
}

function assignRoster(
  teamName: string,
  playerNames: string[],
  result: Map<string, string[]>,
  assignedPlayerNames: Set<string>
): void {
  result.set(teamName, playerNames);
  playerNames.forEach((name) => assignedPlayerNames.add(normalizeName(name)));
}

function createStatRosterCandidates(
  team: RuskiStatisticSourceRow,
  players: readonly RuskiStatisticSourceRow[],
  aliases: readonly string[]
): RosterCandidate[] {
  const candidates: RosterCandidate[] = [];

  for (let first = 0; first < players.length; first += 1) {
    for (let second = first + 1; second < players.length; second += 1) {
      const pair: [RuskiStatisticSourceRow, RuskiStatisticSourceRow] = [
        players[first],
        players[second]
      ];

      if (
        !statTotalsMatch(team, pair, "makes") ||
        !statTotalsMatch(team, pair, "misses")
      ) {
        continue;
      }

      candidates.push({
        playerRows: pair,
        score: Math.max(
          ...aliases.map((alias) =>
            tokenCoverage(
              alias,
              pair.map((row) => row.subjectLabel)
            )
          )
        )
      });
    }
  }

  return candidates.sort((first, second) => second.score - first.score);
}

function statTotalsMatch(
  team: RuskiStatisticSourceRow,
  players: readonly RuskiStatisticSourceRow[],
  key: string
): boolean {
  const teamValue = team.values[key];
  return teamValue !== null &&
    players.every((player) => player.values[key] !== null) &&
    players.reduce(
      (total, player) => total + (player.values[key] ?? 0),
      0
    ) === teamValue;
}
