import {
  MatchDetail,
  Standing,
  Team,
  TeamId,
  TournamentId
} from "../../../domain";
import { RUSKI_STAT_KEYS } from "../definition";

interface StandingAccumulator {
  teamId: TeamId;
  wins: number;
  losses: number;
  ties: number;
  makes: number;
  misses: number;
}

export function buildRuskiStandings(
  tournamentId: TournamentId,
  teams: readonly Team[],
  matches: readonly MatchDetail[]
): Standing[] {
  const accumulators = new Map<TeamId, StandingAccumulator>(
    teams.map((team) => [
      team.id,
      {
        teamId: team.id,
        wins: 0,
        losses: 0,
        ties: 0,
        makes: 0,
        misses: 0
      }
    ])
  );

  matches.forEach((match) => {
    match.participants.forEach((participant) => {
      const accumulator = accumulators.get(participant.teamId);

      if (accumulator === undefined) {
        return;
      }

      if (participant.result === "win") {
        accumulator.wins += 1;
      }

      if (participant.result === "loss") {
        accumulator.losses += 1;
      }

      if (participant.result === "tie") {
        accumulator.ties += 1;
      }

      accumulator.makes += participant.score;
      accumulator.misses += getTeamMisses(match, participant.teamId);
    });
  });

  return [...accumulators.values()]
    .sort(compareStandings)
    .map((standing, index): Standing => ({
      id: `standing-${standing.teamId}`,
      tournamentId,
      scope: "tournament",
      teamId: standing.teamId,
      rank: index + 1,
      record: {
        wins: standing.wins,
        losses: standing.losses,
        ties: standing.ties
      },
      gamesPlayed: standing.wins + standing.losses + standing.ties,
      points: standing.wins * 2 + standing.ties,
      metricValues: {
        [RUSKI_STAT_KEYS.makes]: standing.makes,
        [RUSKI_STAT_KEYS.misses]: standing.misses
      }
    }));
}

function getTeamMisses(match: MatchDetail, teamId: TeamId): number {
  return match.boxScore.rows
    .filter((row) => row.subject.teamId === teamId)
    .reduce((total, row) => {
      return total + (row.stats[RUSKI_STAT_KEYS.misses] ?? 0);
    }, 0);
}

function compareStandings(
  first: StandingAccumulator,
  second: StandingAccumulator
): number {
  return (
    second.wins - first.wins ||
    first.losses - second.losses ||
    second.makes - first.makes ||
    first.teamId.localeCompare(second.teamId)
  );
}
