import {
  completeMainTournamentFixture,
  completeSmallTournamentFixture,
  createTournamentSetupPreview
} from ".";

describe("tournament setup preview", () => {
  it("generates 48 stable matches and a SHA-256 digest for the main setup", () => {
    const first = createTournamentSetupPreview(
      completeMainTournamentFixture.configuration,
      completeMainTournamentFixture.setup,
      4
    );
    const second = createTournamentSetupPreview(
      completeMainTournamentFixture.configuration,
      {
        ...completeMainTournamentFixture.setup,
        teams: [...completeMainTournamentFixture.setup.teams].reverse(),
        pods: [...completeMainTournamentFixture.setup.pods].reverse().map((pod) => ({
          ...pod,
          teamAssignments: [...pod.teamAssignments].reverse()
        }))
      },
      4
    );

    expect(first.valid).toBe(true);
    expect(first.matches).toHaveLength(48);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });

  it("changes the confirmation digest when the optimistic version changes", () => {
    const first = createTournamentSetupPreview(
      completeSmallTournamentFixture.configuration,
      completeSmallTournamentFixture.setup,
      1
    );
    const second = createTournamentSetupPreview(
      completeSmallTournamentFixture.configuration,
      completeSmallTournamentFixture.setup,
      2
    );

    expect(first.digest).not.toBe(second.digest);
  });

  it("returns strict validation issues without generating a partial schedule", () => {
    const preview = createTournamentSetupPreview(
      completeSmallTournamentFixture.configuration,
      {
        ...completeSmallTournamentFixture.setup,
        teams: []
      },
      1
    );

    expect(preview.valid).toBe(false);
    expect(preview.matches).toEqual([]);
    expect(preview.digest).toBeNull();
    expect(preview.issues.map((issue) => issue.code)).toContain(
      "INVALID_SETUP_TEAM_COUNT"
    );
  });
});
