import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner, PostgresDatabase } from "../../database";
import {
  copyTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION
} from "../configuration";
import { parseStableUuid, StableUuidKind } from "../domain";
import { createTournamentSetupPreview } from "../setup";
import { EngineAuditCommand } from "./contracts";
import { PostgresProjectionRepository } from "./postgres-projection.repository";
import { PostgresRosterRepository } from "./postgres-roster.repository";
import { PostgresTournamentSetupRepository } from "./postgres-tournament-setup.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = testDatabaseUrl === undefined ? describe.skip : describe;

postgresDescribe("canonical public projection PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let projections: PostgresProjectionRepository;
  let setup: PostgresTournamentSetupRepository;
  let rosters: PostgresRosterRepository;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    projections = new PostgresProjectionRepository(database);
    setup = new PostgresTournamentSetupRepository(database);
    rosters = new PostgresRosterRepository(database);
  });

  beforeEach(async () => {
    await clearFixture(database);
  });

  afterEach(async () => {
    await clearFixture(database);
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  async function clearFixture(database: PostgresDatabase) {
    await database.query("TRUNCATE engine_tournaments CASCADE");
    await database.query(
      "DELETE FROM match_identities WHERE tournament_id = 'projection-2027'"
    );
    await database.query("DELETE FROM tournaments WHERE id = 'projection-2027'");
  }

  it("builds and activates a zero-game projection without bumping row version", async () => {
    const fixture = await createPublishedFixture();
    const result = await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 2,
      createdAt: "2027-02-01T00:00:00.000Z",
      activatedAt: "2027-02-01T00:00:01.000Z",
      audit: audit(101, "canonical_projection_activated")
    });

    expect(result).toMatchObject({
      publicTournamentId: "projection-2027",
      projectionVersion: 1,
      rowVersion: 2,
      changedMatchIds: expect.arrayContaining([
        fixture.matchPublicKeys[0], fixture.matchPublicKeys[1]
      ])
    });
    const stored = await database.query<{
      row_version: string;
      match_count: number;
      source: string;
      status: string;
    }>(`
      SELECT tournament.row_version::text, payload.match_count,
             payload.tournament_detail -> 'matches' -> 0 ->> 'status' AS status,
             projection.metadata ->> 'source' AS source
      FROM engine_tournaments tournament
      JOIN engine_active_projection_versions active
        ON active.tournament_id = tournament.id
      JOIN engine_projection_versions projection
        ON projection.tournament_id = active.tournament_id
       AND projection.version = active.projection_version
      JOIN engine_public_tournament_projection_payloads payload
        ON payload.tournament_id = active.tournament_id
       AND payload.projection_version = active.projection_version
      WHERE tournament.id = $1::uuid
    `, [fixture.tournamentId]);
    expect(stored.rows[0]).toEqual({
      row_version: "2",
      match_count: 2,
      status: "scheduled",
      source: "canonical"
    });
  });

  it("projects pod final and forfeit winners from active revision teams", async () => {
    const fixture = await createPublishedFixture();
    await seedResolvedMatch(database, fixture, 0, "final", 1200);
    await seedResolvedMatch(database, fixture, 1, "forfeited", 1210);
    await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 2,
      createdAt: "2027-02-01T02:00:00.000Z",
      activatedAt: "2027-02-01T02:00:01.000Z",
      audit: audit(115, "canonical_projection_activated")
    });

    const payloads = await database.query<{
      match_public_key: string;
      status: string;
      winner_id: string;
      scores: Array<number | null>;
      player_count: number;
    }>(`
      SELECT match_public_key, detail_payload ->> 'status' AS status,
             detail_payload -> 'winner' ->> 'id' AS winner_id,
             ARRAY(SELECT (participant ->> 'score')::integer
               FROM jsonb_array_elements(detail_payload -> 'participants') participant
               ORDER BY (participant ->> 'side')::integer) AS scores,
             (SELECT count(*)::integer
              FROM jsonb_array_elements(detail_payload -> 'participants') participant,
                   jsonb_array_elements(participant -> 'players')) AS player_count
      FROM engine_public_match_projection_payloads
      WHERE tournament_id = $1::uuid AND projection_version = 1
      ORDER BY match_public_key
    `, [fixture.tournamentId]);
    expect(payloads.rows.map((row) => ({
      status: row.status,
      winnerId: row.winner_id,
      scores: row.scores,
      playerCount: row.player_count
    }))).toEqual(expect.arrayContaining([{
      status: "final",
      winnerId: expect.stringMatching(/^team-/),
      scores: [1, 0],
      playerCount: 4
    }, {
      status: "forfeited",
      winnerId: expect.stringMatching(/^team-/),
      scores: [null, null],
      playerCount: 4
    }]));
  });

  it("pins old payloads and refreshes scheduled matches with the current roster", async () => {
    const fixture = await createPublishedFixture();
    await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 2,
      createdAt: "2027-02-02T00:00:00.000Z",
      activatedAt: "2027-02-02T00:00:01.000Z",
      audit: audit(102, "canonical_projection_activated")
    });
    await rosters.replacePlayer({
      tournamentId: fixture.tournamentId,
      teamId: fixture.teamIds[0],
      expectedTournamentRowVersion: 2,
      replacedMembershipId: fixture.membershipIds[0],
      replacement: {
        id: stable(1090, "tournament_player"),
        publicKey: "player-replacement",
        displayName: "Replacement Player",
        membershipId: stable(1091, "roster_membership"),
        membershipPublicKey: "membership-replacement",
        rosterSlot: 1
      },
      effectiveAt: "2027-02-02T01:00:00.000Z",
      reason: "Sanitized replacement",
      actorId: "administrator-1",
      audit: audit(103, "roster_player_replaced")
    });
    const second = await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 3,
      createdAt: "2027-02-02T02:00:00.000Z",
      activatedAt: "2027-02-02T02:00:01.000Z",
      audit: audit(104, "canonical_projection_activated")
    });

    expect(second.rowVersion).toBe(3);
    expect(second.changedMatchIds).toContain(fixture.matchPublicKeys[0]);
    const versions = await database.query<{
      projection_version: string;
      players: string[];
    }>(`
      SELECT projection_version::text,
             ARRAY(
               SELECT player ->> 'id'
               FROM jsonb_array_elements(detail_payload -> 'participants') participant,
                    jsonb_array_elements(participant -> 'players') player
               ORDER BY player ->> 'id'
             ) AS players
      FROM engine_public_match_projection_payloads
      WHERE tournament_id = $1::uuid AND match_public_key = $2
      ORDER BY projection_version
    `, [fixture.tournamentId, fixture.matchPublicKeys[0]]);
    expect(versions.rows[0]?.players).toContain("player-1");
    expect(versions.rows[1]?.players).toContain("player-replacement");
  });

  it("reactivates an immutable old version as an audited rollback", async () => {
    const fixture = await createPublishedFixture();
    await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 2,
      createdAt: "2027-02-03T00:00:00.000Z",
      activatedAt: "2027-02-03T00:00:01.000Z",
      audit: audit(105, "canonical_projection_activated")
    });
    await rosters.replacePlayer({
      tournamentId: fixture.tournamentId,
      teamId: fixture.teamIds[0],
      expectedTournamentRowVersion: 2,
      replacedMembershipId: fixture.membershipIds[0],
      replacement: {
        id: stable(1092, "tournament_player"),
        publicKey: "rollback-replacement",
        displayName: "Rollback Replacement",
        membershipId: stable(1093, "roster_membership"),
        membershipPublicKey: "rollback-membership",
        rosterSlot: 1
      },
      effectiveAt: "2027-02-03T00:30:00.000Z",
      reason: "Create a distinct projection source",
      actorId: "administrator-1",
      audit: audit(110, "roster_player_replaced")
    });
    await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 3,
      createdAt: "2027-02-03T01:00:00.000Z",
      activatedAt: "2027-02-03T01:00:01.000Z",
      audit: audit(106, "canonical_projection_activated")
    });
    await projections.reactivateCanonical({
      tournamentId: fixture.tournamentId,
      version: 1,
      expectedTournamentRowVersion: 3,
      activatedAt: "2027-02-03T02:00:00.000Z",
      reason: "Restore prior qualified projection",
      audit: audit(107, "canonical_projection_rolled_back")
    });

    const active = await database.query<{
      projection_version: string;
      action: string;
      reason: string;
      payload_count: string;
    }>(`
      SELECT active.projection_version::text, activation.action,
             activation.reason,
             (SELECT count(*)::text
              FROM engine_public_tournament_projection_payloads payload
              WHERE payload.tournament_id = active.tournament_id) AS payload_count
      FROM engine_active_projection_versions active
      JOIN engine_public_projection_activations activation
        ON activation.tournament_id = active.tournament_id
       AND activation.projection_version = active.projection_version
       AND activation.action = 'rollback'
      WHERE active.tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(active.rows[0]).toEqual({
      projection_version: "1",
      action: "rollback",
      reason: "Restore prior qualified projection",
      payload_count: "2"
    });
  });

  it("rejects partial activation and late inserts while preserving the old pointer", async () => {
    const fixture = await createPublishedFixture();
    await projections.buildAndActivateCanonical({
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: 2,
      createdAt: "2027-02-04T00:00:00.000Z",
      activatedAt: "2027-02-04T00:00:01.000Z",
      audit: audit(108, "canonical_projection_activated")
    });
    await expect(database.query(`
      INSERT INTO engine_public_tournament_projection_payloads
      SELECT * FROM engine_public_tournament_projection_payloads
      WHERE tournament_id = $1::uuid AND projection_version = 1
    `, [fixture.tournamentId])).rejects.toThrow(/only while building/i);
    await expect(database.query(`
      UPDATE engine_projection_versions SET source_digest = $2
      WHERE tournament_id = $1::uuid AND version = 1
    `, [fixture.tournamentId, "d".repeat(64)]))
      .rejects.toThrow(/source headers are immutable/i);
    await expect(database.query(`
      UPDATE engine_active_projection_versions
      SET activated_at = activated_at + interval '1 second'
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId])).rejects.toThrow(/active public projection/i);

    await database.query(`
      INSERT INTO engine_projection_versions (
        tournament_id, version, status, payload_schema_version,
        source_digest, source_tournament_row_version, source_pointers,
        created_at, metadata
      ) VALUES ($1::uuid, 2, 'building', 2, $2, 2, '{}'::jsonb, $3, '{}'::jsonb)
    `, [fixture.tournamentId, "f".repeat(64), "2027-02-04T01:00:00.000Z"]);
    await database.query(`
      INSERT INTO engine_public_tournament_projection_payloads (
        tournament_id, projection_version, tournament_public_key,
        visibility, lifecycle, year, tournament_summary, tournament_detail,
        tournament_summary_digest, tournament_detail_digest, match_count,
        source_tournament_row_version, source_pointers, created_at
      ) VALUES (
        $1::uuid, 2, 'projection-2027', 'public', 'setup_published', 2027,
        '{}'::jsonb, '{}'::jsonb, $2, $2, 1, 2, '{}'::jsonb, $3
      )
    `, [fixture.tournamentId, "e".repeat(64), "2027-02-04T01:00:00.000Z"]);
    await database.query(`
      UPDATE engine_projection_versions SET status = 'ready', ready_at = $2
      WHERE tournament_id = $1::uuid AND version = 2
    `, [fixture.tournamentId, "2027-02-04T01:00:01.000Z"]);

    await expect(projections.activate({
      tournamentId: fixture.tournamentId,
      version: 2,
      expectedTournamentRowVersion: 2,
      activatedAt: "2027-02-04T01:00:02.000Z",
      audit: audit(109, "partial_projection_activation_rejected")
    })).rejects.toThrow(/active public projection/i);
    expect(await activeVersion(database, fixture.tournamentId)).toBe("1");
  });

  it("serializes concurrent builds and rejects the unchanged loser", async () => {
    const fixture = await createPublishedFixture();
    const outcomes = await Promise.allSettled([
      projections.buildAndActivateCanonical({
        tournamentId: fixture.tournamentId,
        expectedTournamentRowVersion: 2,
        createdAt: "2027-02-05T00:00:00.000Z",
        activatedAt: "2027-02-05T00:00:01.000Z",
        audit: audit(111, "canonical_projection_activated")
      }),
      projections.buildAndActivateCanonical({
        tournamentId: fixture.tournamentId,
        expectedTournamentRowVersion: 2,
        createdAt: "2027-02-05T00:00:02.000Z",
        activatedAt: "2027-02-05T00:00:03.000Z",
        audit: audit(112, "canonical_projection_activated")
      })
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: expect.stringMatching(/already active|could not serialize/i)
      })
    });
    expect(await activeVersion(database, fixture.tournamentId)).toBe("1");
    expect(await database.query<{ count: string }>(`
      SELECT count(*)::text AS count FROM engine_projection_versions
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId])).toMatchObject({ rows: [{ count: "1" }] });
  });

  it("publishes setup with v2 active before notifying and rolls back on build failure", async () => {
    const fixture = createFixture();
    let notification: unknown;
    const integratedSetup = new PostgresTournamentSetupRepository(
      database,
      undefined,
      projections,
      (result) => { notification = result; }
    );
    await integratedSetup.createDraft(fixture.input);
    await integratedSetup.publishSetup({
      tournamentId: fixture.tournamentId,
      expectedRowVersion: 1,
      expectedPreviewDigest: fixture.previewDigest,
      visibility: "public",
      publishedAt: "2027-02-06T00:00:00.000Z",
      audit: audit(113, "tournament_setup_published")
    });
    expect(notification).toMatchObject({
      publicTournamentId: "projection-2027",
      projectionVersion: 1
    });
    expect(await activeVersion(database, fixture.tournamentId)).toBe("1");

    await clearFixture(database);
    const failing = createFixture();
    await integratedSetup.createDraft(failing.input);
    await database.query(`
      INSERT INTO engine_projection_versions (
        tournament_id, version, status, payload_schema_version,
        source_digest, created_at, ready_at, activated_at, metadata
      ) VALUES ($1::uuid, 9, 'active', 1, $2, $3, $3, $3, '{}'::jsonb)
    `, [failing.tournamentId, "c".repeat(64), "2027-02-06T01:00:00.000Z"]);
    await database.query(`
      INSERT INTO engine_active_projection_versions (
        tournament_id, projection_version, activated_at
      ) VALUES ($1::uuid, 9, $2)
    `, [failing.tournamentId, "2027-02-06T01:00:00.000Z"]);
    await database.query(`
      CREATE FUNCTION test_fail_public_projection_build()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'injected public projection build failure'; END;
      $$
    `);
    await database.query(`
      CREATE TRIGGER test_fail_public_projection_build
      BEFORE INSERT ON engine_public_tournament_projection_payloads
      FOR EACH ROW EXECUTE FUNCTION test_fail_public_projection_build()
    `);
    try {
      await expect(integratedSetup.publishSetup({
        tournamentId: failing.tournamentId,
        expectedRowVersion: 1,
        expectedPreviewDigest: failing.previewDigest,
        visibility: "public",
        publishedAt: "2027-02-06T02:00:00.000Z",
        audit: audit(114, "tournament_setup_published")
      })).rejects.toThrow("injected public projection build failure");
    } finally {
      await database.query(`
        DROP TRIGGER test_fail_public_projection_build
          ON engine_public_tournament_projection_payloads
      `);
      await database.query("DROP FUNCTION test_fail_public_projection_build()")
    }
    expect(await activeVersion(database, failing.tournamentId)).toBe("9");
    expect(await database.query<{ lifecycle: string; matches: string }>(`
      SELECT tournament.lifecycle, count(match.id)::text AS matches
      FROM engine_tournaments tournament
      LEFT JOIN engine_matches match ON match.tournament_id = tournament.id
      WHERE tournament.id = $1::uuid GROUP BY tournament.id
    `, [failing.tournamentId])).toMatchObject({
      rows: [{ lifecycle: "draft_setup", matches: "0" }]
    });
  });

  async function createPublishedFixture() {
    const fixture = createFixture();
    await setup.createDraft(fixture.input);
    await setup.publishSetup({
      tournamentId: fixture.tournamentId,
      expectedRowVersion: 1,
      expectedPreviewDigest: fixture.previewDigest,
      visibility: "public",
      publishedAt: "2027-01-02T00:00:00.000Z",
      audit: audit(100, "tournament_setup_published")
    });
    return fixture;
  }
});

async function activeVersion(database: PostgresDatabase, tournamentId: string) {
  return (await database.query<{ projection_version: string }>(`
    SELECT projection_version::text FROM engine_active_projection_versions
    WHERE tournament_id = $1::uuid
  `, [tournamentId])).rows[0]?.projection_version;
}

function createFixture() {
  const tournamentId = stable(1001, "tournament");
  const podIds = [stable(1010, "pod"), stable(1011, "pod")] as const;
  const teamIds = [1020, 1021, 1022, 1023].map((id) =>
    stable(id, "tournament_team")
  );
  const playerIds = Array.from({ length: 8 }, (_, index) =>
    stable(1030 + index, "tournament_player")
  );
  const membershipIds = Array.from({ length: 8 }, (_, index) =>
    stable(1050 + index, "roster_membership")
  );
  const configuration = copyTournamentConfiguration({
    formatVersion: TOURNAMENT_FORMAT_VERSION,
    formatType: POD_AND_SINGLE_ELIMINATION_FORMAT,
    teamCount: 4,
    podCount: 2,
    podSizes: [2, 2],
    playersPerTeam: 2,
    gamesPerPair: 1,
    qualifiersPerPod: 1,
    bracketSize: 2,
    allowByes: false,
    standingsRules: OFFICIAL_STANDINGS_RULES
  });
  const pods = podIds.map((id, index) => ({
    id,
    publicKey: `pod-${index + 1}`,
    name: `Pod ${index + 1}`,
    normalizedName: `pod ${index + 1}`,
    sequence: index + 1
  }));
  const teams = teamIds.map((id, index) => ({
    id,
    publicKey: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    normalizedName: `team ${index + 1}`,
    sequence: index + 1,
    podId: podIds[Math.floor(index / 2)] as typeof podIds[number],
    initialSeed: index % 2 + 1,
    players: [0, 1].map((offset) => {
      const playerIndex = index * 2 + offset;
      return {
        id: playerIds[playerIndex],
        publicKey: `player-${playerIndex + 1}`,
        displayName: `Player ${playerIndex + 1}`,
        membershipId: membershipIds[playerIndex],
        membershipPublicKey: `membership-${playerIndex + 1}`,
        rosterSlot: offset + 1
      };
    })
  }));
  const input = {
    tournament: {
      id: tournamentId,
      publicKey: "projection-2027",
      gameType: "ruski",
      year: 2027,
      name: "Projection Tournament",
      visibility: "public" as const
    },
    configuration,
    pods,
    teams,
    createdAt: "2027-01-01T00:00:00.000Z",
    audit: audit(99, "tournament_draft_created")
  };
  const setup = {
    tournamentId,
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      playerIds: team.players.map((player) => player.id)
    })),
    pods: pods.map((pod) => ({
      id: pod.id,
      name: pod.name,
      sequence: pod.sequence,
      teamAssignments: teams.filter((team) => team.podId === pod.id)
        .map((team) => ({ teamId: team.id, initialSeed: team.initialSeed }))
    }))
  };
  const preview = createTournamentSetupPreview(configuration, setup, 1);
  const previewDigest = preview.digest;
  if (previewDigest === null) throw new Error("Projection fixture is invalid.");
  return {
    input,
    tournamentId,
    teamIds,
    membershipIds,
    previewDigest,
    matchPublicKeys: preview.matches.map((match) => match.id),
    matches: preview.matches
  };
}

async function seedResolvedMatch(
  database: PostgresDatabase,
  fixture: ReturnType<typeof createFixture>,
  matchIndex: number,
  status: "final" | "forfeited",
  idBase: number
): Promise<void> {
  const match = fixture.matches[matchIndex];
  if (match === undefined) throw new Error("Resolved match fixture is missing.");
  const revisionId = stable(idBase, "match_revision");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
    INSERT INTO engine_match_revisions (
      id, tournament_id, match_id, public_key, revision_number,
      status, score_availability, reason, source_adapter, actor_id,
      created_at, metadata
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, $4, 1, $5, $6,
      'operator_resolution', 'operator_correction', 'administrator-1', $7,
      '{}'::jsonb
    )
  `, [
    revisionId,
    fixture.tournamentId,
    match.id,
    `revision-${idBase}`,
    status,
    status === "final" ? "complete" : "not_applicable",
    "2027-01-03T00:00:00.000Z"
  ]);
    for (const [sideIndex, teamId] of match.participantTeamIds.entries()) {
      const team = fixture.input.teams.find((item) => item.id === teamId);
      if (team === undefined) throw new Error("Resolved match team is missing.");
      const side = sideIndex + 1;
      await client.query(`
      INSERT INTO engine_match_revision_teams (
        tournament_id, revision_id, side_number, team_id, score,
        result, display_name_at_revision, metadata
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7, '{}'::jsonb)
    `, [
      fixture.tournamentId,
      revisionId,
      side,
      team.id,
      status === "final" ? side === 1 ? 1 : 0 : null,
      side === 1 ? "win" : status === "forfeited" ? "forfeited" : "loss",
      team.name
    ]);
      for (const player of team.players) {
        await client.query(`
        INSERT INTO engine_match_revision_players (
          tournament_id, revision_id, side_number, team_id, player_id,
          roster_membership_id, roster_slot, display_name_at_revision, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid,
          $6::uuid, $7, $8, '{}'::jsonb
        )
        `, [
          fixture.tournamentId,
          revisionId,
          side,
          team.id,
          player.id,
          player.membershipId,
          player.rosterSlot,
          player.displayName
        ]);
      }
    }
    if (status === "final") {
      for (const [sideIndex, teamId] of match.participantTeamIds.entries()) {
        const team = fixture.input.teams.find((item) => item.id === teamId);
        if (team === undefined) throw new Error("Scoring team is missing.");
        const eventId = stable(idBase + sideIndex + 1, "scoring_event");
        await client.query(`
          INSERT INTO engine_match_events (
            id, tournament_id, revision_id, sequence, event_type,
            team_id, player_id, created_at, metadata
          ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4, 'shot_attempt',
            $5::uuid, $6::uuid, $7, '{}'::jsonb
          )
        `, [
          eventId,
          fixture.tournamentId,
          revisionId,
          sideIndex + 1,
          team.id,
          team.players[0]?.id,
          "2027-01-03T00:00:00.000Z"
        ]);
        await client.query(`
          INSERT INTO engine_shot_attempts (
            event_id, outcome, cup_delta
          ) VALUES ($1::uuid, $2, $3)
        `, [eventId, sideIndex === 0 ? "make" : "miss", sideIndex === 0 ? 1 : 0]);
      }
    }
    await client.query(`
    UPDATE engine_matches
    SET active_revision_id = $3::uuid, status = $4,
        score_availability = $5, participants_frozen_at = $6,
        started_at = $6, ended_at = $6, row_version = row_version + 1,
        updated_at = $6
    WHERE tournament_id = $1::uuid AND id = $2::uuid
  `, [
    fixture.tournamentId,
    match.id,
    revisionId,
    status,
    status === "final" ? "complete" : "not_applicable",
    "2027-01-03T00:00:00.000Z"
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function audit(sequence: number, commandType: string): EngineAuditCommand {
  return {
    eventId: rawUuid(sequence),
    commandType,
    actor: { kind: "administrator", id: "administrator-1" },
    occurredAt: "2027-01-01T00:00:00.000Z"
  };
}

function stable<Kind extends StableUuidKind>(sequence: number, kind: Kind) {
  return parseStableUuid(rawUuid(sequence), kind);
}

function rawUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}
