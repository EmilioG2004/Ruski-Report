import { PostgresDatabase } from "../../database";
import { MatchRecordRow } from "./postgres-tournament-record.mapper";

export async function readMatchRecords(
  database: PostgresDatabase,
  tournamentId: string,
  version: number
): Promise<MatchRecordRow[]> {
  const result = await database.query<MatchRecordRow>(
    `SELECT * FROM matches
     WHERE tournament_id = $1 AND snapshot_version = $2
     ORDER BY sequence`,
    [tournamentId, version]
  );
  return result.rows;
}
