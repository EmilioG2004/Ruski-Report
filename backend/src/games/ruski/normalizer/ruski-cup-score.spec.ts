/**
 * Verifies that match scoring follows configured cup values independently of
 * box-score make/miss classification.
 */
import { GameEvent } from "../../../domain";
import { RUSKI_EVENT_TYPE_IDS, RUSKI_GAME_TYPE } from "../definition";
import { calculateRuskiCupScore } from "./ruski-cup-score";

describe("calculateRuskiCupScore", () => {
  it("adds configured cup values for makes, dis, and tris", () => {
    const events = [
      event("make", RUSKI_EVENT_TYPE_IDS.make, "team-a"),
      event("di", RUSKI_EVENT_TYPE_IDS.di, "team-a"),
      event("tri", RUSKI_EVENT_TYPE_IDS.tri, "team-a")
    ];

    expect(calculateRuskiCupScore(events, "team-a")).toBe(6);
  });

  it("ignores non-scoring events and events from another team", () => {
    const events = [
      event("miss", RUSKI_EVENT_TYPE_IDS.miss, "team-a"),
      event("guy", RUSKI_EVENT_TYPE_IDS.guy, "team-a"),
      event("other", RUSKI_EVENT_TYPE_IDS.make, "team-b")
    ];

    expect(calculateRuskiCupScore(events, "team-a")).toBe(0);
  });
});

function event(id: string, type: string, teamId: string): GameEvent {
  return {
    id: `event-${id}`,
    matchId: "match-test",
    gameType: RUSKI_GAME_TYPE,
    type,
    sequence: 1,
    teamId
  };
}
