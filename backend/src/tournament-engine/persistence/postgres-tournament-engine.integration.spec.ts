import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner, PostgresDatabase } from "../../database";
import {
  copyTournamentConfiguration,
  OFFICIAL_STANDINGS_RULES,
  POD_AND_SINGLE_ELIMINATION_FORMAT,
  TOURNAMENT_FORMAT_VERSION
} from "../configuration";
import {
  MatchId,
  parseStableUuid,
  StableUuidKind
} from "../domain";
import { generatePodRoundRobinSchedule } from "../scheduling";
import {
  ActivateMatchRevisionInput,
  CreateTournamentDraftInput,
  EngineAuditCommand
} from "./contracts";
import {
  EnginePersistenceInvariantError,
  EngineWriterLeaseConflictError
} from "./errors";
import { PostgresMatchRevisionRepository } from "./postgres-match-revision.repository";
import { PostgresMatchWriterRepository } from "./postgres-match-writer.repository";
import { PostgresProjectionRepository } from "./postgres-projection.repository";
import { PostgresRosterRepository } from "./postgres-roster.repository";
import { PostgresTournamentSetupRepository } from "./postgres-tournament-setup.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = testDatabaseUrl === undefined ? describe.skip : describe;

postgresDescribe("canonical tournament engine PostgreSQL persistence", () => {
  let database: PostgresDatabase;
  let setupRepository: PostgresTournamentSetupRepository;
  let rosterRepository: PostgresRosterRepository;
  let writerRepository: PostgresMatchWriterRepository;
  let revisionRepository: PostgresMatchRevisionRepository;
  let projectionRepository: PostgresProjectionRepository;

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: testDatabaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    setupRepository = new PostgresTournamentSetupRepository(database);
    rosterRepository = new PostgresRosterRepository(database);
    writerRepository = new PostgresMatchWriterRepository(database);
    revisionRepository = new PostgresMatchRevisionRepository(database);
    projectionRepository = new PostgresProjectionRepository(database);
  });

  beforeEach(async () => {
    await database.query("DELETE FROM comments WHERE id = 'engine-comment-1'");
    await database.query("TRUNCATE engine_tournaments CASCADE");
    await database.query(
      "DELETE FROM match_identities WHERE tournament_id = 'tournament-2027'"
    );
    await database.query("DELETE FROM tournaments WHERE id = 'tournament-2027'");
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("creates and publishes one immutable setup atomically", async () => {
    const fixture = createFixture();
    const draft = await setupRepository.createDraft(fixture.input);
    const published = await setupRepository.publishSetup({
      tournamentId: fixture.tournamentId,
      expectedRowVersion: draft.rowVersion,
      schedule: fixture.schedule,
      publishedAt: "2027-01-02T00:00:00.000Z",
      audit: audit(901, "tournament_setup_published")
    });

    expect(published).toMatchObject({
      lifecycle: "setup_published",
      rowVersion: 2
    });
    const stored = await database.query<{
      lifecycle: string;
      visibility: string;
      match_count: string;
    }>(`
      SELECT tournament.lifecycle,
             tournament.visibility,
             count(match.id)::text AS match_count
      FROM engine_tournaments tournament
      LEFT JOIN engine_matches match ON match.tournament_id = tournament.id
      WHERE tournament.id = $1::uuid
      GROUP BY tournament.id
    `, [fixture.tournamentId]);
    expect(stored.rows[0]).toEqual({
      lifecycle: "setup_published",
      visibility: "public",
      match_count: "2"
    });
    const identities = await database.query<{ match_count: string }>(`
      SELECT count(identity.match_id)::text AS match_count
      FROM engine_matches match
      JOIN match_identities identity
        ON identity.match_id = match.public_key
      JOIN engine_tournaments engine_tournament
        ON engine_tournament.id = match.tournament_id
       AND engine_tournament.public_key = identity.tournament_id
      WHERE match.tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(identities.rows[0]?.match_count).toBe("2");
    await database.query(`
      INSERT INTO comments (
        id, match_id, author_kind, author_display_name, body, created_at
      ) VALUES ('engine-comment-1', $1, 'guest', 'Fixture Guest', 'Great match.', $2)
    `, [fixture.schedule[0].id, "2027-01-02T01:00:00.000Z"]);

    await expect(database.query(
      "UPDATE engine_teams SET name = 'Renamed' WHERE id = $1::uuid",
      [fixture.teamIds[0]]
    )).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      INSERT INTO engine_tournament_configurations
      SELECT * FROM engine_tournament_configurations
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      INSERT INTO engine_pods (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, 'late-pod', 'Late Pod', 'late pod', 99)
    `, [rawUuid(98), fixture.tournamentId])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, 'late-team', 'Late Team', 'late team', 99)
    `, [rawUuid(99), fixture.tournamentId])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      INSERT INTO engine_pod_teams
      SELECT tournament_id, pod_id, team_id, initial_seed, assigned_at
      FROM engine_pod_teams
      WHERE tournament_id = $1::uuid
      LIMIT 1
    `, [fixture.tournamentId])).rejects.toThrow(/immutable/i);
    await expect(database.query(`
      UPDATE engine_pod_teams
      SET assigned_at = assigned_at + interval '1 second'
      WHERE tournament_id = $1::uuid AND team_id = $2::uuid
    `, [fixture.tournamentId, fixture.teamIds[0]])).rejects.toThrow(/immutable/i);
  });

  it("rejects same-length altered or duplicated generated schedules atomically", async () => {
    const fixture = createFixture();
    await setupRepository.createDraft(fixture.input);
    const altered = fixture.schedule.map((match, index) => index === 0
      ? {
          ...match,
          participantTeamIds: [
            match.participantTeamIds[0],
            fixture.teamIds[2]
          ] as const
        }
      : match
    );
    const duplicated = fixture.schedule.map((match, index) => index === 1
      ? { ...match, id: fixture.schedule[0].id }
      : match
    );

    for (const schedule of [altered, duplicated]) {
      await expect(setupRepository.publishSetup({
        tournamentId: fixture.tournamentId,
        expectedRowVersion: 1,
        schedule,
        publishedAt: "2027-01-02T00:00:00.000Z",
        audit: audit(930, "invalid_setup_publication")
      })).rejects.toBeInstanceOf(EnginePersistenceInvariantError);
    }
    const unchanged = await database.query<{
      lifecycle: string;
      match_count: string;
    }>(`
      SELECT tournament.lifecycle,
             count(match.id)::text AS match_count
      FROM engine_tournaments tournament
      LEFT JOIN engine_matches match ON match.tournament_id = tournament.id
      WHERE tournament.id = $1::uuid
      GROUP BY tournament.id
    `, [fixture.tournamentId]);
    expect(unchanged.rows[0]).toEqual({
      lifecycle: "draft_setup",
      match_count: "0"
    });
  });

  it("replaces a roster slot without rewriting historical membership identity", async () => {
    const fixture = await createPublishedFixture();
    const replacementPlayerId = stable(70, "tournament_player");
    const replacementMembershipId = stable(71, "roster_membership");
    const replaced = await rosterRepository.replacePlayer({
      tournamentId: fixture.tournamentId,
      teamId: fixture.teamIds[0],
      expectedTournamentRowVersion: 2,
      replacedMembershipId: fixture.membershipIds[0],
      replacement: {
        id: replacementPlayerId,
        publicKey: "player-replacement",
        displayName: "Replacement Player",
        membershipId: replacementMembershipId,
        membershipPublicKey: "membership-replacement",
        rosterSlot: 1
      },
      effectiveAt: "2027-01-03T00:00:00.000Z",
      reason: "availability",
      actorId: "administrator-1",
      audit: audit(902, "roster_player_replaced")
    });

    expect(replaced).toMatchObject({ rowVersion: 3 });
    const history = await database.query<{
      id: string;
      player_id: string;
      closed_at: Date | null;
    }>(`
      SELECT id, player_id, closed_at
      FROM engine_roster_memberships
      WHERE tournament_id = $1::uuid
        AND team_id = $2::uuid
        AND roster_slot = 1
      ORDER BY opened_at
    `, [fixture.tournamentId, fixture.teamIds[0]]);
    expect(history.rows).toHaveLength(2);
    expect(history.rows[0]).toMatchObject({ id: fixture.membershipIds[0] });
    expect(history.rows[0].closed_at).not.toBeNull();
    expect(history.rows[1]).toMatchObject({
      id: replacementMembershipId,
      player_id: replacementPlayerId,
      closed_at: null
    });
  });

  it("activates an immutable event revision only under the current writer fence", async () => {
    const fixture = await createPublishedFixture();
    const matchId = fixture.schedule[0].id;
    const firstLease = await writerRepository.acquire({
      tournamentId: fixture.tournamentId,
      matchId,
      mode: "excel_import",
      holderId: "workbook-import-1",
      acquiredAt: "2027-01-03T00:00:00.000Z",
      expiresAt: "2027-01-03T00:10:00.000Z"
    });
    expect(firstLease.acquired).toBe(true);
    if (!firstLease.acquired) {
      throw new Error("Expected writer lease acquisition.");
    }
    const earlyTakeover = await writerRepository.acquire({
      tournamentId: fixture.tournamentId,
      matchId,
      mode: "operator_correction",
      holderId: "future-dated-operator",
      acquiredAt: "2099-01-01T00:00:00.000Z",
      expiresAt: "2099-01-01T00:10:00.000Z"
    });
    expect(earlyTakeover).toMatchObject({
      acquired: false,
      activeMode: "excel_import",
      activeHolderId: "workbook-import-1"
    });

    const command = firstRevision(fixture, matchId, firstLease.fencingToken);
    const unattributedShotCommand: ActivateMatchRevisionInput = {
      ...command,
      events: command.events.map((event, index) => index === 0
        ? { ...event, teamId: undefined }
        : event
      )
    };
    await expect(
      revisionRepository.activateRevision(unattributedShotCommand)
    ).rejects.toBeInstanceOf(EnginePersistenceInvariantError);
    const mismatchedPlayerTeamCommand: ActivateMatchRevisionInput = {
      ...command,
      events: command.events.map((event, index) => index === 0
        ? { ...event, teamId: command.teams[1].teamId }
        : event
      )
    };
    await expect(
      revisionRepository.activateRevision(mismatchedPlayerTeamCommand)
    ).rejects.toBeInstanceOf(EnginePersistenceInvariantError);
    const activated = await revisionRepository.activateRevision(command);
    expect(activated.matchRowVersion).toBe(2);

    const eventRows = await database.query<{
      event_type: string;
      outcome: string | null;
      classification: string | null;
    }>(`
      SELECT event.event_type, attempt.outcome, classification.classification
      FROM engine_match_events event
      LEFT JOIN engine_shot_attempts attempt ON attempt.event_id = event.id
      LEFT JOIN engine_shot_classifications classification
        ON classification.event_id = event.id
      WHERE event.revision_id = $1::uuid
      ORDER BY event.sequence
    `, [command.revision.id]);
    expect(eventRows.rows).toEqual([
      { event_type: "shot_attempt", outcome: "miss", classification: "tri" },
      { event_type: "vom", outcome: null, classification: null }
    ]);
    await expect(database.query(`
      INSERT INTO engine_match_events (
        id, tournament_id, revision_id, sequence, event_type,
        team_id, player_id, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 3, 'vom',
        $4::uuid, $5::uuid, clock_timestamp()
      )
    `, [
      rawUuid(89),
      fixture.tournamentId,
      command.revision.id,
      command.teams[1].teamId,
      command.teams[0].players[0].playerId
    ])).rejects.toThrow();
    await expect(database.query(`
      INSERT INTO engine_match_events (
        id, tournament_id, revision_id, sequence, event_type,
        team_id, player_id, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, 4, 'shot_attempt',
        $4::uuid, NULL, clock_timestamp()
      )
    `, [
      rawUuid(90),
      fixture.tournamentId,
      command.revision.id,
      command.teams[0].teamId
    ])).rejects.toThrow();

    await expect(database.query(`
      INSERT INTO engine_match_slots (
        tournament_id, match_id, slot_number, source_type, team_id
      ) VALUES ($1::uuid, $2::uuid, 1, 'team', $3::uuid)
    `, [
      fixture.tournamentId,
      matchId,
      fixture.schedule[0].participantTeamIds[0]
    ])).rejects.toThrow(/frozen/i);

    await database.query(`
      UPDATE engine_match_writer_leases
      SET acquired_at = clock_timestamp() - interval '2 seconds',
          expires_at = clock_timestamp() - interval '1 second'
      WHERE match_id = $1::uuid
    `, [matchId]);
    const expiredFenceCommand: ActivateMatchRevisionInput = {
      ...command,
      expectedMatchRowVersion: 2,
      revision: {
        ...command.revision,
        id: stable(82, "match_revision"),
        publicKey: "revision-2",
        revisionNumber: 2,
        previousRevisionId: command.revision.id,
        reason: "correction",
        createdAt: "2027-01-03T00:12:00.000Z"
      },
      writerFence: {
        mode: "excel_import",
        holderId: "workbook-import-1",
        fencingToken: firstLease.fencingToken,
        checkedAt: "2000-01-01T00:00:00.000Z"
      },
      audit: audit(905, "match_revision_corrected")
    };
    await expect(
      revisionRepository.activateRevision(expiredFenceCommand)
    ).rejects.toBeInstanceOf(EngineWriterLeaseConflictError);

    const secondLease = await writerRepository.acquire({
      tournamentId: fixture.tournamentId,
      matchId,
      mode: "operator_correction",
      holderId: "operator-2",
      acquiredAt: "2027-01-03T00:11:00.000Z",
      expiresAt: "2027-01-03T00:21:00.000Z"
    });
    expect(secondLease.acquired).toBe(true);
    await expect(
      revisionRepository.activateRevision(expiredFenceCommand)
    ).rejects.toBeInstanceOf(EngineWriterLeaseConflictError);
  });

  it("switches the coherent active projection pointer without partial visibility", async () => {
    const fixture = await createPublishedFixture();
    await projectionRepository.createReadyVersion({
      tournamentId: fixture.tournamentId,
      version: 1,
      payloadSchemaVersion: 1,
      sourceDigest: "a".repeat(64),
      createdAt: "2027-01-04T00:00:00.000Z",
      readyAt: "2027-01-04T00:00:01.000Z"
    });
    const first = await projectionRepository.activate({
      tournamentId: fixture.tournamentId,
      version: 1,
      expectedTournamentRowVersion: 2,
      activatedAt: "2027-01-04T00:00:02.000Z",
      audit: audit(906, "projection_activated")
    });
    await projectionRepository.createReadyVersion({
      tournamentId: fixture.tournamentId,
      version: 2,
      payloadSchemaVersion: 1,
      sourceDigest: "b".repeat(64),
      createdAt: "2027-01-04T00:00:03.000Z",
      readyAt: "2027-01-04T00:00:04.000Z"
    });
    await projectionRepository.activate({
      tournamentId: fixture.tournamentId,
      version: 2,
      expectedTournamentRowVersion: first.rowVersion,
      activatedAt: "2027-01-04T00:00:05.000Z",
      audit: audit(907, "projection_activated")
    });

    const projections = await database.query<{
      version: string;
      status: string;
      active_version: string;
    }>(`
      SELECT projection.version::text,
             projection.status,
             active.projection_version::text AS active_version
      FROM engine_projection_versions projection
      JOIN engine_active_projection_versions active
        ON active.tournament_id = projection.tournament_id
      WHERE projection.tournament_id = $1::uuid
      ORDER BY projection.version
    `, [fixture.tournamentId]);
    expect(projections.rows).toEqual([
      { version: "1", status: "superseded", active_version: "2" },
      { version: "2", status: "active", active_version: "2" }
    ]);
  });

  async function createPublishedFixture() {
    const fixture = createFixture();
    await setupRepository.createDraft(fixture.input);
    await setupRepository.publishSetup({
      tournamentId: fixture.tournamentId,
      expectedRowVersion: 1,
      schedule: fixture.schedule,
      publishedAt: "2027-01-02T00:00:00.000Z",
      audit: audit(900, "tournament_setup_published")
    });
    return fixture;
  }
});

