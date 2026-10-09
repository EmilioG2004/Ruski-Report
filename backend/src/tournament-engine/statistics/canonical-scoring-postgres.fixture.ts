import { PoolClient } from "pg";

import { PostgresDatabase } from "../../database";

export interface CanonicalScoringPostgresFixture {
  tournamentId: string;
  podId: string;
  teamIds: readonly [string, string, string];
  playerIds: readonly [string, string, string];
  membershipIds: readonly [string, string, string];
  matchIds: readonly [string, string];
  candidateIds: readonly [string, string];
  revisionIds: readonly [string, string];
  adminId: string;
  confirmationDigest: string;
  now: string;
}

export async function seedCanonicalScoringPostgresFixture(
  database: PostgresDatabase
): Promise<CanonicalScoringPostgresFixture> {
  const fixture = canonicalScoringPostgresFixture();
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await seedTournament(client, fixture);
    await seedWorkbookCandidates(client, fixture);
    await seedActiveRevisions(client, fixture);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await client.query("COMMIT");
    return fixture;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function canonicalScoringPostgresFixture(): CanonicalScoringPostgresFixture {
  return {
    tournamentId: uuid(100),
    podId: uuid(101),
    teamIds: [uuid(102), uuid(103), uuid(104)],
    playerIds: [uuid(105), uuid(106), uuid(107)],
    membershipIds: [uuid(108), uuid(109), uuid(110)],
    matchIds: [uuid(111), uuid(112)],
    candidateIds: [uuid(113), uuid(114)],
    revisionIds: [uuid(115), uuid(116)],
    adminId: uuid(117),
    confirmationDigest: "a".repeat(64),
    now: "2033-01-02T00:00:00.000Z"
  };
}

async function seedTournament(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture
): Promise<void> {
  await client.query(`
    INSERT INTO tournaments (id, game_type, year, name)
    VALUES ('canonical-statistics', 'ruski', 2033, 'Canonical Statistics')
  `);
  await client.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, created_at, updated_at
    ) VALUES (
      $1::uuid, 'canonical-statistics', 'ruski', 2033,
      'Canonical Statistics', 'draft_setup', 'private', 1, $2, $2
    )
  `, [fixture.tournamentId, fixture.now]);
  await client.query(`
    INSERT INTO engine_pods (
      id, tournament_id, public_key, name, normalized_name, sequence
    ) VALUES ($1::uuid, $2::uuid, 'pod-1', 'Pod 1', 'pod 1', 1)
  `, [fixture.podId, fixture.tournamentId]);
  for (const [index, teamId] of fixture.teamIds.entries()) {
    await client.query(`
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
    `, [teamId, fixture.tournamentId, `team-${index + 1}`,
      `Team ${index + 1}`, `team ${index + 1}`, index + 1]);
    await client.query(`
      INSERT INTO engine_pod_teams (
        tournament_id, pod_id, team_id, initial_seed
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4)
    `, [fixture.tournamentId, fixture.podId, teamId, index + 1]);
    await client.query(`
      INSERT INTO engine_players (
        id, tournament_id, public_key, display_name, created_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
    `, [fixture.playerIds[index], fixture.tournamentId, `player-${index + 1}`,
      `Player ${index + 1}`, fixture.now]);
    await client.query(`
      INSERT INTO engine_roster_memberships (
        id, tournament_id, public_key, team_id, player_id, roster_slot,
        opened_at, opened_by
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 1, $6, 'fixture'
      )
    `, [fixture.membershipIds[index], fixture.tournamentId,
      `membership-${index + 1}`, teamId, fixture.playerIds[index], fixture.now]);
  }
  for (const [index, matchId] of fixture.matchIds.entries()) {
    const opponentIndex = index + 1;
    await client.query(`
      INSERT INTO match_identities (match_id, tournament_id, created_at)
      VALUES ($1, 'canonical-statistics', $2)
    `, [`canonical-match-${index + 1}`, fixture.now]);
    await client.query(`
      INSERT INTO engine_matches (
        id, tournament_id, public_key, stage, pod_id, sequence,
        status, score_availability, row_version, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'pod_play', $4::uuid, $5,
        'scheduled', 'not_started', 1, $6, $6
      )
    `, [matchId, fixture.tournamentId, `canonical-match-${index + 1}`,
      fixture.podId, index + 1, fixture.now]);
    for (const [slotIndex, teamId] of [
      fixture.teamIds[0], fixture.teamIds[opponentIndex]
    ].entries()) {
      await client.query(`
        INSERT INTO engine_match_slots (
          tournament_id, match_id, slot_number, source_type, team_id
        ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
      `, [fixture.tournamentId, matchId, slotIndex + 1, teamId]);
    }
  }
  await client.query(`
    UPDATE engine_tournaments
    SET lifecycle = 'setup_published', setup_published_at = $2, updated_at = $2
    WHERE id = $1::uuid
  `, [fixture.tournamentId, fixture.now]);
  await client.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, 'statistics-admin', 'statistics-admin', 'Statistics Admin')
  `, [fixture.adminId]);
}

async function seedWorkbookCandidates(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture
): Promise<void> {
  const workbookId = uuid(118);
  const batchId = uuid(119);
  await client.query(`
    INSERT INTO engine_generated_workbooks (
      id, tournament_id, generation_revision, workbook_schema_version,
      generation_kind, source_tournament_row_version, source_digest,
      artifact_digest, artifact_size_bytes, artifact, filename,
      generated_by_admin_id, generated_at
    ) VALUES (
      $1::uuid, $2::uuid, 1, 1, 'setup', 1, repeat('b',64),
      repeat('c',64), 1, decode('00','hex'), 'statistics.xlsx', $3::uuid, $4
    )
  `, [workbookId, fixture.tournamentId, fixture.adminId, fixture.now]);
  await client.query(`
    INSERT INTO engine_workbook_import_batches (
      id, tournament_id, workbook_id, workbook_schema_version,
      source_workbook_digest, source_size_bytes, base_tournament_row_version,
      preview_digest, status, recognized_sheet_count, proposed_sheet_count,
      unchanged_sheet_count, missing_sheet_count, invalid_sheet_count,
      received_by_admin_id, received_at, previewed_at, preview_expires_at
    ) VALUES (
      $1::uuid, $2::uuid, $3::uuid, 1, repeat('d',64), 1, 1,
      repeat('e',64), 'preview_ready', 2, 2, 0, 0, 0,
      $4::uuid, $5, $5, $5::timestamptz + interval '24 hours'
    )
  `, [batchId, fixture.tournamentId, workbookId, fixture.adminId, fixture.now]);
  for (const [index, candidateId] of fixture.candidateIds.entries()) {
    const sheetId = uuid(120 + index);
    const observationId = uuid(122 + index);
    const matchId = fixture.matchIds[index];
    const opponentIndex = index + 1;
    await client.query(`
      INSERT INTO engine_generated_workbook_sheets (
        workbook_id, tournament_id, sheet_id, sheet_ordinal, sheet_kind,
        sheet_name, match_id, generated_match_row_version,
        side_one_team_id, side_two_team_id, participant_digest,
        baseline_fingerprint
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 'game', $5, $6::uuid, 1,
        $7::uuid, $8::uuid, repeat('f',64), repeat('1',64)
      )
    `, [workbookId, fixture.tournamentId, sheetId, index + 1,
      `Game ${index + 1}`, matchId, fixture.teamIds[0],
      fixture.teamIds[opponentIndex]]);
    await client.query(`
      INSERT INTO engine_workbook_import_observations (
        id, tournament_id, batch_id, workbook_id, workbook_sheet_id,
        sheet_ordinal, match_id, observation_kind, assignment_source,
        disposition, fingerprint, base_match_row_version,
        base_source_state_version, source_envelope_schema_version,
        source_envelope_digest, source_envelope, validation_issues, observed_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6, $7::uuid, 'present', 'stable_metadata', 'proposed', repeat('2',64),
        1, 0, 1, repeat('3',64), '{"fixture":true}'::jsonb, '[]'::jsonb, $8
      )
    `, [observationId, fixture.tournamentId, batchId, workbookId, sheetId,
      index + 1, matchId, fixture.now]);
    await client.query(`
      INSERT INTO engine_workbook_revision_candidates (
        id, tournament_id, match_id, batch_id, observation_id,
        source_revision_number, fingerprint, participant_digest,
        proposed_status, proposed_score_availability, reason,
        requires_confirmation, envelope_schema_version, envelope_digest,
        envelope, base_match_row_version, base_source_state_version, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, repeat('2',64), repeat('f',64), 'final', 'complete', 'initial',
        false, 1, repeat('4',64), '{"fixture":true}'::jsonb, 1, 0, $6
      )
    `, [candidateId, fixture.tournamentId, matchId, batchId,
      observationId, fixture.now]);
    await seedCandidateParticipants(client, fixture, candidateId, opponentIndex);
  }
}

async function seedCandidateParticipants(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture,
  candidateId: string,
  opponentIndex: number
): Promise<void> {
  for (const [sideIndex, teamIndex] of [0, opponentIndex].entries()) {
    await client.query(`
      INSERT INTO engine_workbook_revision_candidate_teams (
        tournament_id, candidate_id, side_number, team_id, display_name_at_import
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5)
    `, [fixture.tournamentId, candidateId, sideIndex + 1,
      fixture.teamIds[teamIndex], `Team ${teamIndex + 1}`]);
    await client.query(`
      INSERT INTO engine_workbook_revision_candidate_players (
        tournament_id, candidate_id, side_number, team_id, player_id,
        roster_membership_id, roster_slot, display_name_at_import
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, 1, $7
      )
    `, [fixture.tournamentId, candidateId, sideIndex + 1,
      fixture.teamIds[teamIndex], fixture.playerIds[teamIndex],
      fixture.membershipIds[teamIndex], `Player ${teamIndex + 1}`]);
  }
}

async function seedActiveRevisions(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture
): Promise<void> {
  for (const [index, revisionId] of fixture.revisionIds.entries()) {
    const opponentIndex = index + 1;
    await client.query(`
      INSERT INTO engine_match_revisions (
        id, tournament_id, match_id, public_key, revision_number, status,
        score_availability, reason, source_adapter, source_reference, actor_id,
        confirmation_digest, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 'final', 'complete', 'initial',
        'excel_import', $5, $6, $7, $8
      )
    `, [revisionId, fixture.tournamentId, fixture.matchIds[index],
      `canonical-revision-${index + 1}`, `candidate:${fixture.candidateIds[index]}`,
      fixture.adminId, fixture.confirmationDigest, fixture.now]);
    for (const [sideIndex, teamIndex] of [0, opponentIndex].entries()) {
      const score = index === 0
        ? (sideIndex === 0 ? 1 : 0)
        : (sideIndex === 0 ? 2 : 1);
      await client.query(`
        INSERT INTO engine_match_revision_teams (
          tournament_id, revision_id, side_number, team_id, score, result,
          display_name_at_revision
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5, $6, $7
        )
      `, [fixture.tournamentId, revisionId, sideIndex + 1,
        fixture.teamIds[teamIndex], score,
        sideIndex === 0 ? "win" : "loss", `Team ${teamIndex + 1}`]);
      await client.query(`
        INSERT INTO engine_match_revision_players (
          tournament_id, revision_id, side_number, team_id, player_id,
          roster_membership_id, roster_slot, display_name_at_revision
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, 1, $7
        )
      `, [fixture.tournamentId, revisionId, sideIndex + 1,
        fixture.teamIds[teamIndex], fixture.playerIds[teamIndex],
        fixture.membershipIds[teamIndex], `Player ${teamIndex + 1}`]);
    }
    await seedRevisionEvents(client, fixture, index);
    await client.query(`
      UPDATE engine_matches
      SET active_revision_id = $3::uuid, status = 'final',
          score_availability = 'complete', participants_frozen_at = $4,
          row_version = 2, updated_at = $4
      WHERE tournament_id = $1::uuid AND id = $2::uuid
    `, [fixture.tournamentId, fixture.matchIds[index], revisionId, fixture.now]);
  }
}

async function seedRevisionEvents(
  client: PoolClient,
  fixture: CanonicalScoringPostgresFixture,
  matchIndex: number
): Promise<void> {
  const opponentIndex = matchIndex + 1;
  const events = matchIndex === 0
    ? [
      { eventId: uuid(130), teamIndex: 0, outcome: "make", cupDelta: 1 },
      { eventId: uuid(131), teamIndex: opponentIndex, outcome: "miss", cupDelta: 0 }
    ]
    : [
      { eventId: uuid(132), teamIndex: 0, outcome: "miss", cupDelta: 2,
        classification: "di" },
      { eventId: uuid(133), teamIndex: opponentIndex, outcome: "make", cupDelta: 1 }
    ];
  for (const [index, event] of events.entries()) {
    await client.query(`
      INSERT INTO engine_match_events (
        id, tournament_id, revision_id, sequence, event_type,
        team_id, player_id, created_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'shot_attempt',
        $5::uuid, $6::uuid, $7)
    `, [event.eventId, fixture.tournamentId, fixture.revisionIds[matchIndex],
      index + 1, fixture.teamIds[event.teamIndex],
      fixture.playerIds[event.teamIndex], fixture.now]);
    await client.query(`
      INSERT INTO engine_shot_attempts (event_id, outcome, cup_delta)
      VALUES ($1::uuid, $2, $3)
    `, [event.eventId, event.outcome, event.cupDelta]);
    if (event.classification !== undefined) {
      await client.query(`
        INSERT INTO engine_shot_classifications (event_id, classification)
        VALUES ($1::uuid, $2)
      `, [event.eventId, event.classification]);
    }
  }
}

export function uuid(value: number): string {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}
