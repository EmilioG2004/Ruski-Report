import {
  CanonicalLegacyBracket,
  CanonicalLegacyMatch,
  CanonicalScoreAvailability,
  LEGACY_BACKFILL_SCHEMA_VERSION,
  LEGACY_TOURNAMENT_YEAR,
  LegacyBackfillCounts,
  LegacyBackfillIssue,
  LegacyBackfillPlan,
  LegacyBracketMatchSource,
  LegacyEntityKind,
  LegacyIdentityMapping,
  LegacyMatchSource,
  LegacyTournamentSource
} from "./legacy-backfill.types";
import {
  createDigest,
  createLegacyIdentity,
  DeterministicLegacyIdentity
} from "./legacy-determinism";
import {
  calculateCanonicalAggregateStatistics,
  calculateCanonicalMatchStatistics,
  CanonicalStatisticRevision,
  CanonicalStatisticUniverse
} from "../statistics";

export class LegacyBackfillPlanningError extends Error {
  constructor(readonly issues: LegacyBackfillIssue[]) {
    super("Legacy snapshot cannot be planned for canonical backfill.");
    this.name = LegacyBackfillPlanningError.name;
  }
}

export class LegacyBackfillPlanner {
  plan(rawSource: LegacyTournamentSource): LegacyBackfillPlan {
    const source = normalizeSource(rawSource);
    const issues = validateSource(source);
    if (issues.length > 0) {
      throw new LegacyBackfillPlanningError(issues);
    }

    const sourceDigest = createDigest(sourceForStableDigest(source));
    const identities = new IdentityCatalog(source.legacyTournamentId);
    const tournamentIdentity = identities.create(
      "tournament",
      [source.legacyTournamentId],
      source.legacyTournamentId
    );
    const teamIdentities = mapIdentities(
      source.teams,
      (team) => team.legacyTeamId,
      (team) => identities.create(
        "team",
        [team.legacyTeamId],
        team.legacyTeamId
      )
    );
    const playerIdentities = mapIdentities(
      source.players,
      (player) => player.legacyPlayerId,
      (player) => identities.create(
        "player",
        [player.legacyPlayerId],
        player.legacyPlayerId
      )
    );
    const podIdentities = mapIdentities(
      source.pods,
      (pod) => pod.legacyPodId,
      (pod) => identities.create("pod", [pod.legacyPodId], pod.legacyPodId)
    );
    const matchIdentities = mapIdentities(
      source.matchIdentities,
      (match) => match.legacyMatchId,
      (match) => identities.create(
        "match",
        [match.legacyMatchId],
        match.legacyMatchId
      )
    );
    const bracketIdentity = source.bracket === undefined
      ? undefined
      : identities.create(
          "bracket",
          [source.bracket.legacyBracketId],
          source.bracket.legacyBracketId
        );
    const bracketRoundIdentities = new Map<string, DeterministicLegacyIdentity>();
    const bracketMatchIdentities = new Map<string, DeterministicLegacyIdentity>();
    const bracketEngineMatchIdentities =
      new Map<string, DeterministicLegacyIdentity>();

    for (const round of source.bracket?.rounds ?? []) {
      bracketRoundIdentities.set(
        round.legacyRoundId,
        identities.create(
          "bracket_round",
          [round.legacyRoundId],
          round.legacyRoundId
        )
      );
      for (const match of round.matches) {
        bracketMatchIdentities.set(
          match.legacyBracketMatchId,
          identities.create(
            "bracket_match",
            [match.legacyBracketMatchId],
            match.legacyBracketMatchId
          )
        );
        bracketEngineMatchIdentities.set(
          match.legacyBracketMatchId,
          match.legacyMatchId === undefined
            ? identities.create(
                "match",
                ["bracket-only", match.legacyBracketMatchId]
              )
            : requireIdentity(matchIdentities, match.legacyMatchId)
        );
        for (const slot of match.slots) {
          identities.create(
            "bracket_slot",
            [match.legacyBracketMatchId, slot.sequence]
          );
        }
      }
    }

    const teams = source.teams.map((team) => {
      const identity = requireIdentity(teamIdentities, team.legacyTeamId);
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        legacyTeamId: team.legacyTeamId,
        name: team.name,
        sequence: team.sequence,
        initialPodSeed: team.podSeed
      };
    });
    const players = source.players.map((player) => {
      const identity = requireIdentity(playerIdentities, player.legacyPlayerId);
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        legacyPlayerId: player.legacyPlayerId,
        displayName: player.displayName
      };
    });
    const rosterMemberships = source.rosterMemberships.map((membership) => {
      const identity = identities.create(
        "roster_membership",
        [
          membership.legacyTeamId,
          membership.legacyPlayerId,
          membership.sequence
        ]
      );
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        legacyTeamId: membership.legacyTeamId,
        legacyPlayerId: membership.legacyPlayerId,
        teamId: requireIdentity(teamIdentities, membership.legacyTeamId).id,
        playerId: requireIdentity(playerIdentities, membership.legacyPlayerId).id,
        sequence: membership.sequence,
        effectiveFrom: source.snapshotPublishedAt
      };
    });
    const pods = source.pods.map((pod) => {
      const identity = requireIdentity(podIdentities, pod.legacyPodId);
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        legacyPodId: pod.legacyPodId,
        name: pod.name,
        sequence: pod.sequence,
        teamIds: pod.legacyTeamIds.map(
          (teamId) => requireIdentity(teamIdentities, teamId).id
        ),
        matchIds: pod.legacyMatchIds.map(
          (matchId) => requireIdentity(matchIdentities, matchId).id
        )
      };
    });
    const bracketSources = (source.bracket?.rounds ?? [])
      .flatMap((round) => round.matches);
    const activeMatchIds = new Set(
      source.matches.map((match) => match.legacyMatchId)
    );
    const highestPlayoffSequence = source.matches
      .filter((match) => match.legacyBracketMatchId !== undefined)
      .reduce((highest, match) => Math.max(highest, match.sequence), 0);
    const structuralBracketSequences = new Map(
      bracketSources
        .filter(
          (match) => match.legacyMatchId === undefined ||
            !activeMatchIds.has(match.legacyMatchId)
        )
        .map((match, index) => [
          match.legacyBracketMatchId,
          highestPlayoffSequence + index + 1
        ])
    );
    const matches = [
      ...source.matchIdentities.map((identitySource) => {
        const bracketSource = bracketSources.find(
          (candidate) => candidate.legacyMatchId === identitySource.legacyMatchId
        );
        return mapMatch(
          identitySource.legacyMatchId,
          source.matches.find(
            (candidate) =>
              candidate.legacyMatchId === identitySource.legacyMatchId
          ),
          bracketSource,
          bracketSource === undefined
            ? undefined
            : structuralBracketSequences.get(
                bracketSource.legacyBracketMatchId
              ),
          matchIdentities,
          podIdentities,
          bracketMatchIdentities
        );
      }),
      ...bracketSources
        .filter((match) => match.legacyMatchId === undefined)
        .map((bracketSource) => mapStructuralBracketMatch(
          bracketSource,
          requireIdentity(
            bracketEngineMatchIdentities,
            bracketSource.legacyBracketMatchId
          ),
          requireMapValue(
            structuralBracketSequences,
            bracketSource.legacyBracketMatchId
          ),
          undefined,
          requireIdentity(
            bracketMatchIdentities,
            bracketSource.legacyBracketMatchId
          ).id
        ))
    ].sort(compareCanonicalMatches);
    const matchRevisions: LegacyBackfillPlan["matchRevisions"] =
      source.matches.map((match) => {
      const matchIdentity = requireIdentity(matchIdentities, match.legacyMatchId);
      const revisionIdentity = identities.create(
        "match_revision",
        [match.legacyMatchId, source.snapshotVersion]
      );
      return {
        id: revisionIdentity.id,
        publicKey: revisionIdentity.publicKey,
        legacyMatchId: match.legacyMatchId,
        matchId: matchIdentity.id,
        revisionNumber: 1 as const,
        sourceSnapshotVersion: source.snapshotVersion,
        sourceUpdatedAt: match.updatedAt,
        participants: match.participants.map((participant) => ({
          teamId: requireIdentity(
            teamIdentities,
            participant.legacyTeamId
          ).id,
          playerIds: participant.legacyPlayerIds.map(
            (playerId) => requireIdentity(playerIdentities, playerId).id
          ),
          seed: participant.seed,
          score: participant.score,
          result: participant.result
        })),
        scores: match.score.participants.map((score) => ({
          teamId: requireIdentity(teamIdentities, score.legacyTeamId).id,
          score: score.score
        })),
        winnerTeamId: match.score.legacyWinnerTeamId === undefined
          ? undefined
          : requireIdentity(
              teamIdentities,
              match.score.legacyWinnerTeamId
            ).id,
        isFinal: match.score.isFinal,
        events: match.events.map((event) => {
          const identity = identities.create(
            "scoring_event",
            [match.legacyMatchId, event.legacyEventId, event.sequence, event.type]
          );
          return mapLegacyEvent(event, identity, teamIdentities, playerIdentities);
        }),
        sourceStatistics: match.statistics.map((statistic) => ({
          subjectType: statistic.subjectType,
          teamId: statistic.legacyTeamId === undefined
            ? undefined
            : requireIdentity(teamIdentities, statistic.legacyTeamId).id,
          playerId: statistic.legacyPlayerId === undefined
            ? undefined
            : requireIdentity(playerIdentities, statistic.legacyPlayerId).id,
          metricValues: statistic.metricValues
        })),
        sourceScorecardRows: match.scorecardRows
      };
    });
    for (const bracketSource of bracketSources.filter(
      (candidate) => candidate.legacyMatchId === undefined ||
        !activeMatchIds.has(candidate.legacyMatchId)
    )) {
      const matchIdentity = requireIdentity(
        bracketEngineMatchIdentities,
        bracketSource.legacyBracketMatchId
      );
      const revisionIdentity = identities.create(
        "match_revision",
        ["bracket-only", bracketSource.legacyBracketMatchId, source.snapshotVersion]
      );
      const participants = bracketSource.slots
        .filter((slot) => slot.legacyTeamId !== undefined)
        .map((slot) => {
          const teamId = requireIdentity(
            teamIdentities,
            slot.legacyTeamId as string
          ).id;
          return {
            teamId,
            playerIds: [],
            seed: slot.seed,
            result: bracketSource.status === "completed"
              ? teamId === (
                  bracketSource.legacyWinnerTeamId === undefined
                    ? undefined
                    : requireIdentity(
                        teamIdentities,
                        bracketSource.legacyWinnerTeamId
                      ).id
                )
                ? "win" as const
                : "loss" as const
              : "pending" as const
          };
        });
      matchRevisions.push({
        id: revisionIdentity.id,
        publicKey: revisionIdentity.publicKey,
        matchId: matchIdentity.id,
        revisionNumber: 1,
        sourceSnapshotVersion: source.snapshotVersion,
        sourceUpdatedAt: source.snapshotPublishedAt,
        participants,
        scores: [],
        winnerTeamId: bracketSource.legacyWinnerTeamId === undefined
          ? undefined
          : requireIdentity(
              teamIdentities,
              bracketSource.legacyWinnerTeamId
            ).id,
        isFinal: bracketSource.status === "completed",
        events: [],
        sourceStatistics: [],
        sourceScorecardRows: []
      });
    }
    matchRevisions.sort((left, right) => left.matchId.localeCompare(right.matchId));

    const standingGroups = groupStandings(source);
    const standingCalculationIdentities = new Map(
      standingGroups.map((group) => {
        const key = standingGroupKey(group.scope, group.legacyPodId);
        return [
          key,
          identities.create("standing_calculation", [key, source.snapshotVersion])
        ];
      })
    );
    const standingCalculations = standingGroups.map((group) => {
      const key = standingGroupKey(group.scope, group.legacyPodId);
      return {
        id: requireIdentity(standingCalculationIdentities, key).id,
        scope: group.scope,
        podId: group.legacyPodId === undefined
          ? undefined
          : requireIdentity(podIdentities, group.legacyPodId).id,
        inputDigest: createDigest(group.standings),
        standingIds: group.standings.map((standing) =>
          identities.create(
            "standing",
            [standing.legacyStandingId],
            standing.legacyStandingId
          ).id
        )
      };
    });
    const standings = source.standings.map((standing) => {
      const identity = identities.create(
        "standing",
        [standing.legacyStandingId],
        standing.legacyStandingId
      );
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        calculationId: requireIdentity(
          standingCalculationIdentities,
          standingGroupKey(standing.scope, standing.legacyPodId)
        ).id,
        legacyStandingId: standing.legacyStandingId,
        teamId: requireIdentity(teamIdentities, standing.legacyTeamId).id,
        podId: standing.legacyPodId === undefined
          ? undefined
          : requireIdentity(podIdentities, standing.legacyPodId).id,
        scope: standing.scope,
        rank: standing.rank,
        wins: standing.wins,
        losses: standing.losses,
        gamesPlayed: standing.gamesPlayed,
        points: standing.points,
        metricValues: standing.metricValues
      };
    });
    const podFinalizations = standingCalculations
      .filter((calculation) => calculation.scope === "pod")
      .map((calculation) => {
        const podId = calculation.podId as string;
        const identity = identities.create(
          "pod_finalization",
          [podId, calculation.id]
        );
        return {
          id: identity.id,
          podId,
          calculationId: calculation.id
        };
      });
    const seededTeams = source.teams.filter(
      (team) => team.overallSeed !== undefined
    );
    const seedCalculationIdentity = seededTeams.length === 0
      ? undefined
      : identities.create("seed_calculation", [source.snapshotVersion]);
    const seedCalculation = seedCalculationIdentity === undefined
      ? undefined
      : {
          id: seedCalculationIdentity.id,
          inputDigest: createDigest(
            seededTeams.map((team) => ({
              legacyTeamId: team.legacyTeamId,
              overallSeed: team.overallSeed
            }))
          )
        };
    const seeds = seededTeams.map((team) => {
      const identity = identities.create("seed", [team.legacyTeamId]);
      return {
        id: identity.id,
        publicKey: identity.publicKey,
        legacyTeamId: team.legacyTeamId,
        legacySeedKey: `overall:${team.legacyTeamId}`,
        teamId: requireIdentity(teamIdentities, team.legacyTeamId).id,
        initialPodSeed: team.podSeed,
        calculatedPlayoffSeed: team.overallSeed,
        effectivePlayoffSeed: team.overallSeed,
        qualified: (team.overallSeed as number) <=
          readPositiveFormatInteger(source.format, "bracketSize")
      };
    });
    const bracket = mapBracket(
      source,
      bracketIdentity,
      bracketRoundIdentities,
      bracketMatchIdentities,
      bracketEngineMatchIdentities,
      teamIdentities,
      identities
    );
    const identityReferences = source.matchIdentities.map((reference) => ({
      legacyMatchId: reference.legacyMatchId,
      canonicalMatchId: requireIdentity(
        matchIdentities,
        reference.legacyMatchId
      ).id,
      commentIds: reference.commentIds,
      reportIds: reference.reportIds
    }));
    const mappings = identities.mappings();
    const mappingDigest = createDigest(mappings);
    const counts = createCounts({
      tournamentId: tournamentIdentity.id,
      teams,
      players,
      rosterMemberships,
      pods,
      matches,
      matchRevisions,
      standings,
      standingCalculations,
      podFinalizations,
      seedCalculation,
      seeds,
      bracket,
      identityReferences
    });
    const tournament = {
      id: tournamentIdentity.id,
      publicKey: tournamentIdentity.publicKey,
      legacyTournamentId: source.legacyTournamentId,
      year: source.year,
      name: source.name,
      gameType: source.gameType,
      lifecycle: "completed" as const,
      visibility: "public" as const,
      format: source.format,
      configuration: deriveConfiguration(source),
      sourceStatistics: source.tournamentStatistics
    };
    const planContent = {
      schemaVersion: LEGACY_BACKFILL_SCHEMA_VERSION,
      legacyTournamentId: source.legacyTournamentId,
      sourceSnapshotVersion: source.snapshotVersion,
      sourceSnapshotPublishedAt: source.snapshotPublishedAt,
      sourceDigest,
      mappingDigest,
      counts,
      tournament,
      teams,
      players,
      rosterMemberships,
      pods,
      matches,
      matchRevisions,
      standingCalculations,
      standings,
      podFinalizations,
      seedCalculation,
      seeds,
      bracket,
      identityReferences,
      mappings
    };

    return {
      ...planContent,
      planDigest: createDigest({
        ...planContent,
        identityReferences: identityReferences.map((reference) => ({
          legacyMatchId: reference.legacyMatchId,
          canonicalMatchId: reference.canonicalMatchId
        }))
      })
    };
  }
}

