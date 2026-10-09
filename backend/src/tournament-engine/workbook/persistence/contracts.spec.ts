import {
  digestWorkbookParticipants,
  digestWorkbookValue,
  WorkbookRevisionCandidateTeamInput
} from "./contracts";

describe("workbook persistence digests", () => {
  it("canonicalizes object keys without changing array order", () => {
    expect(digestWorkbookValue({
      rows: [{ turn: 1 }, { turn: 2 }],
      schemaVersion: 1
    })).toBe(digestWorkbookValue({
      schemaVersion: 1,
      rows: [{ turn: 1 }, { turn: 2 }]
    }));
    expect(digestWorkbookValue({ rows: [1, 2] }))
      .not.toBe(digestWorkbookValue({ rows: [2, 1] }));
  });

  it("rejects non-JSON and non-finite values", () => {
    expect(() => digestWorkbookValue({ value: undefined })).toThrow(
      /undefined/i
    );
    expect(() => digestWorkbookValue({ value: Number.NaN })).toThrow(
      /finite/i
    );
  });

  it("freezes participant identity without mutable display names", () => {
    const teams: WorkbookRevisionCandidateTeamInput[] = [
      {
        sideNumber: 1,
        teamId: "team-1",
        displayName: "First Team",
        players: [
          {
            playerId: "player-1",
            rosterMembershipId: "membership-1",
            rosterSlot: 1,
            displayName: "First Player"
          }
        ]
      },
      {
        sideNumber: 2,
        teamId: "team-2",
        displayName: "Second Team",
        players: [
          {
            playerId: "player-2",
            rosterMembershipId: "membership-2",
            rosterSlot: 1,
            displayName: "Second Player"
          }
        ]
      }
    ];
    const renamed = teams.map((team) => ({
      ...team,
      displayName: `Renamed ${team.displayName}`,
      players: team.players.map((player) => ({
        ...player,
        displayName: `Renamed ${player.displayName}`
      }))
    }));

    expect(digestWorkbookParticipants(renamed))
      .toBe(digestWorkbookParticipants(teams));
    expect(digestWorkbookParticipants([...teams].reverse())).toBe(
      digestWorkbookValue([
        {
          sideNumber: 1,
          teamId: "team-1",
          playerId: "player-1",
          rosterMembershipId: "membership-1",
          rosterSlot: 1
        },
        {
          sideNumber: 2,
          teamId: "team-2",
          playerId: "player-2",
          rosterMembershipId: "membership-2",
          rosterSlot: 1
        }
      ])
    );
    expect(digestWorkbookParticipants([
      {
        ...teams[0],
        players: [{ ...teams[0].players[0], playerId: "replacement-player" }]
      },
      teams[1]
    ])).not.toBe(digestWorkbookParticipants(teams));
  });
});
