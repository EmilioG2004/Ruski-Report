/**
 * Compares the material fields shared by the legacy and canonical public APIs.
 * Results contain only stable rule codes and never echo response payloads.
 */

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
  compareScalar(
    mismatches,
    "standings",
    legacyStandings(input.legacyTournament?.standings),
    canonicalStandings(input.canonicalTournament?.pods)
  );
  compareScalar(
    mismatches,
    "tournament_statistics",
    legacyTournamentStatistics(input.legacyTournament?.statistics),
    canonicalTournamentStatistics(input.canonicalTournament?.statistics)
  );
  compareScalar(
    mismatches,
    "effective_seeds",
    legacyEffectiveSeeds(input.legacyTournament?.teams),
    canonicalEffectiveSeeds(input.canonicalTournament?.seeds)
  );
  compareScalar(
    mismatches,
    "match_details",
    legacyMatchDetails(input.legacyMatchDetails),
    canonicalMatchDetails(input.canonicalMatchDetails)
  );
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
  if (match?.status !== "final") return null;
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
      source: slot?.source?.type ?? (slot?.teamId === undefined ? "tbd" : "team"),
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
    outcome: event?.type === "make" ? "made" :
      event?.type === "vom" ? null : "missed",
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

function compareScalar(mismatches, code, left, right) {
  if (left !== right) mismatches.push({ code });
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