class IdentityCatalog {
  private readonly entries = new Map<string, LegacyIdentityMapping>();

  constructor(private readonly legacyTournamentId: string) {}

  create(
    entityKind: LegacyEntityKind,
    sourceParts: readonly (string | number)[],
    existingPublicKey?: string
  ): DeterministicLegacyIdentity {
    const identity = createLegacyIdentity(
      entityKind,
      this.legacyTournamentId,
      sourceParts,
      existingPublicKey
    );
    const catalogKey = `${entityKind}:${identity.legacyKey}`;
    const existing = this.entries.get(catalogKey);

    if (existing !== undefined && existing.canonicalId !== identity.id) {
      throw new Error("Deterministic identity catalog produced a collision.");
    }

    this.entries.set(catalogKey, {
      entityKind,
      legacyKey: identity.legacyKey,
      canonicalId: identity.id,
      publicKey: identity.publicKey
    });
    return identity;
  }

  mappings(): LegacyIdentityMapping[] {
    return [...this.entries.values()].sort(
      (left, right) =>
        left.entityKind.localeCompare(right.entityKind) ||
        left.legacyKey.localeCompare(right.legacyKey)
    );
  }
}

function mapMatch(
  legacyMatchId: string,
  source: LegacyMatchSource | undefined,
  bracketSource: LegacyBracketMatchSource | undefined,
  structuralSequence: number | undefined,
  matchIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  podIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  bracketMatchIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>
): CanonicalLegacyMatch {
  const identity = requireIdentity(matchIdentities, legacyMatchId);
  if (source === undefined) {
    if (bracketSource !== undefined && structuralSequence !== undefined) {
      return mapStructuralBracketMatch(
        bracketSource,
        identity,
        structuralSequence,
        legacyMatchId,
        requireIdentity(
          bracketMatchIdentities,
          bracketSource.legacyBracketMatchId
        ).id
      );
    }
    return {
      id: identity.id,
      publicKey: identity.publicKey,
      legacyMatchId,
      stage: "legacy_unknown",
      scoreAvailability: "unrecorded",
      identityOnly: true,
      sourceSnapshotBacked: false
    };
  }

  return {
    id: identity.id,
    publicKey: identity.publicKey,
    legacyMatchId,
    sequence: source.sequence,
    stage: source.legacyBracketMatchId !== undefined
      ? "playoffs"
      : source.legacyPodId !== undefined
        ? "pod_play"
        : "legacy_unknown",
    status: source.status,
    scoreAvailability: scoreAvailability(source),
    podId: source.legacyPodId === undefined
      ? undefined
      : requireIdentity(podIdentities, source.legacyPodId).id,
    bracketMatchId: source.legacyBracketMatchId === undefined
      ? undefined
      : requireIdentity(
          bracketMatchIdentities,
          source.legacyBracketMatchId
        ).id,
    identityOnly: false,
    sourceSnapshotBacked: true
  };
}

