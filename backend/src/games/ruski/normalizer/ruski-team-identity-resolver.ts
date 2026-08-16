import { Player, TeamId } from "../../../domain";
import { ParsedScorebookSheet } from "../../parsed-scorebook";
import { ruskiTournamentConfig } from "../config/ruski-tournament-config";
import { matchGameSheetTeams } from "./ruski-game-team-matcher";
import {
  inferRosters,
  matchTeamStatistics
} from "./ruski-roster-inference";
import { stringSimilarity } from "./ruski-string-similarity";
import { RuskiTournamentSource } from "./ruski-tournament-source";

export interface RuskiCanonicalTeamIdentity {
  sourceName: string;
  aliases: string[];
  playerNames: string[];
  seed: number;
}

export interface RuskiTeamIdentityCandidate {
  teamId: TeamId;
  aliases: readonly string[];
  players: readonly Player[];
}

const identityConfiguration = ruskiTournamentConfig.identity;

export class RuskiTeamIdentityResolver {
  buildCanonicalIdentities(
    source: RuskiTournamentSource
  ): RuskiCanonicalTeamIdentity[] {
    const teamStatisticsByStanding = matchTeamStatistics(
      source.standings,
      source.seasonTeamStatistics
    );
    const rosters = inferRosters(
      source.standings,
      teamStatisticsByStanding,
      source.seasonPlayerStatistics,
      source.gameSheets
    );

    return source.standings.map((standing) => {
      const statisticRow = teamStatisticsByStanding.get(standing.teamName);

      return {
        sourceName: standing.teamName,
        aliases: statisticRow === undefined
          ? [standing.teamName]
          : [standing.teamName, statisticRow.subjectLabel],
        playerNames: rosters.get(standing.teamName) ?? [],
        seed: standing.seed
      };
    });
  }

  resolveGameSheet(
    sheet: ParsedScorebookSheet,
    entries: readonly RuskiTeamIdentityCandidate[]
  ): TeamId[] {
    return matchGameSheetTeams(sheet, entries);
  }

  resolveTeamLabel(
    label: string,
    entries: readonly RuskiTeamIdentityCandidate[]
  ): TeamId | undefined {
    const ranked = entries
      .map((entry) => ({
        teamId: entry.teamId,
        score: Math.max(
          ...entry.aliases.map((alias) => stringSimilarity(alias, label))
        )
      }))
      .sort((first, second) => second.score - first.score);

    return ranked[0]?.score !== undefined &&
      ranked[0].score >= identityConfiguration.minimumTeamLabelScore
      ? ranked[0].teamId
      : undefined;
  }
}
