/**
 * Compares the material fields shared by the legacy and canonical public APIs.
 * Results contain only stable rule codes and never echo response payloads.
 */

import { createHash } from "node:crypto";

export function comparePublicContracts(input) {
  const mismatches = [];
  compareScalar(
    mismatches,
    "tournament_identity",
    tournamentIdentity(input.legacyTournament),
    tournamentIdentity(input.canonicalTournament)
  );
  compareScalar(
    mismatches,
    "team_roster",
    legacyRosters(input.legacyTournament),
    canonicalRosters(input.canonicalTournament)
  );
  compareScalar(
    mismatches,
    "match_summary",
    legacyMatches(input.legacyMatches),
    canonicalMatches(input.canonicalMatches)
  );
  compareScalar(
    mismatches,
    "bracket_progression",
    legacyBracket(input.legacyTournament?.bracket),
    canonicalBracket(input.canonicalTournament?.bracket)
  );
  compareCondition(mismatches, "standings", standingsEquivalent(
    input.legacyTournament?.standings,
    input.canonicalTournament?.pods
  ));
  compareCondition(mismatches, "tournament_statistics", tournamentStatisticsEquivalent(
    input.legacyTournament?.statistics,
    input.canonicalTournament?.statistics,
    input.expectedTournamentStatisticCorrections
  ));
  compareCondition(mismatches, "effective_seeds", effectiveSeedsEquivalent(
    input.legacyTournament?.teams,
    input.canonicalTournament?.seeds
  ));
  compareCondition(mismatches, "match_details", matchDetailsEquivalent(
    input.legacyMatchDetails,
    input.canonicalMatchDetails
  ));
  return { equivalent: mismatches.length === 0, mismatches };
}

function tournamentIdentity(tournament) {
  return stable({
    id: tournament?.id ?? null,
    gameType: tournament?.gameType ?? null,
    year: tournament?.year ?? null,
    name: tournament?.name ?? null
  });
}

function legacyRosters(tournament) {
  return stableRosters(tournament?.teams, (team) => ({
    id: team?.id ?? null,
    name: team?.name ?? null,
    players: stablePlayers(team?.players)
  }));
}

function canonicalRosters(tournament) {
  return stableRosters(tournament?.rosters, (team) => ({
    id: team?.id ?? null,
    name: team?.name ?? null,
    players: stablePlayers(team?.players)
  }));
}

function legacyEffectiveSeeds(teams) {
  if (!Array.isArray(teams)) return "invalid";
  return stable(teams.filter((team) => team?.seed?.overall !== undefined)
    .map((team) => ({ teamId: team?.id ?? null, seed: team.seed.overall }))
    .sort(byTeam));
}

function canonicalEffectiveSeeds(seeds) {
  if (!Array.isArray(seeds)) return "invalid";
  return stable(seeds.map((seed) => ({
    teamId: seed?.team?.id ?? null,
    seed: seed?.effectiveSeed ?? null
  })).sort(byTeam));
}

function effectiveSeedsEquivalent(teams, seeds) {
  if (!Array.isArray(teams) || !Array.isArray(seeds)) return false;
  const canonical = new Map(seeds.map((seed) => [
    seed?.team?.id ?? null,
    seed?.effectiveSeed ?? null
  ]));
  const legacy = teams.filter((team) => team?.seed?.overall !== undefined);
  return legacy.every((team) =>
    canonical.get(team?.id ?? null) === team.seed.overall
  );
}

function stableRosters(teams, map) {
  if (!Array.isArray(teams)) return "invalid";
  return stable(teams.map(map).sort(byId));
}

function stablePlayers(players) {
  if (!Array.isArray(players)) return [];
  return players.map((player) => ({
    id: player?.id ?? null,
    displayName: player?.displayName ?? null
  })).sort(byId);
}