function mapStructuralBracketMatch(
  source: LegacyBracketMatchSource,
  identity: DeterministicLegacyIdentity,
  sequence: number,
  legacyMatchId?: string,
  canonicalBracketMatchId?: string
): CanonicalLegacyMatch {
  return {
    id: identity.id,
    publicKey: identity.publicKey,
    legacyMatchId,
    legacyBracketMatchId: source.legacyBracketMatchId,
    sequence,
    stage: "playoffs",
    status: bracketMatchStatus(source.status),
    scoreAvailability: source.status === "completed"
      ? "unrecorded"
      : source.status === "in_progress"
        ? "partial"
        : "not_started",
    bracketMatchId: canonicalBracketMatchId,
    identityOnly: false,
    sourceSnapshotBacked: false
  };
}

function bracketMatchStatus(
  status: LegacyBracketMatchSource["status"]
): LegacyMatchSource["status"] {
  switch (status) {
  case "completed":
    return "final";
  case "in_progress":
    return "in_progress";
  case "pending":
  case "scheduled":
    return "scheduled";
  }
}

function compareCanonicalMatches(
  left: CanonicalLegacyMatch,
  right: CanonicalLegacyMatch
): number {
  return left.stage.localeCompare(right.stage) ||
    (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.id.localeCompare(right.id);
}

function scoreAvailability(
  match: LegacyMatchSource
): CanonicalScoreAvailability {
  if (
    match.detailAvailability === "unrecorded" ||
    match.score.availability === "unrecorded"
  ) {
    return "unrecorded";
  }

  switch (match.status) {
    case "scheduled":
    case "postponed":
      return "not_started";
    case "in_progress":
      return "partial";
    case "cancelled":
    case "forfeited":
      return "not_applicable";
    case "final":
      return match.score.participants.length === 0 ? "unrecorded" : "complete";
  }
}

function mapBracket(
  source: LegacyTournamentSource,
  bracketIdentity: DeterministicLegacyIdentity | undefined,
  roundIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  bracketMatchIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  bracketEngineMatchIdentities: ReadonlyMap<
    string,
    DeterministicLegacyIdentity
  >,
  teamIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  identities: IdentityCatalog
): CanonicalLegacyBracket | undefined {
  if (source.bracket === undefined || bracketIdentity === undefined) {
    return undefined;
  }

  return {
    id: bracketIdentity.id,
    publicKey: bracketIdentity.publicKey,
    legacyBracketId: source.bracket.legacyBracketId,
    name: source.bracket.name,
    rounds: source.bracket.rounds.map((round) => {
      const roundIdentity = requireIdentity(
        roundIdentities,
        round.legacyRoundId
      );
      return {
        id: roundIdentity.id,
        publicKey: roundIdentity.publicKey,
        legacyRoundId: round.legacyRoundId,
        name: round.name,
        sequence: round.sequence,
        matches: round.matches.map((match) =>
          mapBracketMatch(
            match,
            bracketMatchIdentities,
            bracketEngineMatchIdentities,
            teamIdentities,
            identities
          )
        )
      };
    })
  };
}

function mapBracketMatch(
  source: LegacyBracketMatchSource,
  bracketMatchIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  bracketEngineMatchIdentities: ReadonlyMap<
    string,
    DeterministicLegacyIdentity
  >,
  teamIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  identities: IdentityCatalog
) {
  const identity = requireIdentity(
    bracketMatchIdentities,
    source.legacyBracketMatchId
  );
  return {
    id: identity.id,
    publicKey: identity.publicKey,
    legacyBracketMatchId: source.legacyBracketMatchId,
    matchId: requireIdentity(
      bracketEngineMatchIdentities,
      source.legacyBracketMatchId
    ).id,
    sequence: source.sequence,
    status: source.status,
    winnerTeamId: source.legacyWinnerTeamId === undefined
      ? undefined
      : requireIdentity(teamIdentities, source.legacyWinnerTeamId).id,
    slots: source.slots.map((slot) => {
      const slotIdentity = identities.create(
        "bracket_slot",
        [source.legacyBracketMatchId, slot.sequence]
      );
      return {
        id: slotIdentity.id,
        publicKey: slotIdentity.publicKey,
        sequence: slot.sequence,
        seed: slot.seed,
        teamId: slot.legacyTeamId === undefined
          ? undefined
          : requireIdentity(teamIdentities, slot.legacyTeamId).id,
        sourceType: slot.sourceType,
        sourceBracketMatchId: slot.legacySourceBracketMatchId === undefined
          ? undefined
          : requireIdentity(
              bracketMatchIdentities,
              slot.legacySourceBracketMatchId
            ).id,
        label: slot.label
      };
    })
  };
}

function createCounts(input: {
  tournamentId: string;
  teams: LegacyBackfillPlan["teams"];
  players: LegacyBackfillPlan["players"];
  rosterMemberships: LegacyBackfillPlan["rosterMemberships"];
  pods: LegacyBackfillPlan["pods"];
  matches: LegacyBackfillPlan["matches"];
  matchRevisions: LegacyBackfillPlan["matchRevisions"];
  standingCalculations: LegacyBackfillPlan["standingCalculations"];
  standings: LegacyBackfillPlan["standings"];
  podFinalizations: LegacyBackfillPlan["podFinalizations"];
  seedCalculation?: LegacyBackfillPlan["seedCalculation"];
  seeds: LegacyBackfillPlan["seeds"];
  bracket?: LegacyBackfillPlan["bracket"];
  identityReferences: LegacyBackfillPlan["identityReferences"];
}): LegacyBackfillCounts {
  const bracketRounds = input.bracket?.rounds ?? [];
  const bracketMatches = bracketRounds.flatMap((round) => round.matches);
  const scoringEvents = input.matchRevisions.reduce(
    (count, revision) => count + revision.events.length,
    0
  );
  const statisticCounts = canonicalStatisticCounts(input);
  const completedBracketMatches = bracketMatches.filter(
    (match) => match.status === "completed" && match.winnerTeamId !== undefined
  ).length;
  return {
    tournaments: 1,
    teams: input.teams.length,
    players: input.players.length,
    rosterMemberships: input.rosterMemberships.length,
    pods: input.pods.length,
    matches: input.matches.length,
    identityOnlyMatches: input.matches.filter((match) => match.identityOnly).length,
    matchRevisions: input.matchRevisions.length,
    matchParticipants: input.matchRevisions.reduce(
      (count, revision) => count + revision.participants.length,
      0
    ),
    standingCalculations: input.standingCalculations.length,
    standingCalculationMatches: input.standingCalculations.reduce(
      (count, calculation) => count + input.matches.filter((match) =>
        !match.identityOnly && match.podId === calculation.podId
      ).length,
      0
    ),
    standings: input.standings.length,
    podFinalizations: input.podFinalizations.length,
    podFinalizationProvenance: input.podFinalizations.length,
    seedCalculations: input.seedCalculation === undefined ? 0 : 1,
    seeds: input.seeds.length,
    brackets: input.bracket === undefined ? 0 : 1,
    bracketRounds: bracketRounds.length,
    bracketMatches: bracketMatches.length,
    bracketSlots: bracketMatches.reduce(
      (count, match) => count + match.slots.length,
      0
    ),
    scoringEvents,
    shotAttempts: input.matchRevisions.reduce(
      (count, revision) => count + revision.events.filter(
        (event) => event.type === "shot_attempt"
      ).length,
      0
    ),
    shotClassifications: input.matchRevisions.reduce(
      (count, revision) => count + revision.events.filter(
        (event) => event.shotAttempt?.classification !== undefined
      ).length,
      0
    ),
    statisticRuns: statisticCounts.runs,
    statisticValues: statisticCounts.values,
    activeStatisticRuns: statisticCounts.runs === 0 ? 0 : 1,
    activePodStandingCalculations: input.standingCalculations.filter(
      (calculation) => calculation.scope === "pod"
    ).length,
    activeTournamentStandingCalculations: input.standingCalculations.some(
      (calculation) => calculation.scope === "tournament"
    ) ? 1 : 0,
    seedCalculationFinalizations: input.seedCalculation === undefined
      ? 0
      : input.podFinalizations.length,
    activeSeedCalculations: input.seedCalculation === undefined ? 0 : 1,
    bracketPublications: input.bracket === undefined ? 0 : 1,
    activeBrackets: input.bracket === undefined ? 0 : 1,
    bracketResolutions: completedBracketMatches,
    activeBracketResolutions: completedBracketMatches,
    bracketAdvancements: bracketMatches.reduce(
      (count, match) => count + match.slots.filter(
        (slot) => slot.sourceType === "match-winner"
      ).length,
      0
    ),
    projectionVersions: 1,
    tournamentProjectionPayloads: 1,
    matchProjectionPayloads: input.matches.filter(
      (match) => !match.identityOnly
    ).length,
    projectionActivations: 1
  };
}

function canonicalStatisticCounts(input: {
  tournamentId: string;
  teams: LegacyBackfillPlan["teams"];
  rosterMemberships: LegacyBackfillPlan["rosterMemberships"];
  pods: LegacyBackfillPlan["pods"];
  matches: LegacyBackfillPlan["matches"];
  matchRevisions: LegacyBackfillPlan["matchRevisions"];
}): { runs: number; values: number } {
  const matchById = new Map(input.matches.map((match) => [match.id, match]));
  const membershipByTeamPlayer = new Map(
    input.rosterMemberships.map((membership) => [
      `${membership.teamId}:${membership.playerId}`,
      membership
    ])
  );
  const revisions = input.matchRevisions.flatMap((revision) => {
    const match = requireMapValue(matchById, revision.matchId);
    if (match.identityOnly) {
      return [];
    }
    return [{
      tournamentId: input.tournamentId,
      matchId: revision.matchId,
      revisionId: revision.id,
      stage: match.stage,
      ...(match.podId === undefined ? {} : { podId: match.podId }),
      teams: revision.participants.map((participant, index) => ({
        sideNumber: index + 1,
        teamId: participant.teamId,
        players: participant.playerIds.map((playerId, playerIndex) => ({
          playerId,
          rosterMembershipId: membershipByTeamPlayer.get(
            `${participant.teamId}:${playerId}`
          )?.id ?? null,
          rosterSlot: playerIndex + 1
        }))
      })),
      events: revision.events.map((event) => ({
        eventId: event.id,
        sequence: event.sequence,
        type: event.type,
        teamId: event.teamId,
        playerId: event.playerId,
        ...(event.shotAttempt === undefined
          ? {}
          : { shotAttempt: event.shotAttempt })
      }))
    } as CanonicalStatisticRevision];
  });
  if (revisions.length === 0) {
    return { runs: 0, values: 0 };
  }
  const podByTeam = new Map(
    input.pods.flatMap((pod) => pod.teamIds.map((teamId) => [teamId, pod.id]))
  );
  const universe: CanonicalStatisticUniverse = {
    tournamentId: input.tournamentId,
    teams: input.teams.map((team) => ({
      teamId: team.id,
      podId: requireMapValue(podByTeam, team.id),
      playerIds: input.rosterMemberships
        .filter((membership) => membership.teamId === team.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((membership) => membership.playerId)
    }))
  };
  const matchValueCount = revisions.reduce(
    (count, revision) =>
      count + calculateCanonicalMatchStatistics(revision, 1).values.length,
    0
  );
  return {
    runs: revisions.length + 1,
    values: matchValueCount +
      calculateCanonicalAggregateStatistics(revisions, 1, universe).values.length
  };
}

function mapLegacyEvent(
  event: LegacyTournamentSource["matches"][number]["events"][number],
  identity: DeterministicLegacyIdentity,
  teamIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  playerIdentities: ReadonlyMap<string, DeterministicLegacyIdentity>
): LegacyBackfillPlan["matchRevisions"][number]["events"][number] {
  const common = {
    id: identity.id,
    publicKey: identity.publicKey,
    legacyEventId: event.legacyEventId,
    legacyScorecardRowId: event.legacyScorecardRowId,
    attributionMethod: event.attributionMethod,
    sequence: event.sequence,
    teamId: requireIdentity(teamIdentities, event.legacyTeamId).id,
    playerId: requireIdentity(playerIdentities, event.legacyPlayerId).id,
    occurredAt: event.occurredAt,
    sourceReference: `legacy-event:${event.legacyEventId}`
  };
  if (event.type === "vom") {
    return { ...common, type: "vom" };
  }
  const classification = event.type === "splash-out"
    ? "splash_out" as const
    : event.type === "guy" ? "guy" as const
    : event.type === "tri" ? "tri" as const
    : event.type === "di" ? "di" as const
    : undefined;
  const outcome = event.type === "make" ? "make" as const : "miss" as const;
  return {
    ...common,
    type: "shot_attempt",
    shotAttempt: {
      outcome,
      ...(classification === undefined ? {} : { classification }),
      cupDelta: outcome === "make" ? 1
        : classification === "di" ? 2
        : classification === "tri" ? 3
        : 0,
      ...(event.phase === undefined ? {} : { phase: event.phase }),
      ...(event.turnNumber === undefined ? {} : { turnNumber: event.turnNumber }),
      ...(event.teamTurnOrder === undefined
        ? {}
        : { teamTurnOrder: event.teamTurnOrder }),
      ...(event.shotInTeamTurn === undefined
        ? {}
        : { shotInTeamTurn: event.shotInTeamTurn })
    }
  };
}

function sourceForStableDigest(source: LegacyTournamentSource): unknown {
  return {
    ...source,
    tournamentStatistics: [...source.tournamentStatistics]
      .sort((left, right) => left.legacyTableId.localeCompare(right.legacyTableId))
      .map((table) => ({
        ...table,
        rows: [...table.rows]
          .sort((left, right) => left.rank - right.rank)
          .map((row) => ({ ...row, metricValues: { ...row.metricValues } }))
      })),
    matchIdentities: source.matchIdentities.map((identity) => ({
      legacyMatchId: identity.legacyMatchId
    }))
  };
}

function groupStandings(source: LegacyTournamentSource) {
  const groups = new Map<
    string,
    {
      scope: "pod" | "tournament";
      legacyPodId?: string;
      standings: LegacyTournamentSource["standings"];
    }
  >();
  for (const standing of source.standings) {
    const key = standingGroupKey(standing.scope, standing.legacyPodId);
    const group = groups.get(key) ?? {
      scope: standing.scope,
      legacyPodId: standing.legacyPodId,
      standings: []
    };
    group.standings.push(standing);
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) =>
    standingGroupKey(left.scope, left.legacyPodId).localeCompare(
      standingGroupKey(right.scope, right.legacyPodId)
    )
  );
}

function standingGroupKey(
  scope: "pod" | "tournament",
  legacyPodId: string | undefined
): string {
  return `${scope}:${legacyPodId ?? "all"}`;
}

function deriveConfiguration(source: LegacyTournamentSource) {
  const podSizes = source.pods.map((pod) => pod.legacyTeamIds.length);
  const bracketSize = readPositiveFormatInteger(
    source.format,
    "bracketSize"
  );
  const qualifiersPerPod = bracketSize / source.pods.length;
  const playersPerTeam = source.rosterMemberships.reduce(
    (highest, membership) => Math.max(highest, membership.sequence),
    0
  );
  return {
    formatVersion: 1 as const,
    formatType: "pod_and_single_elimination" as const,
    teamCount: source.teams.length,
    podCount: source.pods.length,
    podSizes,
    playersPerTeam,
    gamesPerPair: 1 as const,
    qualifiersPerPod,
    bracketSize,
    allowByes: source.pods.length * qualifiersPerPod < bracketSize,
    standingsRules: [
      "record",
      "cupDifferential",
      "teamShootingPercentage",
      "administratorResolution"
    ] as [
      "record",
      "cupDifferential",
      "teamShootingPercentage",
      "administratorResolution"
    ]
  };
}

function readPositiveFormatInteger(
  format: Record<string, unknown>,
  field: string
): number {
  const value = format[field];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`Validated legacy format field '${field}' is invalid.`);
  }
  return value as number;
}

