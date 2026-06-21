import {
  MatchSummary,
  TeamId,
  Tournament,
  TournamentId
} from "../../../domain";
import { ParsedScorebook } from "../../parsed-scorebook";
import { TournamentSnapshot } from "../../tournament-snapshot";
import { RUSKI_GAME_TYPE, ruskiGameDefinition } from "../definition";
import { RuskiScorebookValidator } from "../validator";
import { normalizeRuskiGameSheet } from "./ruski-match.normalizer";
import { buildRuskiStandings } from "./ruski-standings";
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
    const teamDirectory = new RuskiTeamDirectory(
      tournamentId,
      this.options.confirmedTeams
    );
    const matches = parsed.sheets
      .filter((sheet) => sheet.role === "game" && sheet.game !== undefined)
      .map((sheet) =>
        normalizeRuskiGameSheet(sheet, tournamentId, teamDirectory, generatedAt)
      );
    const teams = teamDirectory.getTeams();
    const standings = buildRuskiStandings(tournamentId, teams, matches);
    const standingIdsByTeamId = new Map<TeamId, string>(
      standings.map((standing) => [standing.teamId, standing.id])
    );
    const pods = teamDirectory.buildPods(
      matches.map((match) => match.id),
      standingIdsByTeamId
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
        podCount: pods.length,
        teamsPerPod: teams.length,
        bracketSize: 16,
        description:
          "Season teams are confirmed by the admin before scorebook ingestion.",
        metadata: {
          teamSource: "season-confirmed-teams",
          matchSource: "game-sheets"
        }
      },
      activeMatchIds: matches
        .filter((match) => match.status === "in_progress")
        .map((match) => match.id),
      featuredMatchIds: matches.slice(0, 3).map((match) => match.id),
      pods,
      teams,
      standings,
      matchSummaries: matches.map(toMatchSummary),
      metadata: {
        normalizedFrom: "ruski-game-sheets",
        allDataRequired: false
      },
      version: 1,
      updatedAt: generatedAt
    };

    return {
      tournament,
      matches,
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
