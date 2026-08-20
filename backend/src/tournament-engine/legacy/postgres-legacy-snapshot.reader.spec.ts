import { PostgresDatabase } from "../../database/postgres-database";
import { PostgresLegacySnapshotReader } from "./postgres-legacy-snapshot.reader";

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
    expect(sql).not.toMatch(/\bbox_score\b|\bscorecard\b|\bevents\b/i);
    expect(sql).not.toMatch(/\bbody\b|\bcontext\b|\breason\b/i);
    expect(sql).toContain("engine_match.metadata ->> 'compatibilityIdentity'");
  });
});

function result(rows: unknown[]) {
  return { rows };
}