function validateSource(source: LegacyTournamentSource): LegacyBackfillIssue[] {
  const issues: LegacyBackfillIssue[] = [];
  if (source.year !== LEGACY_TOURNAMENT_YEAR) {
    issues.push({
      code: "LEGACY_YEAR_MISMATCH",
      message: "Only the approved completed 2026 legacy tournament can be backfilled.",
      expected: LEGACY_TOURNAMENT_YEAR,
      actual: source.year
    });
  }
  if (source.status !== "completed") {
    issues.push({
      code: "LEGACY_STATUS_MISMATCH",
      message: "The legacy source snapshot must be completed.",
      expected: "completed",
      actual: source.status
    });
  }
  if (!Number.isInteger(source.snapshotVersion) || source.snapshotVersion < 1) {
    issues.push({
      code: "LEGACY_SNAPSHOT_VERSION_INVALID",
      message: "The active legacy snapshot version must be a positive integer.",
      actual: source.snapshotVersion
    });
  }
  const bracketSize = source.format.bracketSize;
  if (!Number.isInteger(bracketSize) || (bracketSize as number) < 2) {
    issues.push({
      code: "LEGACY_FORMAT_BRACKET_SIZE_INVALID",
      message: "Legacy bracket size must be a positive power-of-two size.",
      actual: typeof bracketSize === "number" ? bracketSize : "missing"
    });
  } else if (((bracketSize as number) & ((bracketSize as number) - 1)) !== 0) {
    issues.push({
      code: "LEGACY_FORMAT_BRACKET_SIZE_INVALID",
      message: "Legacy bracket size must be a positive power-of-two size.",
      actual: bracketSize as number
    });
  }
  if (source.pods.length === 0) {
    issues.push({
      code: "LEGACY_PODS_MISSING",
      message: "Legacy canonical configuration requires at least one pod."
    });
  } else {
    const podSizes = source.pods.map((pod) => pod.legacyTeamIds.length);
    if (new Set(podSizes).size !== 1 || podSizes[0] === 0) {
      issues.push({
        code: "LEGACY_POD_SIZES_UNSUPPORTED",
        message: "Legacy v1 backfill requires equal non-empty pod sizes."
      });
    }
    if (
      typeof bracketSize === "number" &&
      Number.isInteger(bracketSize) &&
      bracketSize % source.pods.length !== 0
    ) {
      issues.push({
        code: "LEGACY_QUALIFIERS_PER_POD_INVALID",
        message: "Legacy bracket size must divide evenly across all pods.",
        expected: source.pods.length,
        actual: bracketSize
      });
    }
    if (
      typeof bracketSize === "number" &&
      Number.isInteger(bracketSize) &&
      bracketSize % source.pods.length === 0 &&
      bracketSize / source.pods.length > (podSizes[0] ?? 0)
    ) {
      issues.push({
        code: "LEGACY_QUALIFIERS_EXCEED_POD_SIZE",
        message: "Legacy qualifiers per pod cannot exceed the pod size.",
        expected: podSizes[0] ?? 0,
        actual: bracketSize / source.pods.length
      });
    }
  }
  if (
    source.rosterMemberships.length === 0 ||
    source.rosterMemberships.some(
      (membership) =>
        !Number.isInteger(membership.sequence) || membership.sequence < 1
    )
  ) {
    issues.push({
      code: "LEGACY_ROSTER_CONFIGURATION_INVALID",
      message: "Legacy roster slots must be positive and non-empty."
    });
  }

  checkUnique(source.teams, (team) => team.legacyTeamId, "TEAM", issues);
  checkUnique(source.players, (player) => player.legacyPlayerId, "PLAYER", issues);
  checkUnique(source.pods, (pod) => pod.legacyPodId, "POD", issues);
  checkUnique(source.matches, (match) => match.legacyMatchId, "MATCH", issues);
  checkUnique(
    source.standings,
    (standing) => standing.legacyStandingId,
    "STANDING",
    issues
  );
  checkUnique(
    source.matchIdentities,
    (identity) => identity.legacyMatchId,
    "MATCH_IDENTITY",
    issues
  );
  const bracketRounds = source.bracket?.rounds ?? [];
  checkUnique(
    bracketRounds,
    (round) => round.legacyRoundId,
    "BRACKET_ROUND",
    issues
  );
  checkUnique(
    bracketRounds,
    (round) => String(round.sequence),
    "BRACKET_ROUND_SEQUENCE",
    issues
  );
  checkUnique(
    bracketRounds.flatMap((round) => round.matches),
    (match) => match.legacyBracketMatchId,
    "BRACKET_MATCH",
    issues
  );
  for (const round of bracketRounds) {
    checkUnique(
      round.matches,
      (match) => String(match.sequence),
      "BRACKET_MATCH_SEQUENCE",
      issues
    );
    for (const match of round.matches) {
      if (match.slots.length !== 2) {
        issues.push({
          code: "LEGACY_BRACKET_SLOT_COUNT_INVALID",
          message: "Every legacy bracket match must contain exactly two slots.",
          expected: 2,
          actual: match.slots.length
        });
      }
      checkUnique(
        match.slots,
        (slot) => String(slot.sequence),
        "BRACKET_SLOT_SEQUENCE",
        issues
      );
    }
  }

  const teamIds = new Set(source.teams.map((team) => team.legacyTeamId));
  const playerIds = new Set(source.players.map((player) => player.legacyPlayerId));
  const podIds = new Set(source.pods.map((pod) => pod.legacyPodId));
  const matchIds = new Set(
    source.matchIdentities.map((match) => match.legacyMatchId)
  );
  const bracketMatchIds = new Set(
    (source.bracket?.rounds ?? [])
      .flatMap((round) => round.matches)
      .map((match) => match.legacyBracketMatchId)
  );
  const bracketMatchesById = new Map(
    (source.bracket?.rounds ?? []).flatMap((round) => round.matches)
      .map((match) => [match.legacyBracketMatchId, match])
  );

  for (const membership of source.rosterMemberships) {
    requireReference(teamIds, membership.legacyTeamId, "ROSTER_TEAM", issues);
    requireReference(playerIds, membership.legacyPlayerId, "ROSTER_PLAYER", issues);
  }
  for (const pod of source.pods) {
    for (const teamId of pod.legacyTeamIds) {
      requireReference(teamIds, teamId, "POD_TEAM", issues);
    }
    for (const matchId of pod.legacyMatchIds) {
      requireReference(matchIds, matchId, "POD_MATCH", issues);
    }
  }
  for (const match of source.matches) {
    requireReference(matchIds, match.legacyMatchId, "ACTIVE_MATCH_IDENTITY", issues);
    if (
      (match.legacyPodId === undefined) ===
      (match.legacyBracketMatchId === undefined)
    ) {
      issues.push({
        code: "LEGACY_MATCH_STAGE_INVALID",
        message: "Every active legacy match must belong to exactly one supported stage.",
        actual: match.legacyMatchId
      });
    }
    if (match.participants.length !== 2) {
      issues.push({
        code: "LEGACY_MATCH_PARTICIPANTS_INVALID",
        message: "Every published legacy match requires exactly two team participants.",
        actual: match.legacyMatchId
      });
    }
    if (match.legacyPodId !== undefined) {
      requireReference(podIds, match.legacyPodId, "MATCH_POD", issues);
    }
    if (match.legacyBracketMatchId !== undefined) {
      requireReference(
        bracketMatchIds,
        match.legacyBracketMatchId,
        "MATCH_BRACKET",
        issues
      );
    }
    for (const participant of match.participants) {
      requireReference(teamIds, participant.legacyTeamId, "MATCH_TEAM", issues);
      for (const playerId of participant.legacyPlayerIds) {
        requireReference(playerIds, playerId, "MATCH_PLAYER", issues);
      }
    }
    for (const score of match.score.participants) {
      requireReference(teamIds, score.legacyTeamId, "SCORE_TEAM", issues);
    }
    const participantTeams = new Set(
      match.participants.map((participant) => participant.legacyTeamId)
    );
    const participantPlayers = new Set(
      match.participants.flatMap((participant) => participant.legacyPlayerIds)
    );
    checkUnique(match.events, (event) => event.legacyEventId, "MATCH_EVENT", issues);
    checkUnique(
      match.events,
      (event) => String(event.sequence),
      "MATCH_EVENT_SEQUENCE",
      issues
    );
    checkUnique(
      match.scorecardRows,
      (row) => row.legacyScorecardRowId,
      "SCORECARD_ROW",
      issues
    );
    for (const event of match.events) {
      requireReference(teamIds, event.legacyTeamId, "EVENT_TEAM", issues);
      requireReference(playerIds, event.legacyPlayerId, "EVENT_PLAYER", issues);
      if (!participantTeams.has(event.legacyTeamId) ||
          !participantPlayers.has(event.legacyPlayerId)) {
        issues.push({
          code: "LEGACY_EVENT_PARTICIPANT_MISMATCH",
          message: "Legacy scoring events must reference frozen match participants.",
          actual: event.legacyEventId
        });
      }
      if (event.attributionMethod !== "source_event_player_id") {
        const evidence = match.scorecardRows.find((row) =>
          row.legacyScorecardRowId === event.legacyScorecardRowId &&
          row.legacyEventIds.includes(event.legacyEventId)
        );
        const scorecardKey = event.type === "splash-out"
          ? "splashOut"
          : event.type;
        if (
          evidence === undefined ||
          evidence.legacyTeamId !== event.legacyTeamId ||
          evidence.values[scorecardKey] !== true ||
          (evidence.legacyPlayerId !== undefined &&
            evidence.legacyPlayerId !== event.legacyPlayerId) ||
          typeof evidence.values.shooter !== "string"
        ) {
          issues.push({
            code: "LEGACY_EVENT_ATTRIBUTION_EVIDENCE_MISSING",
            message: "Compatibility-attributed events require matching stable scorecard chronology.",
            actual: event.legacyEventId
          });
        }
      }
    }
    for (const statistic of match.statistics) {
      if (statistic.legacyTeamId !== undefined) {
        requireReference(teamIds, statistic.legacyTeamId, "STATISTIC_TEAM", issues);
      }
      if (statistic.legacyPlayerId !== undefined) {
        requireReference(
          playerIds,
          statistic.legacyPlayerId,
          "STATISTIC_PLAYER",
          issues
        );
      }
    }
    for (const row of match.scorecardRows) {
      if (row.legacyTeamId !== undefined) {
        requireReference(teamIds, row.legacyTeamId, "SCORECARD_TEAM", issues);
      }
      if (row.legacyPlayerId !== undefined) {
        requireReference(playerIds, row.legacyPlayerId, "SCORECARD_PLAYER", issues);
      }
    }
    if (match.score.legacyWinnerTeamId !== undefined) {
      requireReference(
        teamIds,
        match.score.legacyWinnerTeamId,
        "MATCH_WINNER",
        issues
      );
    }
  }
  for (const standing of source.standings) {
    requireReference(teamIds, standing.legacyTeamId, "STANDING_TEAM", issues);
    if (standing.legacyPodId !== undefined) {
      requireReference(podIds, standing.legacyPodId, "STANDING_POD", issues);
    }
  }
  for (const table of source.tournamentStatistics) {
    for (const row of table.rows) {
      if (table.subjectType === "team") {
        if (row.legacyTeamId === undefined) {
          issues.push({
            code: "LEGACY_TOURNAMENT_STATISTIC_SUBJECT_MISSING",
            message: "Legacy team statistics require stable team identity."
          });
        } else {
          requireReference(
            teamIds,
            row.legacyTeamId,
            "TOURNAMENT_STATISTIC_TEAM",
            issues
          );
        }
      } else if (row.legacyPlayerId === undefined) {
        issues.push({
          code: "LEGACY_TOURNAMENT_STATISTIC_SUBJECT_MISSING",
          message: "Legacy player statistics require stable player identity."
        });
      } else {
        requireReference(
          playerIds,
          row.legacyPlayerId,
          "TOURNAMENT_STATISTIC_PLAYER",
          issues
        );
      }
    }
  }
  for (const match of (source.bracket?.rounds ?? []).flatMap(
    (round) => round.matches
  )) {
    if (match.legacyMatchId !== undefined) {
      requireReference(matchIds, match.legacyMatchId, "BRACKET_MATCH", issues);
    }
    if (match.legacyWinnerTeamId !== undefined) {
      requireReference(
        teamIds,
        match.legacyWinnerTeamId,
        "BRACKET_WINNER",
        issues
      );
    }
    for (const slot of match.slots) {
      if (slot.sequence !== 1 && slot.sequence !== 2) {
        issues.push({
          code: "LEGACY_BRACKET_SLOT_SEQUENCE_INVALID",
          message: "Legacy bracket slots must use sequence one or two.",
          actual: slot.sequence
        });
      }
      if (slot.sourceType === "match-loser") {
        issues.push({
          code: "LEGACY_BRACKET_MATCH_LOSER_UNSUPPORTED",
          message: "The approved single-elimination backfill cannot use match-loser slots."
        });
      }
      if (slot.sourceType === "match-winner") {
        const sourceMatch = slot.legacySourceBracketMatchId === undefined
          ? undefined
          : bracketMatchesById.get(slot.legacySourceBracketMatchId);
        if (
          sourceMatch?.status !== "completed" ||
          sourceMatch.legacyWinnerTeamId === undefined ||
          sourceMatch.legacyWinnerTeamId !== slot.legacyTeamId
        ) {
          issues.push({
            code: "LEGACY_BRACKET_ADVANCEMENT_EVIDENCE_INVALID",
            message:
              "Legacy winner-source slots require a completed matching winner."
          });
        }
      }
      if (slot.sourceType === "bye") {
        issues.push({
          code: "LEGACY_BRACKET_BYE_UNSUPPORTED",
          message: "The 2026 v1 compatibility backfill does not permit bracket byes."
        });
      }
      if (slot.legacyTeamId !== undefined) {
        requireReference(teamIds, slot.legacyTeamId, "BRACKET_SLOT_TEAM", issues);
      }
      if (slot.legacySourceBracketMatchId !== undefined) {
        requireReference(
          bracketMatchIds,
          slot.legacySourceBracketMatchId,
          "BRACKET_SLOT_SOURCE",
          issues
        );
      }
    }
  }

  const assignedTeams = source.pods.flatMap((pod) => pod.legacyTeamIds);
  for (const teamId of teamIds) {
    const assignmentCount = assignedTeams.filter(
      (assigned) => assigned === teamId
    ).length;
    if (assignmentCount !== 1) {
      issues.push({
        code: "LEGACY_TEAM_POD_ASSIGNMENT_INVALID",
        message: "Every legacy team must belong to exactly one pod.",
        expected: 1,
        actual: assignmentCount
      });
    }
  }

  const stageSequences = new Set<string>();
  for (const match of source.matches) {
    const stage = match.legacyPodId === undefined ? "playoffs" : "pod_play";
    const key = `${stage}:${match.sequence}`;
    if (stageSequences.has(key)) {
      issues.push({
        code: "LEGACY_MATCH_STAGE_SEQUENCE_DUPLICATE",
        message: "Legacy match sequence must be unique within its stage.",
        actual: key
      });
    }
    stageSequences.add(key);
  }

  return issues;
}

function checkUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  label: string,
  issues: LegacyBackfillIssue[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) {
      issues.push({
        code: `LEGACY_${label}_DUPLICATE`,
        message: `Legacy ${label.toLowerCase()} identifiers must be unique.`,
        actual: id
      });
    }
    seen.add(id);
  }
}

function requireReference(
  available: ReadonlySet<string>,
  id: string,
  label: string,
  issues: LegacyBackfillIssue[]
): void {
  if (!available.has(id)) {
    issues.push({
      code: `LEGACY_${label}_MISSING`,
      message: `Legacy ${label.toLowerCase()} reference is missing.`,
      actual: id
    });
  }
}

function mapIdentities<T>(
  values: readonly T[],
  key: (value: T) => string,
  identity: (value: T) => DeterministicLegacyIdentity
): Map<string, DeterministicLegacyIdentity> {
  return new Map(values.map((value) => [key(value), identity(value)]));
}

function requireIdentity(
  identities: ReadonlyMap<string, DeterministicLegacyIdentity>,
  key: string
): DeterministicLegacyIdentity {
  const identity = identities.get(key);
  if (identity === undefined) {
    throw new Error(`Validated legacy identity '${key}' is missing.`);
  }
  return identity;
}

function requireMapValue<T>(values: ReadonlyMap<string, T>, key: string): T {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`Validated legacy value '${key}' is missing.`);
  }
  return value;
}

