import {
  MatchDetail,
  PlayerId,
  TeamId,
  TournamentStatisticRow,
  TournamentStatisticTable
} from "../../../domain";
import { RUSKI_STAT_KEYS } from "../definition";
import { createStableId } from "./ruski-id";
import { RuskiTeamDirectory } from "./ruski-team-directory";
import {
  RuskiStatisticSourceRow,
  RuskiTournamentSource
} from "./ruski-tournament-source";

const statisticKeys = [
  RUSKI_STAT_KEYS.shootingPercentage,
  RUSKI_STAT_KEYS.makes,
  RUSKI_STAT_KEYS.misses,
  RUSKI_STAT_KEYS.splashOuts,
  RUSKI_STAT_KEYS.guys,
  RUSKI_STAT_KEYS.tris,
  RUSKI_STAT_KEYS.dis,
  RUSKI_STAT_KEYS.uns,
  RUSKI_STAT_KEYS.voms
];

export function normalizeRuskiTournamentStatistics(
  source: RuskiTournamentSource,
  directory: RuskiTeamDirectory,
  matches: readonly MatchDetail[]
): TournamentStatisticTable[] {
  const seasonMatches = matches.filter((match) => match.bracketMatchId === undefined);
  const playoffMatches = matches.filter((match) => match.bracketMatchId !== undefined);
  const allPlayerStatistics = derivePlayerStatistics(matches);
  const allTeamStatistics = deriveTeamStatistics(matches);

  return [
    createPlayerTable(
      "season-player-statistics",
      "Season Stats",
      "season",
      source.seasonPlayerStatistics,
      directory,
      derivePlayerStatistics(seasonMatches),
      allPlayerStatistics
    ),
    createTeamTable(
      "season-team-statistics",
      "Team Stats",
      source.seasonTeamStatistics,
      directory,
      deriveTeamStatistics(seasonMatches),
      allTeamStatistics
    ),
    createPlayerTable(
      "playoff-player-statistics",
      "Playoff Stats",
      "playoffs",
      source.playoffPlayerStatistics,
      directory,
      derivePlayerStatistics(playoffMatches),
      allPlayerStatistics
    )
  ];
}

function createPlayerTable(
  id: string,
  name: string,
  scope: "season" | "playoffs",
  rows: readonly RuskiStatisticSourceRow[],
  directory: RuskiTeamDirectory,
  derived: ReadonlyMap<PlayerId, Record<string, number | null>>,
  fallbackDerived: ReadonlyMap<PlayerId, Record<string, number | null>>
): TournamentStatisticTable {
  return {
    id,
    name,
    scope,
    subjectType: "player",
    statKeys: [...statisticKeys],
    rows: rows.map((row): TournamentStatisticRow => {
      const playerId = createStableId("player", row.subjectLabel);
      return {
        rank: row.rank,
        subject: {
          type: "player",
          label: row.subjectLabel,
          playerId,
          teamId: directory.findTeamIdForPlayer(playerId)
        },
        values: mergeStatistics(
          row.values,
          derived.get(playerId),
          fallbackDerived.get(playerId)
        )
      };
    }),
    metadata: {
      source: name
    }
  };
}

function createTeamTable(
  id: string,
  name: string,
  rows: readonly RuskiStatisticSourceRow[],
  directory: RuskiTeamDirectory,
  derived: ReadonlyMap<TeamId, Record<string, number | null>>,
  fallbackDerived: ReadonlyMap<TeamId, Record<string, number | null>>
): TournamentStatisticTable {
  return {
    id,
    name,
    scope: "season",
    subjectType: "team",
    statKeys: [...statisticKeys],
    rows: rows.map((row): TournamentStatisticRow => {
      const team = directory.resolveTeamLabel(row.subjectLabel);
      if (team === undefined) {
        throw new Error(`Could not resolve Team Stats row '${row.subjectLabel}'.`);
      }
      return {
        rank: row.rank,
        subject: {
          type: "team",
          label: row.subjectLabel,
          teamId: team.id
        },
        values: mergeStatistics(
          row.values,
          derived.get(team.id),
          fallbackDerived.get(team.id)
        )
      };
    }),
    metadata: {
      source: name
    }
  };
}

function derivePlayerStatistics(
  matches: readonly MatchDetail[]
): Map<PlayerId, Record<string, number | null>> {
  const result = new Map<PlayerId, Record<string, number | null>>();

  matches.flatMap((match) => match.boxScore.rows).forEach((row) => {
    if (row.subject.playerId !== undefined) {
      accumulate(result, row.subject.playerId, row.stats);
    }
  });

  finalizeShootingPercentages(result);
  return result;
}

function deriveTeamStatistics(
  matches: readonly MatchDetail[]
): Map<TeamId, Record<string, number | null>> {
  const result = new Map<TeamId, Record<string, number | null>>();

  matches.flatMap((match) => match.boxScore.rows).forEach((row) => {
    if (row.subject.teamId !== undefined) {
      accumulate(result, row.subject.teamId, row.stats);
    }
  });

  finalizeShootingPercentages(result);
  return result;
}

function accumulate(
  result: Map<string, Record<string, number | null>>,
  subjectId: string,
  values: Readonly<Record<string, number | null>>
): void {
  const totals = result.get(subjectId) ?? Object.fromEntries(
    statisticKeys.map((key) => [key, key === RUSKI_STAT_KEYS.uns ? null : 0])
  );

  statisticKeys.forEach((key) => {
    if (key === RUSKI_STAT_KEYS.shootingPercentage || key === RUSKI_STAT_KEYS.uns) {
      return;
    }
    totals[key] = (totals[key] ?? 0) + (values[key] ?? 0);
  });
  result.set(subjectId, totals);
}

function finalizeShootingPercentages(
  valuesBySubject: Map<string, Record<string, number | null>>
): void {
  valuesBySubject.forEach((values) => {
    const makes = values[RUSKI_STAT_KEYS.makes] ?? 0;
    const misses = values[RUSKI_STAT_KEYS.misses] ?? 0;
    const attempts = makes + misses;
    values[RUSKI_STAT_KEYS.shootingPercentage] = attempts === 0
      ? null
      : Number((makes / attempts).toFixed(10));
  });
}

function mergeStatistics(
  workbookValues: Readonly<Record<string, number | null>>,
  derivedValues?: Readonly<Record<string, number | null>>,
  fallbackDerivedValues?: Readonly<Record<string, number | null>>
): Record<string, number | null> {
  return Object.fromEntries(
    statisticKeys.map((key) => [
      key,
      workbookValues[key] ??
        derivedValues?.[key] ??
        fallbackDerivedValues?.[key] ??
        (key === RUSKI_STAT_KEYS.shootingPercentage ? null : 0)
    ])
  );
}
