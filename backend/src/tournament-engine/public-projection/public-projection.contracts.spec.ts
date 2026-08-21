import { canonicalPublicProjectionFixture } from "./fixtures/canonical-public-projection.fixture";
import {
  digestCanonicalPublicJson,
  serializeCanonicalPublicJson
} from "./canonical-json";

describe("canonical public projection v2 contract", () => {
  it("serializes deterministically without engine UUID identities", () => {
    const first = serializeCanonicalPublicJson(canonicalPublicProjectionFixture);
    const second = serializeCanonicalPublicJson({
      matches: canonicalPublicProjectionFixture.matches,
      tournament: canonicalPublicProjectionFixture.tournament
    });

    expect(first).toBe(second);
    expect(digestCanonicalPublicJson(canonicalPublicProjectionFixture))
      .toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i
    );
  });

  it("keeps status separate from score availability across public states", () => {
    const matches = canonicalPublicProjectionFixture.matches;
    expect(matches.map((match) => [match.status, match.scoreAvailability]))
      .toEqual(expect.arrayContaining([
        ["scheduled", "not_started"],
        ["in_progress", "partial"],
        ["final", "complete"],
        ["forfeited", "not_applicable"],
        ["final", "unrecorded"],
        ["cancelled", "not_applicable"]
      ]));
    expect(matches.find((match) => match.status === "cancelled")
      ?.participants.every((participant) => participant.score === null)).toBe(true);
    expect(matches.find((match) => match.status === "forfeited")?.winner)
      .toEqual({ id: "team-alpha", name: "Alpha" });
    expect(matches.find((match) => match.id === "final-match")?.winner)
      .toEqual({ id: "team-alpha", name: "Alpha" });
  });

  it("uses current rosters for scheduled matches and historical players for finals", () => {
    const scheduled = canonicalPublicProjectionFixture.matches.find(
      (match) => match.id === "scheduled-match"
    );
    const final = canonicalPublicProjectionFixture.matches.find(
      (match) => match.id === "final-match"
    );
    expect(scheduled?.participants[0]?.players[0]?.id).toBe("player-new-a");
    expect(final?.participants[0]?.players[0]?.id).toBe("player-old-a");
  });

  it("retains corrected match instances and current bracket node identity", () => {
    const old = canonicalPublicProjectionFixture.matches.find(
      (match) => match.id === "playoff-rematch-one"
    );
    const replacement = canonicalPublicProjectionFixture.matches.find(
      (match) => match.id === "playoff-rematch-two"
    );
    const node = canonicalPublicProjectionFixture.tournament.bracket
      ?.rounds[0]?.matches[0];

    expect(old?.correction.replacedByMatchId).toBe("playoff-rematch-two");
    expect(replacement?.correction.replacesMatchId).toBe("playoff-rematch-one");
    expect(node?.matchId).toBe("playoff-rematch-two");
  });

  it("allows same-pod playoff rematches and represents bye and TBD slots", () => {
    const replacement = canonicalPublicProjectionFixture.matches.find(
      (match) => match.id === "playoff-rematch-two"
    );
    const slots = canonicalPublicProjectionFixture.tournament.bracket?.rounds
      .flatMap((round) => round.matches)
      .flatMap((match) => match.slots);

    expect(replacement?.participants.map((participant) => participant.team.id))
      .toEqual(["team-alpha", "team-beta"]);
    expect(slots?.some((slot) => slot.source === "bye")).toBe(true);
    expect(slots?.some((slot) => slot.source === "tbd")).toBe(true);
  });
});