function normalizeSource(source: LegacyTournamentSource): LegacyTournamentSource {
  return {
    ...source,
    tournamentStatistics: [...source.tournamentStatistics]
      .sort((left, right) => left.legacyTableId.localeCompare(right.legacyTableId))
      .map((table) => ({
        ...table,
        rows: [...table.rows].sort((left, right) =>
          left.rank - right.rank ||
          (left.legacyPlayerId ?? left.legacyTeamId ?? "").localeCompare(
            right.legacyPlayerId ?? right.legacyTeamId ?? ""
          )
        ).map((row) => ({
          ...row,
          metricValues: { ...row.metricValues }
        }))
      })),
    teams: [...source.teams].sort(
      (left, right) => left.sequence - right.sequence ||
        left.legacyTeamId.localeCompare(right.legacyTeamId)
    ),
    players: [...source.players].sort((left, right) =>
      left.legacyPlayerId.localeCompare(right.legacyPlayerId)
    ),
    rosterMemberships: [...source.rosterMemberships].sort(
      (left, right) =>
        left.legacyTeamId.localeCompare(right.legacyTeamId) ||
        left.sequence - right.sequence ||
        left.legacyPlayerId.localeCompare(right.legacyPlayerId)
    ),
    pods: [...source.pods]
      .sort(
        (left, right) => left.sequence - right.sequence ||
          left.legacyPodId.localeCompare(right.legacyPodId)
      )
      .map((pod) => ({
        ...pod,
        legacyTeamIds: [...pod.legacyTeamIds],
        legacyMatchIds: [...pod.legacyMatchIds]
      })),
    matches: [...source.matches]
      .sort(
        (left, right) => left.sequence - right.sequence ||
          left.legacyMatchId.localeCompare(right.legacyMatchId)
      )
      .map((match) => ({
        ...match,
        participants: [...match.participants],
        events: [...match.events].sort(
          (left, right) => left.sequence - right.sequence ||
            left.legacyEventId.localeCompare(right.legacyEventId)
        ),
        statistics: [...match.statistics].map((statistic) => ({
          ...statistic,
          metricValues: { ...statistic.metricValues }
        })),
        scorecardRows: [...match.scorecardRows]
          .sort((left, right) => left.sequence - right.sequence)
          .map((row) => ({
            ...row,
            legacyEventIds: [...row.legacyEventIds].sort(),
            values: { ...row.values }
          })),
        score: {
          ...match.score,
          participants: [...match.score.participants]
        }
      })),
    standings: [...source.standings].sort((left, right) =>
      left.legacyStandingId.localeCompare(right.legacyStandingId)
    ),
    bracket: source.bracket === undefined
      ? undefined
      : {
          ...source.bracket,
          rounds: [...source.bracket.rounds]
            .sort(
              (left, right) => left.sequence - right.sequence ||
                left.legacyRoundId.localeCompare(right.legacyRoundId)
            )
            .map((round) => ({
              ...round,
              matches: [...round.matches]
                .sort(
                  (left, right) => left.sequence - right.sequence ||
                    left.legacyBracketMatchId.localeCompare(
                      right.legacyBracketMatchId
                    )
                )
                .map((match) => ({
                  ...match,
                  slots: [...match.slots].sort(
                    (left, right) => left.sequence - right.sequence
                  )
                }))
            }))
        },
    matchIdentities: [...source.matchIdentities]
      .sort((left, right) =>
        left.legacyMatchId.localeCompare(right.legacyMatchId)
      )
      .map((identity) => ({
        ...identity,
        commentIds: [...identity.commentIds].sort(),
        reportIds: [...identity.reportIds].sort()
      }))
  };
}
