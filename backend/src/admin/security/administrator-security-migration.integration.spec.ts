import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PoolClient } from "pg";

import { loadDatabaseConfig } from "../../config/database.config";
import { PostgresDatabase } from "../../database";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("administrator identity migration rehearsal", () => {
  let database: PostgresDatabase;

  beforeAll(() => {
    database = new PostgresDatabase(loadDatabaseConfig({
      DATABASE_URL: databaseUrl
    }));
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("upgrades 0007 without rewriting rows and hardens published roster history", async () => {
    const client = await database.connect();
    const schema = `security_rehearsal_${randomUUID().replaceAll("-", "")}`;
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}`);
      await applyMigrations(client, 1, 7);
      const fixture = await seedRosterFixture(client);
      const before = await digestPreservedRows(client);

      await client.query(await readFile(
        join(process.cwd(), "migrations/0008_administrator_identity.sql"),
        "utf8"
      ));

      expect(await digestPreservedRows(client)).toEqual(before);
      await expectDatabaseRejection(client, () => client.query(
        "UPDATE engine_players SET display_name = 'Rewritten' WHERE id = $1",
        [fixture.publishedPlayerId]
      ), "immutable");
      await expectDatabaseRejection(client, () => client.query(
        "DELETE FROM engine_players WHERE id = $1",
        [fixture.publishedPlayerId]
      ), "immutable");
      await expectDatabaseRejection(client, () => client.query(
        "DELETE FROM engine_roster_memberships WHERE id = $1",
        [fixture.publishedMembershipId]
      ), "cannot be deleted");
      await expectDatabaseRejection(client, () => client.query(
        `
          UPDATE engine_roster_memberships
          SET roster_slot = 2
          WHERE id = $1
        `,
        [fixture.publishedMembershipId]
      ), "only transition once");

      const replacementPlayerId = randomUUID();
      const replacementMembershipId = randomUUID();
      await client.query(
        `
          INSERT INTO engine_players (
            id, tournament_id, public_key, display_name
          ) VALUES (
            $1::uuid, $2::uuid, ($1::uuid)::text, 'Replacement Player'
          )
        `,
        [replacementPlayerId, fixture.publishedTournamentId]
      );
      await expectDatabaseRejection(client, () => client.query(
        `
          INSERT INTO engine_roster_memberships (
            id, tournament_id, public_key, team_id, player_id,
            roster_slot, opened_at, opened_by
          ) VALUES (
            $1::uuid, $2::uuid, ($1::uuid)::text, $3::uuid, $4::uuid,
            2, now(), 'administrator-id'
          )
        `,
        [
          randomUUID(),
          fixture.publishedTournamentId,
          fixture.publishedTeamId,
          replacementPlayerId
        ]
      ), "exceeds the copied configuration");
      await expectDatabaseRejection(client, () => client.query(
        `
          INSERT INTO engine_roster_memberships (
            id, tournament_id, public_key, team_id, player_id,
            roster_slot, opened_at, opened_by
          ) VALUES (
            $1::uuid, $2::uuid, ($1::uuid)::text, $3::uuid, $4::uuid,
            1, now(), 'administrator-id'
          )
        `,
        [
          randomUUID(),
          fixture.publishedTournamentId,
          fixture.publishedTeamId,
          replacementPlayerId
        ]
      ), "requires closed prior membership history");
      await client.query(
        `
          UPDATE engine_roster_memberships
          SET closed_at = now(), closed_by = 'administrator-id',
              replacement_reason = 'Availability change'
          WHERE id = $1
        `,
        [fixture.publishedMembershipId]
      );
      await client.query(
        `
          INSERT INTO engine_roster_memberships (
            id, tournament_id, public_key, team_id, player_id,
            roster_slot, opened_at, opened_by
          ) VALUES (
            $1::uuid, $2::uuid, ($1::uuid)::text, $3::uuid, $4::uuid,
            1, now(), 'administrator-id'
          )
        `,
        [
          replacementMembershipId,
          fixture.publishedTournamentId,
          fixture.publishedTeamId,
          replacementPlayerId
        ]
      );
      await expectDatabaseRejection(client, () => client.query(
        `
          UPDATE engine_roster_memberships
          SET closed_at = NULL, closed_by = NULL, replacement_reason = NULL
          WHERE id = $1
        `,
        [fixture.publishedMembershipId]
      ), "only transition once");

      await client.query(
        "DELETE FROM engine_roster_memberships WHERE id = $1",
        [fixture.draftMembershipId]
      );
      await client.query(
        "DELETE FROM engine_players WHERE id = $1",
        [fixture.draftPlayerId]
      );
      await client.query(
        `
          INSERT INTO engine_players (
            id, tournament_id, public_key, display_name
          ) VALUES ($1::uuid, $2::uuid, ($1::uuid)::text, 'Draft Edit')
        `,
        [fixture.draftPlayerId, fixture.draftTournamentId]
      );
      await client.query(
        `
          INSERT INTO engine_roster_memberships (
            id, tournament_id, public_key, team_id, player_id,
            roster_slot, opened_at, opened_by, metadata
          ) VALUES (
            $1::uuid, $2::uuid, ($1::uuid)::text, $3::uuid, $4::uuid,
            1, now(), 'draft-editor',
            '{"draftEdit":true}'::jsonb
          )
        `,
        [
          fixture.draftMembershipId,
          fixture.draftTournamentId,
          fixture.draftTeamId,
          fixture.draftPlayerId
        ]
      );
      const draft = await client.query<{ display_name: string; metadata: object }>(
        `
          SELECT player.display_name, membership.metadata
          FROM engine_players player
          JOIN engine_roster_memberships membership
            ON membership.player_id = player.id
          WHERE player.id = $1
        `,
        [fixture.draftPlayerId]
      );
      expect(draft.rows[0]).toEqual({
        display_name: "Draft Edit",
        metadata: { draftEdit: true }
      });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

async function applyMigrations(
  client: PoolClient,
  first: number,
  last: number
): Promise<void> {
  const filenames = [
    "0001_initial_persistence.sql",
    "0002_account_authentication.sql",
    "0003_account_deletion.sql",
    "0004_comment_moderation.sql",
    "0005_comment_reporting.sql",
    "0006_user_blocking.sql",
    "0007_tournament_engine.sql"
  ];
  for (const filename of filenames.slice(first - 1, last)) {
    await client.query(await readFile(join(process.cwd(), "migrations", filename), "utf8"));
  }
}

async function seedRosterFixture(client: PoolClient): Promise<{
  publishedTournamentId: string;
  publishedTeamId: string;
  publishedPlayerId: string;
  publishedMembershipId: string;
  draftTournamentId: string;
  draftTeamId: string;
  draftPlayerId: string;
  draftMembershipId: string;
}> {
  const publishedTournamentId = randomUUID();
  const publishedTeamId = randomUUID();
  const publishedPlayerId = randomUUID();
  const publishedMembershipId = randomUUID();
  const draftTournamentId = randomUUID();
  const draftTeamId = randomUUID();
  const draftPlayerId = randomUUID();
  const draftMembershipId = randomUUID();
  await client.query(
    `
      INSERT INTO tournaments (id, game_type, year, name)
      VALUES ('security-published', 'ruski', 2031, 'Published Fixture'),
             ('security-draft', 'ruski', 2032, 'Draft Fixture')
    `
  );
  await client.query(
    `
      INSERT INTO engine_tournaments (
        id, public_key, game_type, year, name, lifecycle, visibility,
        setup_published_at
      ) VALUES
        ($1, 'security-published', 'ruski', 2031, 'Published Fixture',
         'draft_setup', 'private', NULL),
        ($2, 'security-draft', 'ruski', 2032, 'Draft Fixture',
         'draft_setup', 'private', NULL)
    `,
    [publishedTournamentId, draftTournamentId]
  );
  await client.query(
    `
      INSERT INTO engine_tournament_configurations (
        tournament_id, format_version, format_type, team_count,
        pod_count, pod_sizes, players_per_team, games_per_pair,
        qualifiers_per_pod, bracket_size, allow_byes, standings_rules
      ) VALUES
        ($1, 1, 'pod_and_single_elimination', 1, 1,
         ARRAY[1]::smallint[], 1, 1, 1, 2, true,
         ARRAY['record', 'cupDifferential', 'teamShootingPercentage',
               'administratorResolution']::text[]),
        ($2, 1, 'pod_and_single_elimination', 1, 1,
         ARRAY[1]::smallint[], 1, 1, 1, 2, true,
         ARRAY['record', 'cupDifferential', 'teamShootingPercentage',
               'administratorResolution']::text[])
    `,
    [publishedTournamentId, draftTournamentId]
  );
  await client.query(
    `
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES
        ($1::uuid, $2::uuid, ($1::uuid)::text,
         'Published Team', 'published team', 1),
        ($3::uuid, $4::uuid, ($3::uuid)::text,
         'Draft Team', 'draft team', 1)
    `,
    [publishedTeamId, publishedTournamentId, draftTeamId, draftTournamentId]
  );
  await client.query(
    `
      INSERT INTO engine_players (
        id, tournament_id, public_key, display_name
      ) VALUES
        ($1::uuid, $2::uuid, ($1::uuid)::text, 'Published Player'),
        ($3::uuid, $4::uuid, ($3::uuid)::text, 'Draft Player')
    `,
    [publishedPlayerId, publishedTournamentId, draftPlayerId, draftTournamentId]
  );
  await client.query(
    `
      INSERT INTO engine_roster_memberships (
        id, tournament_id, public_key, team_id, player_id,
        roster_slot, opened_at, opened_by
      ) VALUES
        ($1::uuid, $2::uuid, ($1::uuid)::text, $3::uuid, $4::uuid,
         1, now() - interval '1 day', 'fixture'),
        ($5::uuid, $6::uuid, ($5::uuid)::text, $7::uuid, $8::uuid,
         1, now() - interval '1 day', 'fixture')
    `,
    [
      publishedMembershipId, publishedTournamentId,
      publishedTeamId, publishedPlayerId,
      draftMembershipId, draftTournamentId, draftTeamId, draftPlayerId
    ]
  );
  await client.query(
    `
      UPDATE engine_tournaments
      SET lifecycle = 'setup_published', setup_published_at = now()
      WHERE id = $1
    `,
    [publishedTournamentId]
  );
  return {
    publishedTournamentId,
    publishedTeamId,
    publishedPlayerId,
    publishedMembershipId,
    draftTournamentId,
    draftTeamId,
    draftPlayerId,
    draftMembershipId
  };
}

async function digestPreservedRows(client: PoolClient): Promise<unknown> {
  const result = await client.query<{ digest: unknown }>(
    `
      SELECT jsonb_build_object(
        'legacy', (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
                   FROM tournaments row),
        'tournaments', (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
                        FROM engine_tournaments row),
        'configurations', (SELECT jsonb_agg(to_jsonb(row)
                                           ORDER BY row.tournament_id)
                           FROM engine_tournament_configurations row),
        'teams', (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
                  FROM engine_teams row),
        'players', (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
                    FROM engine_players row),
        'rosters', (SELECT jsonb_agg(to_jsonb(row) ORDER BY row.id)
                    FROM engine_roster_memberships row)
      ) AS digest
    `
  );
  return result.rows[0]?.digest;
}

async function expectDatabaseRejection(
  client: PoolClient,
  operation: () => Promise<unknown>,
  message: string
): Promise<void> {
  await client.query("SAVEPOINT trigger_check");
  try {
    await expect(operation()).rejects.toThrow(message);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT trigger_check");
    await client.query("RELEASE SAVEPOINT trigger_check");
  }
}
