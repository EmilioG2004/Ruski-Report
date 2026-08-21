/**
 * Resolves each scorecard side to a canonical tournament team. Exact roster
 * identity takes precedence because workbook tab names do not reliably mirror
 * the physical left/right scorecard layout; weighted aliases remain a fallback.
 */
import { Player, TeamId } from "../../../domain";
import { ParsedScorebookSheet, ParsedScorebookSide } from "../../parsed-scorebook";
import { ruskiTournamentConfig } from "../config/ruski-tournament-config";
import { normalizeName } from "./ruski-id";
import type { RuskiTeamIdentityCandidate } from "./ruski-team-identity-resolver";
import { stringSimilarity } from "./ruski-string-similarity";

interface SideCandidate {
  teamId: TeamId;
  score: number;
  hasExactRoster: boolean;
}

const identityConfiguration = ruskiTournamentConfig.identity;

export function matchGameSheetTeams(
  sheet: ParsedScorebookSheet,
  entries: readonly RuskiTeamIdentityCandidate[]
): TeamId[] {
  if (sheet.game === undefined || sheet.game.sides.length !== 2) {
    throw new Error(`Cannot resolve teams for invalid game sheet '${sheet.name}'.`);
  }

  const aliases = splitMatchupName(sheet.name);
  const candidates = sheet.game.sides.map((side, index) =>
    scoreSide(side, aliases[index] ?? "", entries)
  );
  const assignment = chooseDistinctAssignment(candidates);

  if (
    assignment === undefined ||
    assignment.some(
      (candidate) =>
        candidate.score < identityConfiguration.minimumResolutionScore
    )
  ) {
    throw new Error(`Could not resolve canonical teams for game sheet '${sheet.name}'.`);
  }

  return assignment.map((candidate) => candidate.teamId);
}

function scoreSide(
  side: ParsedScorebookSide,
  sheetAlias: string,
  entries: readonly RuskiTeamIdentityCandidate[]
): SideCandidate[] {
  const playerNames = side.players.map((player) => player.name);

  return entries
    .map((entry) => {
      const aliasScore = Math.max(
        ...entry.aliases.map((alias) => stringSimilarity(alias, sheetAlias))
      );
      const rosterScore = rosterOverlap(entry.players, playerNames);
      const fuzzyPlayerScore = Math.max(
        ...entry.aliases.map((alias) =>
          stringSimilarity(alias, playerNames.join(" "))
        )
      );

      return {
        teamId: entry.teamId,
        hasExactRoster: isExactRoster(entry.players, playerNames),
        score:
          aliasScore * identityConfiguration.aliasWeight +
          rosterScore * identityConfiguration.rosterWeight +
          fuzzyPlayerScore * identityConfiguration.fuzzyPlayerWeight
      };
    })
    .sort((first, second) => second.score - first.score);
}

function chooseDistinctAssignment(
  candidates: readonly SideCandidate[][]
): [SideCandidate, SideCandidate] | undefined {
  if (candidates.length !== 2) {
    return undefined;
  }

  let best: [SideCandidate, SideCandidate] | undefined;
  let bestExactRosterCount = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  candidates[0].forEach((first) => {
    candidates[1].forEach((second) => {
      if (first.teamId === second.teamId) {
        return;
      }

      const exactRosterCount = Number(first.hasExactRoster) +
        Number(second.hasExactRoster);
      const score = first.score + second.score;

      if (
        exactRosterCount > bestExactRosterCount ||
        (exactRosterCount === bestExactRosterCount && score > bestScore)
      ) {
        best = [first, second];
        bestExactRosterCount = exactRosterCount;
        bestScore = score;
      }
    });
  });

  return best;
}

function isExactRoster(
  players: readonly Player[],
  observedNames: readonly string[]
): boolean {
  if (players.length === 0 || players.length !== observedNames.length) {
    return false;
  }

  const expected = players.map((player) => normalizeName(player.displayName)).sort();
  const observed = observedNames.map(normalizeName).sort();
  return expected.every((name, index) => name === observed[index]);
}

function splitMatchupName(name: string): string[] {
  return name.split(/\s+(?:vs\.?|v\.?)\s+/i).map((part) => part.trim());
}

function rosterOverlap(
  players: readonly Player[],
  observedNames: readonly string[]
): number {
  if (players.length === 0) {
    return 0;
  }

  const observed = new Set(observedNames.map(normalizeName));
  return players.filter((player) =>
    observed.has(normalizeName(player.displayName))
  ).length / players.length;
}
