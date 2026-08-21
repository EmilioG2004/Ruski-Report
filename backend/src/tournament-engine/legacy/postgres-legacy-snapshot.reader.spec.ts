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
});

function result(rows: unknown[]) {
  return { rows };
}