function createFixture() {
  const tournamentId = stable(1, "tournament");
  const podIds = [stable(10, "pod"), stable(11, "pod")] as const;
  const teamIds = [
    stable(20, "tournament_team"),
    stable(21, "tournament_team"),
    stable(22, "tournament_team"),
    stable(23, "tournament_team")
  ] as const;
  const playerIds = Array.from({ length: 8 }, (_, index) =>
    stable(30 + index, "tournament_player")
  );
  const membershipIds = Array.from({ length: 8 }, (_, index) =>
    stable(50 + index, "roster_membership")
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
  const pods = podIds.map((podId, index) => ({
    id: podId,
    publicKey: `pod-${index + 1}`,
    name: `Pod ${index + 1}`,
    normalizedName: `pod ${index + 1}`,
    sequence: index + 1
  }));
  const teams = teamIds.map((teamId, index) => ({
    id: teamId,
    publicKey: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    normalizedName: `team ${index + 1}`,
    sequence: index + 1,
    podId: podIds[Math.floor(index / 2)],
    initialSeed: index % 2 + 1,
    players: [0, 1].map((playerOffset) => {
      const playerIndex = index * 2 + playerOffset;
      return {
        id: playerIds[playerIndex],
        publicKey: `player-${playerIndex + 1}`,
        displayName: `Player ${playerIndex + 1}`,
        membershipId: membershipIds[playerIndex],
        membershipPublicKey: `membership-${playerIndex + 1}`,
        rosterSlot: playerOffset + 1
      };
    })
  }));
  const input: CreateTournamentDraftInput = {
    tournament: {
      id: tournamentId,
      publicKey: "tournament-2027",
      gameType: "ruski",
      year: 2027,
      name: "2027 Tournament",
      visibility: "public"
    },
    configuration,
    pods,
    teams,
    createdAt: "2027-01-01T00:00:00.000Z",
    audit: audit(899, "tournament_draft_created")
  };
  const schedule = generatePodRoundRobinSchedule(configuration, {
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
      teamAssignments: teams
        .filter((team) => team.podId === pod.id)
        .map((team) => ({ teamId: team.id, initialSeed: team.initialSeed }))
    }))
  });
  return {
    input,
    schedule,
    tournamentId,
    podIds,
    teamIds,
    playerIds,
    membershipIds
  };
}

