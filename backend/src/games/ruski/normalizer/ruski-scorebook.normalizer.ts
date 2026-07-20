import {
  MatchSummary,
  Tournament,
  TournamentId
} from "../../../domain";
import { ParsedScorebook } from "../../parsed-scorebook";
import { TournamentSnapshot } from "../../tournament-snapshot";
import { RUSKI_GAME_TYPE, ruskiGameDefinition } from "../definition";
import { ruskiTournamentConfig } from "../config/ruski-tournament-config";
import { RuskiScorebookValidator } from "../validator";
import { normalizeRuskiBracket } from "./ruski-bracket.normalizer";
import { normalizeRuskiGameSheet } from "./ruski-match.normalizer";
import { normalizeRuskiTournamentStatistics } from "./ruski-tournament-statistics.normalizer";
import { normalizeRuskiTournamentStructure } from "./ruski-tournament-structure.normalizer";
import { readRuskiTournamentSource } from "./ruski-tournament-source";
import {
  RuskiConfirmedTeam,
  RuskiTeamDirectory
} from "./ruski-team-directory";

export interface RuskiScorebookNormalizerOptions {
  confirmedTeams?: readonly RuskiConfirmedTeam[];
  now?: () => string;
  tournamentId?: TournamentId;
  tournamentName?: string;
  year?: number;
}

export class RuskiScorebookNormalizer {
  constructor(
    private readonly validator = new RuskiScorebookValidator(),
    private readonly options: RuskiScorebookNormalizerOptions = {}
  ) {}

  async normalizeScorebook(
    parsed: ParsedScorebook
  ): Promise<TournamentSnapshot> {
    const validation = this.validator.validateScorebook(parsed);

    if (!validation.valid) {
      throw new Error("Cannot normalize invalid Ruski scorebook.");
    }

    const year = getTournamentYear(parsed, this.options.year);
    const tournamentId = this.options.tournamentId ?? `tournament-${year}`;
    const generatedAt = this.options.now?.() ?? new Date().toISOString();
    const source = readRuskiTournamentSource(parsed);
    const teamDirectory = new RuskiTeamDirectory(
      tournamentId,
      source,
      this.options.confirmedTeams
    );
    const parsedMatches = source.gameSheets
      .map((sheet) =>
        normalizeRuskiGameSheet(sheet, tournamentId, teamDirectory, generatedAt)
      );
    const { bracket, matches } = normalizeRuskiBracket(
      tournamentId,
      source.bracketRows,
      teamDirectory,
      parsedMatches
    );
    const teams = teamDirectory.getTeams();
    const structure = normalizeRuskiTournamentStructure(
      tournamentId,
      source.standings,
      teamDirectory,
      matches
    );
    const statistics = normalizeRuskiTournamentStatistics(
      source,
      teamDirectory,
      structure.matches
    );
    const tournament: Tournament = {
      id: tournamentId,
      year,
      name: this.options.tournamentName ?? `${year} Ruski Tournament`,
      gameType: RUSKI_GAME_TYPE,
      status: matches.some((match) => match.status === "in_progress")
        ? "active"
        : "completed",
      format: {
        type: "pod_and_bracket",
        podCount: structure.pods.length,
        teamsPerPod: ruskiTournamentConfig.teamsPerPod,
        bracketSize: ruskiTournamentConfig.bracketSize,
        description: "Eight four-team pods followed by a 16-team playoff bracket.",
        metadata: {
          teamSource: "regular-season-standings",
          matchSource: "game-sheets",
          bracketSource: "playoff-bracket-sheet"
        }
      },
      activeMatchIds: structure.matches
        .filter((match) => match.status === "in_progress")
        .map((match) => match.id),
      featuredMatchIds: structure.matches.slice(0, 3).map((match) => match.id),
      pods: structure.pods,
      teams,
      standings: structure.standings,
      bracket,
      matchSummaries: structure.matches.map(toMatchSummary),
      statistics,
      metadata: {
        normalizedFrom: "ruski-scorebook",
        allDataRequired: false
      },
      version: 1,
      updatedAt: generatedAt
    };

    return {
      tournament,
      matches: structure.matches,
      gameDefinition: ruskiGameDefinition,
      source: parsed.source,
      validation,
      generatedAt
    };
  }
}

function getTournamentYear(parsed: ParsedScorebook, optionYear?: number): number {
  if (optionYear !== undefined) {
    return optionYear;
  }

  const metadataYear = parsed.source.metadata?.year;

  if (typeof metadataYear === "number") {
    return metadataYear;
  }

  const yearMatch = /\b(20\d{2})\b/.exec(parsed.source.originalName);
  return yearMatch === null ? new Date().getFullYear() : Number(yearMatch[1]);
}

function toMatchSummary(match: MatchSummary): MatchSummary {
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    gameType: match.gameType,
    status: match.status,
    participants: match.participants,
    score: match.score,
    podId: match.podId,
    bracketMatchId: match.bracketMatchId,
    currentPhase: match.currentPhase,
    scheduledAt: match.scheduledAt,
    startedAt: match.startedAt,
    endedAt: match.endedAt,
    metadata: match.metadata,
    version: match.version,
    updatedAt: match.updatedAt
  };
}
