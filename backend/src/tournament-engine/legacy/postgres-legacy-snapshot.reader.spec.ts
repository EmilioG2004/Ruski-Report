import { PostgresDatabase } from "../../database/postgres-database";
import {
  PostgresLegacySnapshotReader,
  resolveLegacyEventPlayer
} from "./postgres-legacy-snapshot.reader";

describe("PostgresLegacySnapshotReader", () => {
  it("reads normalized legacy state and identity references without private content", async () => {
    const queries: string[] = [];
    const database = {
      async query(text: string) {
        queries.push(text);
        if (text.includes("FROM active_tournament_snapshots")) {
          return result([
            {
              legacy_tournament_id: "legacy-tournament-2026",
              game_type: "ruski",
              year: 2026,
              name: "Synthetic Legacy Tournament",
              snapshot_version: 4,
              status: "completed",
              format: {
                type: "pod_and_bracket",
                podCount: 2,
                teamsPerPod: 2,
                bracketSize: 4
              },
              metadata: { fixture: true },
              bracket: null,
              published_at: "2026-06-22T00:00:00.000Z"
            }
          ]);
        }
        if (text.includes("FROM match_identities identity")) {
          return result([
            {
              match_id: "legacy-historical-match",
              comment_ids: ["comment-one"],
              report_ids: ["report-one"]
            }
          ]);
        }
        return result([]);
      }
    } as unknown as PostgresDatabase;

    const source = await new PostgresLegacySnapshotReader(database)
      .readActiveSnapshot("legacy-tournament-2026");

    expect(source).toMatchObject({
      legacyTournamentId: "legacy-tournament-2026",
      snapshotVersion: 4,
      matchIdentities: [
        {
          legacyMatchId: "legacy-historical-match",
          commentIds: ["comment-one"],
          reportIds: ["report-one"]
        }
      ]
    });
    const sql = queries.join("\n");
    expect(sql).toMatch(/\bbox_score\b.*\bscorecard\b.*\bevents\b/is);
    expect(sql).not.toMatch(/\bbody\b|\bcontext\b|\breason\b/i);
    expect(sql).toContain("engine_match.metadata ->> 'compatibilityIdentity'");
  });

  it.each([
    [
      "and Matian",
      "team-one",
      "player-dylan-and-matian",
      "stable_participant_key_alias"
    ],
    [
      "Wiggs",
      "team-wigs-boggs",
      "player-jack-wigmore",
      "legacy_2026_explicit_alias"
    ]
  ])("resolves the evidenced legacy shooter alias %s within its frozen team", (
    shooterName,
    legacyTeamId,
    expectedPlayerId,
    expectedMethod
  ) => {
    expect(resolveLegacyEventPlayer({
      legacyEventId: "legacy-event-one",
      type: "make",
      shooterName,
      legacyTeamId,
      participants: [
        {
          legacyTeamId,
          legacyPlayerIds: [
            "player-dylan-and-matian",
            "player-jack-wigmore"
          ]
        },
        {
          legacyTeamId: "team-two",
          legacyPlayerIds: ["player-charlie-boggs"]
        }
      ],
      scorecardRows: [
        {
          legacyScorecardRowId: "legacy-scorecard-row-one",
          sequence: 1,
          legacyTeamId,
          legacyEventIds: ["legacy-event-one"],
          values: { shooter: shooterName, make: true }
        }
      ]
    })).toEqual({
      playerId: expectedPlayerId,
      scorecardRowId: "legacy-scorecard-row-one",
      method: expectedMethod
    });
  });

  it.each(["Unknown Shooter", "Dyl", "Wig"])(
    "rejects unresolved or wrong-prefix legacy shooter alias %s",
    (shooterName) => {
      expect(() => resolveLegacyEventPlayer({
        legacyEventId: "legacy-event-one",
        type: "make",
        shooterName,
        legacyTeamId: "team-one",
        participants: [{
          legacyTeamId: "team-one",
          legacyPlayerIds: ["player-dylan-and-matian", "player-andrew"]
        }],
        scorecardRows: [
          {
            legacyScorecardRowId: "legacy-scorecard-row-one",
            sequence: 1,
            legacyTeamId: "team-one",
            legacyEventIds: ["legacy-event-one"],
            values: { shooter: shooterName, make: true }
          }
        ]
      })).toThrow("Legacy event player alias is ambiguous or unresolved.");
    }
  );

  it("requires matching scorecard chronology for a missing-player event", () => {
    expect(() => resolveLegacyEventPlayer({
      legacyEventId: "legacy-event-one",
      type: "make",
      shooterName: "and Matian",
      legacyTeamId: "team-one",
      participants: [{
        legacyTeamId: "team-one",
        legacyPlayerIds: ["player-dylan-and-matian"]
      }],
      scorecardRows: [{
        legacyScorecardRowId: "legacy-scorecard-row-one",
        sequence: 1,
        legacyTeamId: "team-one",
        legacyEventIds: ["legacy-event-one"],
        values: { shooter: "and Matian", miss: true }
      }]
    })).toThrow("Legacy event and scorecard chronology differ.");
  });

  it.each([
    ["box score", "Former Player", undefined],
    ["scorecard", undefined, "Former Player"]
  ])("adds a stable historical player from an exact %s label", async (
    _source,
    boxScoreLabel,
    scorecardLabel
  ) => {
    const source = await new PostgresLegacySnapshotReader(
      historicalPlayerDatabase({ boxScoreLabel, scorecardLabel })
    ).readActiveSnapshot("legacy-tournament-2026");

    expect(source?.players).toEqual([
      { legacyPlayerId: "player-current", displayName: "Current Player" },
      { legacyPlayerId: "player-former", displayName: "Former Player" }
    ]);
    expect(source?.rosterMemberships).toEqual([{
      legacyTeamId: "team-current",
      legacyPlayerId: "player-current",
      sequence: 1
    }]);
    expect(source?.matches[0]).toMatchObject({
      participants: [
        { legacyPlayerIds: ["player-former"] },
        { legacyPlayerIds: ["player-current"] }
      ],
      events: [{ legacyPlayerId: "player-former" }],
      statistics: [{ legacyPlayerId: "player-former" }]
    });
    expect(source?.tournamentStatistics[0]?.rows[0]).toMatchObject({
      legacyPlayerId: "player-former"
    });
  });

  it("rejects a referenced historical player without public label evidence", async () => {
    await expect(new PostgresLegacySnapshotReader(
      historicalPlayerDatabase({})
    ).readActiveSnapshot("legacy-tournament-2026")).rejects.toThrow(
      "Legacy historical player lacks an exact public display label."
    );
  });

  it("prefers the stable-ID box-score label over a scorecard alias", async () => {
    const source = await new PostgresLegacySnapshotReader(
      historicalPlayerDatabase({
        boxScoreLabel: "Former Player",
        scorecardLabel: "Former"
      })
    ).readActiveSnapshot("legacy-tournament-2026");

    expect(source?.players).toContainEqual({
      legacyPlayerId: "player-former",
      displayName: "Former Player"
    });
  });

  it("rejects conflicting exact box-score labels for one historical player ID", async () => {
    await expect(new PostgresLegacySnapshotReader(
      historicalPlayerDatabase({
        boxScoreLabels: ["Former Player", "former player"]
      })
    ).readActiveSnapshot("legacy-tournament-2026")).rejects.toThrow(
      "Legacy historical player has conflicting public display labels."
    );
  });
});

