import { createMainTournamentConfiguration } from "../configuration";
import {
  CanonicalTournament,
  isActivePublicTournament,
  parseStableUuid
} from ".";

describe("canonical tournament domain", () => {
  it("brands validated UUID identities and rejects mutable display identifiers", () => {
    const id = parseStableUuid(
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      "tournament"
    );

    expect(id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(() => parseStableUuid("tournament-2027", "tournament"))
      .toThrow("Invalid tournament UUID");
    expect(() => parseStableUuid(
      "00000000-0000-0000-0000-000000000000",
      "match"
    )).toThrow("Invalid match UUID");
  });

  it("allows multiple active public tournaments in one year without featured state", () => {
    const tournaments: CanonicalTournament[] = [1, 2].map((sequence) => ({
      id: parseStableUuid(uuid(sequence), "tournament"),
      year: 2027,
      name: `Tournament ${sequence}`,
      lifecycle: sequence === 1 ? "setup_published" : "pod_play",
      visibility: "public",
      configuration: createMainTournamentConfiguration()
    }));

    expect(tournaments.filter(isActivePublicTournament)).toHaveLength(2);
    expect(new Set(tournaments.map((tournament) => tournament.id)).size).toBe(2);
  });

  it("excludes private, draft, completed, and archived tournaments from active discovery", () => {
    expect(isActivePublicTournament({
      lifecycle: "playoffs",
      visibility: "private"
    })).toBe(false);
    expect(isActivePublicTournament({
      lifecycle: "draft_setup",
      visibility: "public"
    })).toBe(false);
    expect(isActivePublicTournament({
      lifecycle: "completed",
      visibility: "public"
    })).toBe(false);
    expect(isActivePublicTournament({
      lifecycle: "archived",
      visibility: "public"
    })).toBe(false);
    expect(isActivePublicTournament({
      lifecycle: "seeding_review",
      visibility: "public"
    })).toBe(true);
  });
});

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
