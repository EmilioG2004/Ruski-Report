import { MatchDetail, Pod, Standing, TeamId, TournamentId } from "../../../domain";
import { RUSKI_STANDING_METRIC_KEYS } from "../definition";
import { createStableId } from "./ruski-id";
import { RuskiTeamDirectory } from "./ruski-team-directory";
import { RuskiStandingSourceRow } from "./ruski-tournament-source";

export interface RuskiTournamentStructure {
  standings: Standing[];
  pods: Pod[];
  matches: MatchDetail[];
}

export function normalizeRuskiTournamentStructure(
  tournamentId: TournamentId,
  sourceRows: readonly RuskiStandingSourceRow[],
  directory: RuskiTeamDirectory,
  matches: readonly MatchDetail[]
): RuskiTournamentStructure {
  const teamsBySourceName = new Map(
    directory.getTeams().map((team) => [String(team.metadata?.sourceName), team])
  );
  const standings = sourceRows.map((row): Standing => {
    const team = teamsBySourceName.get(row.teamName);

    if (team === undefined) {
      throw new Error(`Missing canonical team for standing '${row.teamName}'.`);
    }

    const podId = createStableId("pod", row.podName);
    const record = parseRecord(row.record);

    return {
      id: createStableId("standing", `${row.podName}-${row.teamName}`),
      tournamentId,
      scope: "pod",
      podId,
      teamId: team.id,
      rank: row.seed,
      record,
      gamesPlayed: record.wins + record.losses + (record.ties ?? 0),
      points: record.wins * 2 + (record.ties ?? 0),
      metricValues: {
        [RUSKI_STANDING_METRIC_KEYS.cupDifferential]: row.cupDifferential,
        [RUSKI_STANDING_METRIC_KEYS.shootingPercentage]: row.shootingPercentage
      },
      metadata: {
        source: "regular-season-standings"
      }
    };
  });
  const standingByTeamId = new Map<TeamId, Standing>(
    standings.map((standing) => [standing.teamId, standing])
  );
  const podIdByTeamId = new Map<TeamId, string>(
    standings.map((standing) => [standing.teamId, standing.podId ?? ""])
  );
  const linkedMatches = matches.map((match) => {
    if (match.bracketMatchId !== undefined || match.participants.length !== 2) {
      return match;
    }

    const podIds = new Set(
      match.participants.map((participant) => podIdByTeamId.get(participant.teamId))
    );
    const podId = podIds.size === 1 ? [...podIds][0] : undefined;
    return podId === undefined || podId.length === 0 ? match : { ...match, podId };
  });
  const podSources = new Map<string, RuskiStandingSourceRow[]>();

  sourceRows.forEach((row) => {
    podSources.set(row.podName, [...(podSources.get(row.podName) ?? []), row]);
  });

  const pods = [...podSources.entries()]
    .map(([podName, rows]): Pod => {
      const teams = rows.map((row) => {
        const team = teamsBySourceName.get(row.teamName);
        if (team === undefined) {
          throw new Error(`Missing canonical team for pod team '${row.teamName}'.`);
        }
        return team;
      });
      return {
        id: createStableId("pod", podName),
        tournamentId,
        name: podName,
        sequence: rows[0].podSequence,
        teamIds: teams.map((team) => team.id),
        matchIds: linkedMatches
          .filter((match) => match.podId === createStableId("pod", podName))
          .map((match) => match.id),
        standingIds: teams.flatMap((team) => standingByTeamId.get(team.id)?.id ?? []),
        metadata: {
          source: "regular-season-standings"
        }
      };
    })
    .sort((first, second) => first.sequence - second.sequence);

  return { standings, pods, matches: linkedMatches };
}

function parseRecord(record: string): { wins: number; losses: number; ties?: number } {
  const match = /^(\d+)-(\d+)(?:-(\d+))?$/.exec(record.trim());

  if (match === null) {
    throw new Error(`Invalid Ruski standing record '${record}'.`);
  }

  const ties = match[3] === undefined ? undefined : Number(match[3]);
  return {
    wins: Number(match[1]),
    losses: Number(match[2]),
    ...(ties === undefined ? {} : { ties })
  };
}