function legacyMatches(matches) {
  return stableMatchList(matches, (match) => ({
    id: match?.id ?? null,
    status: match?.status ?? null,
    teamIds: array(match?.participants)
      .map((participant) => participant?.teamId ?? null).sort(),
    playerIds: array(match?.participants)
      .flatMap((participant) => array(participant?.playerIds)).sort(),
    winnerTeamId: match?.score?.winnerTeamId ?? null,
    scores: comparableLegacyScores(match),
    scoreAvailability: legacyScoreAvailability(match)
  }));
}

function canonicalMatches(matches) {
  return stableMatchList(matches, (match) => ({
    id: match?.id ?? null,
    status: match?.status ?? null,
    teamIds: array(match?.participants)
      .map((participant) => participant?.team?.id ?? null).sort(),
    playerIds: array(match?.participants)
      .flatMap((participant) => array(participant?.players)
        .map((player) => player?.id ?? null)).sort(),
    winnerTeamId: match?.winner?.id ?? null,
    scores: comparableCanonicalScores(match),
    scoreAvailability: match?.scoreAvailability ?? null
  }));
}

function stableMatchList(matches, map) {
  if (!Array.isArray(matches)) return "invalid";
  return stable(matches.map(map).sort(byId));
}

function comparableLegacyScores(match) {
  if (
    match?.status !== "final" ||
    legacyScoreAvailability(match) !== "complete"
  ) return null;
  return array(match?.score?.participants)
    .map((score) => [score?.teamId ?? null, score?.score ?? null])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function comparableCanonicalScores(match) {
  if (match?.status !== "final" || match?.scoreAvailability !== "complete") {
    return null;
  }
  return array(match?.participants)
    .map((participant) => [
      participant?.team?.id ?? null,
      participant?.score ?? null
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
}

function legacyScoreAvailability(match) {
  if (["forfeited", "cancelled"].includes(match?.status)) {
    return "not_applicable";
  }
  if (["scheduled", "postponed"].includes(match?.status)) {
    return "not_started";
  }
  const scoreCount = array(match?.score?.participants).length;
  if (match?.status === "final") {
    return scoreCount === 0 ? "unrecorded" : "complete";
  }
  return scoreCount === 0 ? "not_started" : "partial";
}

function legacyBracket(bracket) {
  return bracketSignature(bracket, (match) => ({
    id: match?.id ?? null,
    matchId: match?.matchId ?? null,
    winnerTeamId: match?.winnerTeamId ?? null,
    slots: array(match?.slots).map((slot) => ({
      source: canonicalBracketSource(
        slot?.source?.type ?? (slot?.teamId === undefined ? "tbd" : "team")
      ),
      sourceBracketMatchId: slot?.source?.sourceMatchId ?? null,
      teamId: slot?.teamId ?? null,
      seed: slot?.seed ?? null
    }))
  }));
}

function canonicalBracket(bracket) {
  return bracketSignature(bracket, (match) => ({
    id: match?.id ?? null,
    matchId: match?.matchId ?? null,
    winnerTeamId: match?.winner?.id ?? null,
    slots: array(match?.slots).map((slot) => ({
      source: slot?.source ?? null,
      sourceBracketMatchId: slot?.sourceBracketMatchId ?? null,
      teamId: slot?.team?.id ?? null,
      seed: slot?.seed ?? null
    }))
  }));
}

function canonicalBracketSource(source) {
  return source === "match-winner" ? "match_winner" : source;
}

function bracketSignature(bracket, map) {
  if (bracket === undefined || bracket === null) return stable([]);
  if (!Array.isArray(bracket.rounds)) return "invalid";
  return stable(bracket.rounds.flatMap((round) => array(round?.matches).map(map))
    .sort(byId));
}

function legacyStandings(standings) {
  if (!Array.isArray(standings)) return "invalid";
  return stable(standings.map((standing) => ({
    podId: standing?.podId ?? null,
    teamId: standing?.teamId ?? null,
    rank: standing?.rank ?? null,
    wins: standing?.record?.wins ?? null,
    losses: standing?.record?.losses ?? null,
    cupDifferential: metric(standing?.metricValues, "cupDifferential"),
    makes: metric(standing?.metricValues, "makes"),
    attempts: metric(standing?.metricValues, "attempts"),
    shootingPercentage: metric(standing?.metricValues, "shootingPercentage")
  })).sort(byPodAndTeam));
}

function canonicalStandings(pods) {
  if (!Array.isArray(pods)) return "invalid";
  return stable(pods.flatMap((pod) => array(pod?.standings).map((standing) => ({
    podId: pod?.id ?? null,
    teamId: standing?.team?.id ?? null,
    rank: standing?.rank ?? null,
    wins: standing?.wins ?? null,
    losses: standing?.losses ?? null,
    cupDifferential: standing?.cupDifferential ?? null,
    makes: standing?.makes ?? null,
    attempts: standing?.attempts ?? null,
    shootingPercentage: standing?.shootingPercentage ?? null
  }))).sort(byPodAndTeam));
}

function standingsEquivalent(standings, pods) {
  if (!Array.isArray(standings) || !Array.isArray(pods)) return false;
  const canonicalRows = pods.flatMap((pod) => array(pod?.standings).map(
    (standing) => ({ pod, standing })
  ));
  if (standings.length !== canonicalRows.length) return false;
  const canonical = new Map(canonicalRows.map(({ pod, standing }) => [
    `${pod?.id ?? null}:${standing?.team?.id ?? null}`,
    standing
  ]));
  return standings.every((standing) => {
    const row = canonical.get(
      `${standing?.podId ?? null}:${standing?.teamId ?? null}`
    );
    if (row === undefined) return false;
    const values = standing?.metricValues;
    return row?.rank === (standing?.rank ?? null) &&
      row?.wins === (standing?.record?.wins ?? null) &&
      row?.losses === (standing?.record?.losses ?? null) &&
      numbersEquivalent(metric(values, "cupDifferential"), row?.cupDifferential) &&
      numbersEquivalent(metric(values, "shootingPercentage"), row?.shootingPercentage) &&
      optionalMetricEquivalent(values, "makes", row?.makes) &&
      optionalMetricEquivalent(values, "attempts", row?.attempts);
  });
}

function optionalMetricEquivalent(values, key, actual) {
  return values === null || typeof values !== "object" || !(key in values)
    ? true
    : numbersEquivalent(values[key], actual);
}

function legacyTournamentStatistics(tables) {
  if (!Array.isArray(tables)) return stable([]);
  return stable(tables.flatMap((table) => array(table?.rows).map((row) => ({
    stage: table?.scope === "playoffs" ? "playoffs" : "pod_play",
    subjectId: row?.subject?.teamId ?? row?.subject?.playerId ?? null,
    values: sortedValues(row?.values)
  }))).sort(byStageAndSubject));
}

function canonicalTournamentStatistics(statistics) {
  if (!Array.isArray(statistics)) return stable([]);
  return stable(statistics.filter((statistic) => statistic?.scope === "tournament")
    .map((statistic) => ({
      stage: statistic?.stage ?? null,
      subjectId: statistic?.subject?.id ?? null,
      values: sortedValues(statistic?.values)
    })).sort(byStageAndSubject));
}

export function summarizeTournamentStatisticCorrections(tables, statistics) {
  if (!Array.isArray(tables) || !Array.isArray(statistics)) return null;
  const canonical = statistics.filter((statistic) => statistic?.scope === "tournament");
  const corrections = [];
  for (const table of tables) {
    const stage = table?.scope === "season" ? null : "playoffs";
    const subjectType = table?.subjectType;
    if (subjectType !== "team" && subjectType !== "player") return null;
    for (const row of array(table?.rows)) {
      const subjectId = subjectType === "team"
        ? row?.subject?.teamId
        : row?.subject?.playerId;
      if (typeof subjectId !== "string" || subjectId.length === 0) return null;
      const candidates = canonical.filter((statistic) =>
        statistic?.stage === stage && statistic?.subject?.id === subjectId
      );
      if (candidates.length !== 1) return null;
      const candidate = candidates[0];
      for (const [legacyMetric, expected] of Object.entries(row?.values ?? {})) {
        const metricKey = legacyCorrectionMetricKey(legacyMetric);
        if (metricKey === undefined) continue;
        if (!(metricKey in (candidate?.values ?? {}))) return null;
        const actual = candidate.values[metricKey];
        if (!numbersEquivalent(expected, actual)) {
          corrections.push({
            scope: table.scope,
            subjectType,
            subjectId,
            metric: metricKey,
            legacyValue: expected,
            canonicalValue: actual
          });
        }
      }
    }
  }
  corrections.sort((left, right) =>
    left.scope.localeCompare(right.scope) ||
    left.subjectType.localeCompare(right.subjectType) ||
    left.subjectId.localeCompare(right.subjectId) ||
    left.metric.localeCompare(right.metric)
  );
  return {
    policy: "canonical_match_events_v1",
    mismatchCount: corrections.length,
    mismatchDigest: digest(corrections)
  };
}

function tournamentStatisticsEquivalent(tables, statistics, expected) {
  const actual = summarizeTournamentStatisticCorrections(tables, statistics);
  if (actual === null) return false;
  const required = expected ?? {
    policy: "canonical_match_events_v1",
    mismatchCount: 0,
    mismatchDigest: digest([])
  };
  return required?.policy === actual.policy &&
    required?.mismatchCount === actual.mismatchCount &&
    required?.mismatchDigest === actual.mismatchDigest;
}

function legacyMatchDetails(details) {
  return stableDetailList(details, (detail) => ({
    id: detail?.id ?? null,
    participants: array(detail?.participants).map((participant) => ({
      teamId: participant?.teamId ?? null,
      playerIds: array(participant?.playerIds).sort()
    })).sort(byTeam),
    events: array(detail?.events).map(normalizeLegacyEvent).sort(bySequence),
    boxScore: normalizeLegacyBoxScore(detail?.boxScore),
    scorecard: normalizeScorecard(detail?.scorecard)
  }));
}

function canonicalMatchDetails(details) {
  return stableDetailList(details, (detail) => ({
    id: detail?.id ?? null,
    participants: array(detail?.participants).map((participant) => ({
      teamId: participant?.team?.id ?? null,
      playerIds: array(participant?.players).map((player) => player?.id ?? null).sort()
    })).sort(byTeam),
    events: array(detail?.events).map(normalizeCanonicalEvent).sort(bySequence),
    boxScore: normalizeCanonicalBoxScore(detail?.boxScore),
    scorecard: normalizeScorecard(detail?.scorecard)
  }));
}

function matchDetailsEquivalent(legacyDetails, canonicalDetails) {
  if (!Array.isArray(legacyDetails) || !Array.isArray(canonicalDetails)) {
    return false;
  }
  if (legacyDetails.length !== canonicalDetails.length) return false;
  const canonicalById = new Map(canonicalDetails.map((detail) => [detail?.id, detail]));
  return legacyDetails.every((legacy) => {
    const canonical = canonicalById.get(legacy?.id);
    return canonical !== undefined &&
      participantsEquivalent(legacy?.participants, canonical?.participants) &&
      eventsEquivalent(legacy?.events, canonical?.events) &&
      boxScoresEquivalent(legacy?.boxScore, canonical?.boxScore) &&
      scorecardsEquivalent(legacy, canonical);
  });
}

function participantsEquivalent(legacyParticipants, canonicalParticipants) {
  const legacy = array(legacyParticipants).map((participant) => ({
    teamId: participant?.teamId ?? null,
    playerIds: array(participant?.playerIds).sort()
  })).sort(byTeam);
  const canonical = array(canonicalParticipants).map((participant) => ({
    teamId: participant?.team?.id ?? null,
    playerIds: array(participant?.players)
      .map((player) => player?.id ?? null).sort()
  })).sort(byTeam);
  return stable(legacy) === stable(canonical);
}

function eventsEquivalent(legacyEvents, canonicalEvents) {
  const legacy = array(legacyEvents).map(normalizeLegacyEvent).sort(bySequence);
  const canonical = array(canonicalEvents).map(normalizeCanonicalEvent).sort(bySequence);
  if (legacy.length !== canonical.length) return false;
  return legacy.every((event, index) => {
    const candidate = canonical[index];
    return candidate !== undefined &&
      event.sequence === candidate.sequence &&
      event.type === candidate.type &&
      event.teamId === candidate.teamId &&
      (event.playerId === null || event.playerId === candidate.playerId) &&
      event.outcome === candidate.outcome &&
      event.classification === candidate.classification;
  });
}

function boxScoresEquivalent(legacyBoxScore, canonicalBoxScore) {
  const sourceRows = array(legacyBoxScore?.rows);
  const canonicalRows = array(canonicalBoxScore?.rows);
  if (sourceRows.length === 0) return canonicalRows.length === 0;
  const explicitPlayerIds = new Set(sourceRows.flatMap((row) =>
    row?.subject?.type === "player" && typeof row?.subject?.playerId === "string"
      ? [row.subject.playerId]
      : []
  ));
  return sourceRows.every((row) => {
    const subjectType = row?.subject?.type;
    const subjectId = subjectType === "player"
      ? row?.subject?.playerId
      : subjectType === "team" ? row?.subject?.teamId : undefined;
    if (typeof subjectId !== "string" || subjectId.length === 0) return false;
    const candidates = canonicalRows.filter((candidate) =>
      subjectType === "player"
        ? candidate?.subject?.type === "player" &&
          candidate?.subject?.id === subjectId
        : candidate?.teamId === subjectId && (
          candidate?.subject?.type === "team" ||
          !explicitPlayerIds.has(candidate?.subject?.id)
        )
    ).filter((candidate) => Object.entries(row?.stats ?? {}).every(
      ([key, expected]) => {
        const metricKey = legacyCorrectionMetricKey(key);
        return metricKey === undefined || numbersEquivalent(
          expected,
          candidate?.values?.[metricKey]
        );
      }
    ));
    return candidates.length === 1;
  });
}

function scorecardsEquivalent(legacyDetail, canonicalDetail) {
  const legacyEvents = new Map(array(legacyDetail?.events).map((event) => [
    event?.id,
    event
  ]));
  const canonicalEvents = new Map(array(canonicalDetail?.events).map((event) => [
    event?.sequence,
    event
  ]));
  const shotRows = array(legacyDetail?.scorecard?.rows).flatMap((row) => {
    const event = array(row?.eventIds).map((id) => legacyEvents.get(id))
      .find((candidate) => candidate !== undefined && candidate?.type !== "vom");
    return event === undefined ? [] : [{ row, event }];
  });
  const canonicalRows = array(canonicalDetail?.scorecard?.rows);
  if (shotRows.length !== canonicalRows.length) return false;
  const canonicalRowsById = new Map(canonicalRows.map((row) => [row?.id, row]));
  return shotRows.every(({ row, event }) => {
    const canonicalEvent = canonicalEvents.get(event?.sequence);
    const canonicalRow = canonicalRowsById.get(canonicalEvent?.id);
    return canonicalEvent !== undefined && canonicalRow !== undefined &&
      canonicalRow?.sequence === canonicalEvent?.sequence &&
      (row?.teamId === undefined || row?.teamId === canonicalRow?.teamId) &&
      (row?.playerId === undefined || row?.playerId === canonicalRow?.playerId);
  });
}

function stableDetailList(details, map) {
  if (!Array.isArray(details)) return "invalid";
  return stable(details.map(map).sort(byId));
}

function normalizeLegacyEvent(event) {
  const classifications = {
    "splash-out": "splash_out",
    guy: "guy",
    tri: "tri",
    di: "di"
  };
  return {
    sequence: event?.sequence ?? null,
    type: event?.type === "vom" ? "vom" : "shot_attempt",
    teamId: event?.teamId ?? null,
    playerId: event?.playerId ?? null,
    outcome: event?.type === "make" ? "make" :
      event?.type === "vom" ? null : "miss",
    classification: classifications[event?.type] ?? null
  };
}

function normalizeCanonicalEvent(event) {
  return {
    sequence: event?.sequence ?? null,
    type: event?.type ?? null,
    teamId: event?.teamId ?? null,
    playerId: event?.playerId ?? null,
    outcome: event?.details?.outcome ?? null,
    classification: event?.details?.classification ?? null
  };
}

function normalizeLegacyBoxScore(boxScore) {
  if (boxScore === null || boxScore === undefined) return null;
  return array(boxScore?.rows).map((row) => ({
    subjectId: row?.subject?.teamId ?? row?.subject?.playerId ?? null,
    values: sortedValues(row?.stats)
  })).sort(bySubject);
}

function normalizeCanonicalBoxScore(boxScore) {
  if (boxScore === null || boxScore === undefined) return null;
  return array(boxScore?.rows).map((row) => ({
    subjectId: row?.subject?.id ?? null,
    values: sortedValues(row?.values)
  })).sort(bySubject);
}

function normalizeScorecard(scorecard) {
  if (scorecard === null || scorecard === undefined) return null;
  return array(scorecard?.rows).map((row) => ({
    sequence: row?.sequence ?? null,
    teamId: row?.teamId ?? null,
    playerId: row?.playerId ?? null
  })).sort(bySequence);
}

function metric(values, key) {
  return values !== null && typeof values === "object" && key in values
    ? values[key]
    : null;
}

function sortedValues(values) {
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }
  return Object.fromEntries(Object.entries(values)
    .map(([key, value]) => [canonicalMetricKey(key), value])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function canonicalMetricKey(key) {
  return ({
    cupDifferential: "cup_differential",
    cupsAgainst: "cups_against",
    cupsScored: "cups_scored",
    shootingPercentage: "shooting_percentage",
    splashOuts: "splash_outs"
  })[key] ?? key;
}

function legacyCorrectionMetricKey(key) {
  return ({
    makes: "makes",
    misses: "misses",
    attempts: "attempts",
    shootingPercentage: "shooting_percentage",
    splashOuts: "splash_outs",
    guys: "guys",
    tris: "tris",
    dis: "dis",
    voms: "voms",
    cupsScored: "cups_scored",
    cupsAgainst: "cups_against",
    cupDifferential: "cup_differential"
  })[key];
}

function compareScalar(mismatches, code, left, right) {
  if (left !== right) mismatches.push({ code });
}

function compareCondition(mismatches, code, condition) {
  if (!condition) mismatches.push({ code });
}

function numbersEquivalent(expected, actual) {
  if (expected === null || actual === null || actual === undefined) {
    return expected === actual;
  }
  return typeof expected === "number" && typeof actual === "number" &&
    Math.abs(expected - actual) <= 1e-10;
}

function digest(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function stable(value) {
  return JSON.stringify(value);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function byId(left, right) {
  return String(left.id).localeCompare(String(right.id));
}

function byPodAndTeam(left, right) {
  return `${left.podId}:${left.teamId}`.localeCompare(`${right.podId}:${right.teamId}`);
}

function byStageAndSubject(left, right) {
  return `${left.stage}:${left.subjectId}`.localeCompare(
    `${right.stage}:${right.subjectId}`
  );
}

function byTeam(left, right) {
  return String(left.teamId).localeCompare(String(right.teamId));
}

function bySubject(left, right) {
  return String(left.subjectId).localeCompare(String(right.subjectId));
}

function bySequence(left, right) {
  return Number(left.sequence) - Number(right.sequence);
}
