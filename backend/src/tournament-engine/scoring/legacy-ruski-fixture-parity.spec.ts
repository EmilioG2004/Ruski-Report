import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GameEvent } from "../../domain";
import { RUSKI_EVENT_TYPE_IDS } from "../../games/ruski/definition";
import { RuskiScorebookNormalizer } from "../../games/ruski/normalizer";
import { RuskiScorebookParser } from "../../games/ruski/parser";
import { MatchRevisionEventInput } from "../persistence/contracts";
import { parseStableUuid } from "../domain";
import { createUuidV5 } from "../scheduling/uuid-v5";
import { reduceCanonicalRuskiEvents } from ".";

const FIXTURE_PATH = join(process.cwd(), "../docs/2026 Ruski Stat Sheet.xlsx");
const PARITY_NAMESPACE = "e2e23309-8dc1-5e0f-b9d4-e06de85a7f3d";

describe("canonical scoring legacy fixture parity", () => {
  it("preserves the completed 2026 event and attempt aggregates", async () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const parsed = await new RuskiScorebookParser().parseScorebook({
      buffer,
      originalName: "2026 Ruski Stat Sheet.xlsx",
      sizeBytes: buffer.byteLength,
      metadata: { year: 2026 }
    });
    const snapshot = await new RuskiScorebookNormalizer(undefined, {
      now: () => "2026-12-31T00:00:00.000Z",
      year: 2026
    }).normalizeScorebook(parsed);
    const legacyEvents = snapshot.matches.flatMap((match) => match.events);
    const canonicalEvents = legacyEvents.map(toCanonicalEvent);
    const reduction = reduceCanonicalRuskiEvents(canonicalEvents);

    expect(legacyEvents).toHaveLength(4_163);
    expect(reduction.match).toEqual({
      attempts: 4_156,
      makes: 990,
      misses: 3_166,
      shootingPercentage: 990 / 4_156,
      splashOuts: 151,
      guys: 219,
      tris: 8,
      dis: 0,
      voms: 7,
      cupsScored: 1_014
    });
    expect(hasVomAndMakeOnOneShot(legacyEvents)).toBe(true);
    expect(
      reduction.match.attempts
    ).toBe(reduction.match.makes + reduction.match.misses);
  });
});

function toCanonicalEvent(
  event: GameEvent,
  index: number
): MatchRevisionEventInput {
  const eventName = `event|${event.matchId}|${event.sequence}|${event.type}`;
  const sourceTeamId = event.teamId ?? `${event.matchId}:unknown-team`;
  const common = {
    id: parseStableUuid(
      createUuidV5(PARITY_NAMESPACE, eventName),
      "scoring_event"
    ),
    sequence: index + 1,
    teamId: stableSubject(sourceTeamId, "tournament_team"),
    playerId: stableSubject(`${sourceTeamId}|${event.playerId ?? "unknown-player"}`,
      "tournament_player")
  } as const;

  if (event.type === RUSKI_EVENT_TYPE_IDS.vom) {
    return { ...common, type: "vom" };
  }
  const classification = event.type === RUSKI_EVENT_TYPE_IDS.splashOut
    ? "splash_out" as const
    : event.type === RUSKI_EVENT_TYPE_IDS.guy ? "guy" as const
    : event.type === RUSKI_EVENT_TYPE_IDS.tri ? "tri" as const
    : event.type === RUSKI_EVENT_TYPE_IDS.di ? "di" as const
    : undefined;
  const outcome = event.type === RUSKI_EVENT_TYPE_IDS.make
    ? "make" as const
    : "miss" as const;
  const cupDelta = outcome === "make" ? 1
    : classification === "di" ? 2
    : classification === "tri" ? 3
    : 0;
  return {
    ...common,
    type: "shot_attempt",
    shotAttempt: {
      outcome,
      ...(classification === undefined ? {} : { classification }),
      cupDelta
    }
  };
}

function stableSubject<Kind extends "tournament_team" | "tournament_player">(
  sourceId: string,
  kind: Kind
) {
  return parseStableUuid(
    createUuidV5(PARITY_NAMESPACE, `${kind}|${sourceId}`),
    kind
  );
}

function hasVomAndMakeOnOneShot(events: readonly GameEvent[]): boolean {
  const eventTypesByShot = new Map<string, Set<string>>();
  events.forEach((event) => {
    const key = [
      event.matchId,
      event.teamId,
      event.metadata?.sideId,
      event.metadata?.turnNumber,
      event.metadata?.shotInTeamTurn
    ].join("|");
    const types = eventTypesByShot.get(key) ?? new Set<string>();
    types.add(event.type);
    eventTypesByShot.set(key, types);
  });
  return [...eventTypesByShot.values()].some((types) =>
    types.has(RUSKI_EVENT_TYPE_IDS.make) &&
    types.has(RUSKI_EVENT_TYPE_IDS.vom)
  );
}