function historicalPlayerDatabase(labels: {
  boxScoreLabel?: string;
  boxScoreLabels?: readonly string[];
  scorecardLabel?: string;
}): PostgresDatabase {
  return {
    async query(text: string) {
      if (text.includes("FROM active_tournament_snapshots")) {
        return result([{
          legacy_tournament_id: "legacy-tournament-2026",
          game_type: "ruski",
          year: 2026,
          name: "Synthetic Legacy Tournament",
          snapshot_version: 4,
          status: "completed",
          format: {},
          metadata: {},
          bracket: null,
          statistics: [{
            id: "player-season",
            scope: "season",
            subjectType: "player",
            rows: [{
              rank: 1,
              subject: { playerId: "player-former" },
              values: { makes: 1 }
            }]
          }],
          published_at: "2026-06-22T00:00:00.000Z"
        }]);
      }
      if (text.includes("FROM players")) {
        return result([{
          player_id: "player-current",
          display_name: "Current Player"
        }]);
      }
      if (text.includes("FROM team_players")) {
        return result([{
          team_id: "team-current",
          player_id: "player-current",
          sequence: 1
        }]);
      }
      if (/FROM matches\s/u.test(text)) {
        const scorecardRows = labels.scorecardLabel === undefined ? [] : [{
          id: "scorecard-former",
          sequence: 1,
          teamId: "team-former",
          playerId: "player-former",
          eventIds: ["event-former"],
          values: { shooter: labels.scorecardLabel, make: true }
        }];
        return result([{
          match_id: "match-historical",
          sequence: 1,
          status: "final",
          pod_id: "pod-one",
          bracket_match_id: null,
          participants: [
            { teamId: "team-former", playerIds: ["player-former"] },
            { teamId: "team-current", playerIds: ["player-current"] }
          ],
          score: { participants: [], isFinal: true },
          metadata: {},
          box_score: {
            rows: (labels.boxScoreLabels ?? [labels.boxScoreLabel])
              .map((label) => ({
                subject: {
                  type: "player",
                  playerId: "player-former",
                  teamId: "team-former",
                  label
                },
                stats: { makes: 1 }
              }))
          },
          scorecard: { rows: scorecardRows },
          events: [{
            id: "event-former",
            sequence: 1,
            type: "make",
            teamId: "team-former",
            playerId: "player-former",
            metadata: labels.scorecardLabel === undefined
              ? {}
              : { shooterName: labels.scorecardLabel }
          }],
          updated_at: "2026-06-21T00:00:00.000Z"
        }]);
      }
      return result([]);
    }
  } as unknown as PostgresDatabase;
}

function result(rows: unknown[]) {
  return { rows };
}
