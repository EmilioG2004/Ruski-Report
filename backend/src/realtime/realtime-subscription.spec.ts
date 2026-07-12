import { normalizeSubscription } from "./realtime-subscription";

describe("normalizeSubscription", () => {
  it("defaults to all updates", () => {
    expect(normalizeSubscription({})).toEqual({
      ok: true,
      value: {
        scope: "all",
        room: "live:all"
      }
    });
  });

  it("normalizes tournament and match subscriptions", () => {
    expect(
      normalizeSubscription({
        tournamentId: "tournament-2026"
      })
    ).toEqual({
      ok: true,
      value: {
        scope: "tournament",
        room: "live:tournament:tournament-2026",
        tournamentId: "tournament-2026"
      }
    });

    expect(
      normalizeSubscription({
        tournamentId: "tournament-2026",
        matchId: "match-1"
      })
    ).toEqual({
      ok: true,
      value: {
        scope: "match",
        room: "live:match:match-1",
        tournamentId: "tournament-2026",
        matchId: "match-1"
      }
    });
  });

  it("rejects incomplete scoped subscriptions", () => {
    expect(normalizeSubscription({ scope: "tournament" })).toEqual({
      ok: false,
      code: "TOURNAMENT_ID_REQUIRED",
      message: "A tournament subscription requires tournamentId."
    });

    expect(normalizeSubscription({ scope: "match" })).toEqual({
      ok: false,
      code: "MATCH_ID_REQUIRED",
      message: "A match subscription requires matchId."
    });
  });
});