function firstRevision(
  fixture: ReturnType<typeof createFixture>,
  matchId: MatchId,
  fencingToken: number
): ActivateMatchRevisionInput {
  const participantTeamIds = fixture.schedule[0].participantTeamIds;
  const participantTeams = participantTeamIds.map((teamId, sideIndex) => {
    const teamIndex = fixture.teamIds.indexOf(teamId);
    return {
      sideNumber: (sideIndex + 1) as 1 | 2,
      teamId,
      displayName: fixture.input.teams[teamIndex].name,
      score: sideIndex === 0 ? 2 : 1,
      result: sideIndex === 0 ? "win" as const : "loss" as const,
      players: fixture.input.teams[teamIndex].players.map((player) => ({
        playerId: player.id,
        rosterMembershipId: player.membershipId,
        rosterSlot: player.rosterSlot,
        displayName: player.displayName
      }))
    };
  });
  return {
    tournamentId: fixture.tournamentId,
    matchId,
    expectedMatchRowVersion: 1,
    revision: {
      id: stable(80, "match_revision"),
      publicKey: "revision-1",
      revisionNumber: 1,
      status: "final",
      scoreAvailability: "complete",
      reason: "workbook_update",
      sourceAdapter: "excel_import",
      sourceReference: "fixture-workbook.xlsx#Pod 1",
      actorId: "workbook-import-1",
      createdAt: "2027-01-03T00:05:00.000Z"
    },
    teams: participantTeams,
    events: [
      {
        id: stable(83, "scoring_event"),
        sequence: 1,
        type: "shot_attempt",
        teamId: participantTeams[0].teamId,
        playerId: participantTeams[0].players[0].playerId,
        shotAttempt: { outcome: "miss", classification: "tri", cupDelta: 0 }
      },
      {
        id: stable(84, "scoring_event"),
        sequence: 2,
        type: "vom",
        teamId: participantTeams[1].teamId,
        playerId: participantTeams[1].players[0].playerId
      }
    ],
    writerFence: {
      mode: "excel_import",
      holderId: "workbook-import-1",
      fencingToken,
      checkedAt: "2027-01-03T00:05:00.000Z"
    },
    audit: audit(904, "match_revision_activated")
  };
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
