import {
  MatchRevisionEventInput
} from "../persistence/contracts";
import {
  CanonicalRuskiEventReduction,
  CanonicalRuskiPlayerTotals,
  CanonicalRuskiScoringTotals,
  CanonicalRuskiTeamTotals
} from "./contracts";
import { rejectScoring } from "./errors";

interface MutableTotals {
  attempts: number;
  makes: number;
  misses: number;
  splashOuts: number;
  guys: number;
  tris: number;
  dis: number;
  voms: number;
  cupsScored: number;
}

interface MutablePlayerTotals {
  readonly teamId: string;
  readonly totals: MutableTotals;
}

export function reduceCanonicalRuskiEvents(
  events: readonly MatchRevisionEventInput[]
): CanonicalRuskiEventReduction {
  const match = emptyTotals();
  const teams = new Map<string, MutableTotals>();
  const players = new Map<string, MutablePlayerTotals>();
  const eventIds = new Set<string>();
  const sequences = new Set<number>();

  events.forEach((event, index) => {
    const path = `events.${index}`;
    if (!Number.isSafeInteger(event.sequence) || event.sequence <= 0 ||
        sequences.has(event.sequence)) {
      rejectScoring(
        "CANONICAL_EVENT_SEQUENCE_INVALID",
        "Canonical event sequences must be positive and unique.",
        `${path}.sequence`
      );
    }
    if (eventIds.has(event.id)) {
      rejectScoring(
        "CANONICAL_EVENT_ID_DUPLICATE",
        "Canonical event identifiers must be unique.",
        `${path}.id`
      );
    }
    sequences.add(event.sequence);
    eventIds.add(event.id);

    if (event.type === "shot_attempt") {
      applyAttempt(event, match, teams, players, path);
      return;
    }
    if (event.shotAttempt !== undefined) {
      rejectScoring(
        "CANONICAL_NON_SHOT_HAS_ATTEMPT",
        "Only a shot-attempt event may contain a shot payload.",
        `${path}.shotAttempt`
      );
    }
    if (event.type === "vom") {
      const subjects = requireSubjects(event, teams, players, path);
      incrementVom(match);
      incrementVom(subjects.team);
      incrementVom(subjects.player);
    }
  });

  return {
    match: finalize(match),
    teams: [...teams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([teamId, totals]): CanonicalRuskiTeamTotals => ({
        teamId: teamId as CanonicalRuskiTeamTotals["teamId"],
        totals: finalize(totals)
      })),
    players: [...players.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([playerId, value]): CanonicalRuskiPlayerTotals => ({
        playerId: playerId as CanonicalRuskiPlayerTotals["playerId"],
        teamId: value.teamId as CanonicalRuskiPlayerTotals["teamId"],
        totals: finalize(value.totals)
      }))
  };
}

function applyAttempt(
  event: MatchRevisionEventInput,
  match: MutableTotals,
  teams: Map<string, MutableTotals>,
  players: Map<string, MutablePlayerTotals>,
  path: string
): void {
  const attempt = event.shotAttempt;
  if (attempt === undefined) {
    rejectScoring(
      "CANONICAL_SHOT_PAYLOAD_REQUIRED",
      "A shot-attempt event requires its attempt payload.",
      `${path}.shotAttempt`
    );
  }
  const subjects = requireSubjects(event, teams, players, path);
  const expectedCupDelta = cupDeltaFor(
    attempt.outcome,
    attempt.classification,
    `${path}.shotAttempt`
  );
  if (!Number.isSafeInteger(attempt.cupDelta) ||
      attempt.cupDelta !== expectedCupDelta) {
    rejectScoring(
      "CANONICAL_CUP_DELTA_INVALID",
      "Shot cup delta does not match the Ruski outcome and classification.",
      `${path}.shotAttempt.cupDelta`
    );
  }
  [match, subjects.team, subjects.player].forEach((totals) => {
    totals.attempts += 1;
    totals.cupsScored += attempt.cupDelta;
    if (attempt.outcome === "make") {
      totals.makes += 1;
    } else {
      totals.misses += 1;
    }
    switch (attempt.classification) {
    case "splash_out": totals.splashOuts += 1; break;
    case "guy": totals.guys += 1; break;
    case "tri": totals.tris += 1; break;
    case "di": totals.dis += 1; break;
    case undefined: break;
    }
  });
}

function cupDeltaFor(
  outcome: "make" | "miss",
  classification: "guy" | "di" | "tri" | "splash_out" | undefined,
  path: string
): number {
  if (outcome === "make") {
    if (classification !== undefined) {
      rejectScoring(
        "CANONICAL_MAKE_CLASSIFIED",
        "A made attempt cannot carry a miss classification.",
        `${path}.classification`
      );
    }
    return 1;
  }
  switch (classification) {
  case "di": return 2;
  case "tri": return 3;
  case "guy":
  case "splash_out":
  case undefined:
    return 0;
  }
}

function requireSubjects(
  event: MatchRevisionEventInput,
  teams: Map<string, MutableTotals>,
  players: Map<string, MutablePlayerTotals>,
  path: string
): { team: MutableTotals; player: MutableTotals } {
  if (event.teamId === undefined || event.playerId === undefined) {
    rejectScoring(
      "CANONICAL_EVENT_ATTRIBUTION_REQUIRED",
      "Ruski attempts and Vom events require team and player attribution.",
      path
    );
  }
  const team = teams.get(event.teamId) ?? emptyTotals();
  teams.set(event.teamId, team);
  const existing = players.get(event.playerId);
  if (existing !== undefined && existing.teamId !== event.teamId) {
    rejectScoring(
      "CANONICAL_PLAYER_TEAM_CONFLICT",
      "A canonical scoring player cannot be attributed to multiple teams.",
      `${path}.playerId`
    );
  }
  const player = existing ?? { teamId: event.teamId, totals: emptyTotals() };
  players.set(event.playerId, player);
  return { team, player: player.totals };
}

function emptyTotals(): MutableTotals {
  return {
    attempts: 0,
    makes: 0,
    misses: 0,
    splashOuts: 0,
    guys: 0,
    tris: 0,
    dis: 0,
    voms: 0,
    cupsScored: 0
  };
}

function incrementVom(totals: MutableTotals): void {
  totals.voms += 1;
}

function finalize(totals: MutableTotals): CanonicalRuskiScoringTotals {
  return {
    ...totals,
    shootingPercentage: totals.attempts === 0
      ? null
      : totals.makes / totals.attempts
  };
}
