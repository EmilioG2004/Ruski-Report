import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "../../config/database.config";
import { MigrationRunner, PostgresDatabase } from "../../database";
import {
  createBracketMatchId,
  createBracketRoundId,
  createBracketSlotId,
  createSingleEliminationBracketId,
  createStablePlayoffMatchInstanceId
} from "../bracket";
import {
  BracketMatchId,
  parseStableUuid,
  TournamentId,
  TournamentTeamId
} from "../domain";
import {
  BracketNodeInput,
  BracketRoundInput,
  BracketSlotInput,
  PlayoffMatchInput,
  TournamentProgressionRecord
} from "./progression-contracts";
import { PostgresTournamentProgressionRepository } from "./postgres-tournament-progression.repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const postgresDescribe = databaseUrl === undefined ? describe.skip : describe;

postgresDescribe("PostgresTournamentProgressionRepository", () => {
  let database: PostgresDatabase;
  let repository: PostgresTournamentProgressionRepository;
  const publicTournamentId = "progression-integration";

  beforeAll(async () => {
    const config = loadDatabaseConfig({
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATIONS_DIR: `${process.cwd()}/migrations`
    });
    database = new PostgresDatabase(config);
    await new MigrationRunner(database, config).migrate();
    repository = new PostgresTournamentProgressionRepository(database);
  });

  beforeEach(async () => {
    await database.query("TRUNCATE engine_tournaments CASCADE");
    await database.query(`
      DELETE FROM comments
      WHERE match_id IN (
        SELECT match_id FROM match_identities WHERE tournament_id = $1
      )
    `, [publicTournamentId]);
    await database.query("DELETE FROM match_identities WHERE tournament_id = $1", [
      publicTournamentId
    ]);
    await database.query("DELETE FROM tournaments WHERE id = $1", [publicTournamentId]);
  });

  afterAll(async () => {
    await database.onApplicationShutdown();
  });

  it("reads active pod state and derives a content-safe operator preview", async () => {
    const fixture = await seedScheduledPodMatch(database, publicTournamentId);
    const progression = await repository.readProgression(fixture.tournamentId);
    expect(progression).toMatchObject({
      lifecycle: "pod_play",
      rowVersion: 1,
      qualifiersPerPod: 1,
      bracketSize: 2,
      effectiveSeeds: [],
      pods: [{
        podId: fixture.podId,
        name: "Pod One",
        rows: [],
        tieGroups: []
      }]
    });

    const preview = await repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: fixture.matchId,
      expectedTournamentRowVersion: 1,
      expectedMatchRowVersion: 1,
      commandType: "cancel",
      reason: "Weather cancellation"
    });
    expect(preview).toMatchObject({
      currentStatus: "scheduled",
      proposedStatus: "cancelled",
      podId: fixture.podId,
      dependentBracketMatchIds: [],
      requiresCascade: false
    });
    expect(preview.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(preview)).not.toContain("Player One");
  });

  it.each([
    ["forfeit", "forfeited", "not_applicable", "forfeit"],
    ["cancel", "cancelled", "not_applicable", "cancellation"],
    ["postpone", "postponed", "not_started", "postponement"]
  ] as const)(
    "atomically records an operator %s with canonical status semantics",
    async (commandType, status, scoreAvailability, eventType) => {
      const fixture = await seedScheduledPodMatch(database, publicTournamentId);
      const reason = `${commandType} fixture reason`;
      const preview = await repository.previewOperatorMatchResolution({
        tournamentId: fixture.tournamentId,
        matchId: fixture.matchId,
        expectedTournamentRowVersion: 1,
        expectedMatchRowVersion: 1,
        commandType,
        ...(commandType === "forfeit" ? { winnerTeamId: fixture.teamIds[0] } : {}),
        reason
      });
      const occurredAt = "2035-01-02T00:00:00.000Z";
      await repository.recordOperatorMatchResolution({
        commandId: randomUUID(),
        tournamentId: fixture.tournamentId,
        matchId: fixture.matchId,
        expectedTournamentRowVersion: 1,
        expectedMatchRowVersion: 1,
        commandType,
        ...(commandType === "forfeit" ? { winnerTeamId: fixture.teamIds[0] } : {}),
        reason,
        revisionId: parseStableUuid(randomUUID(), "match_revision"),
        revisionPublicKey: `operator-${commandType}-${randomUUID()}`,
        eventId: randomUUID(),
        rulesVersion: 1,
        confirmationDigest: preview.confirmationDigest,
        actorId: fixture.adminId,
        occurredAt,
        writerLeaseExpiresAt: "2035-01-02T00:05:00.000Z"
      });
      const stored = await database.query<{
        status: string;
        score_availability: string;
        event_type: string;
      }>(`
        SELECT revision.status, revision.score_availability, event.event_type
        FROM engine_matches match
        JOIN engine_match_revisions revision ON revision.id = match.active_revision_id
        JOIN engine_match_events event ON event.revision_id = revision.id
        WHERE match.id = $1::uuid
      `, [fixture.matchId]);
      expect(stored.rows[0]).toEqual({
        status,
        score_availability: scoreAvailability,
        event_type: eventType
      });
    }
  );

  it("persists generalized standings, seeds, byes, and future bracket advancement", async () => {
    const fixture = await seedGeneralizedProgression(database, publicTournamentId);
    let progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );

    for (const match of fixture.podMatches) {
      const commandType = match.podIndex === 2 ? "cancel" as const : "forfeit" as const;
      const result = await applyOperator(repository, progression, {
        matchId: match.matchId,
        matchRowVersion: 1,
        commandType,
        ...(commandType === "forfeit" ? { winnerTeamId: match.teamIds[0] } : {}),
        reason: `${commandType} pod ${match.podIndex + 1}`,
        adminId: fixture.adminId,
        occurredAt: isoMinute(10 + match.podIndex)
      });
      expect(result.statistics.matches).toHaveLength(1);
      progression = requireProgression(
        await repository.readProgression(fixture.tournamentId)
      );
      const pod = progression.pods[match.podIndex];
      const tie = pod?.tieGroups[0];
      if (commandType === "cancel") {
        expect(pod?.calculationStatus).toBe("unresolved_tie");
        expect(tie?.teamIds).toHaveLength(2);
        if (pod?.activeCalculationId === undefined || tie === undefined) {
          throw new Error("Expected one active exact pod tie.");
        }
        await repository.resolvePodTie({
          commandId: randomUUID(),
          replacementCalculationId: randomUUID(),
          tournamentId: fixture.tournamentId,
          podId: pod.podId,
          expectedTournamentRowVersion: progression.rowVersion,
          activeCalculationId: pod.activeCalculationId,
          tieGroupId: tie.tieGroupId,
          orderedTeamIds: tie.teamIds,
          reason: "Fixture exact pod tie order",
          confirmationDigest: "a".repeat(64),
          administratorId: fixture.adminId,
          occurredAt: isoMinute(20 + match.podIndex)
        });
        progression = requireProgression(
          await repository.readProgression(fixture.tournamentId)
        );
      } else {
        expect(pod?.calculationStatus).toBe("finalizable");
      }
      const resolvedPod = progression.pods[match.podIndex];
      expect(resolvedPod?.calculationStatus).toBe("finalizable");
      if (resolvedPod?.activeCalculationId === undefined) {
        throw new Error("Expected resolved active pod standings.");
      }
      await repository.finalizePod({
        tournamentId: fixture.tournamentId,
        podId: resolvedPod.podId,
        expectedTournamentRowVersion: progression.rowVersion,
        calculationId: resolvedPod.activeCalculationId,
        finalizationId: randomUUID(),
        reason: "Fixture pod finalization",
        confirmationDigest: "b".repeat(64),
        administratorId: fixture.adminId,
        occurredAt: isoMinute(30 + match.podIndex)
      });
      progression = requireProgression(
        await repository.readProgression(fixture.tournamentId)
      );
    }

    expect(progression.lifecycle).toBe("seeding_review");
    const finalizationDigests = await database.query<{ override_digest: string }>(`
      SELECT override_digest
      FROM engine_pod_finalization_provenance
      WHERE tournament_id = $1::uuid
      ORDER BY pod_id
    `, [fixture.tournamentId]);
    expect(finalizationDigests.rows).toHaveLength(3);
    expect(finalizationDigests.rows.every((row) =>
      /^[a-f0-9]{64}$/.test(row.override_digest)
    )).toBe(true);
    let globalResolutionIndex = 0;
    while (progression.activeGlobalSeedReview?.status === "unresolved_tie") {
      const globalReview = progression.activeGlobalSeedReview;
      const globalTie = globalReview.tieGroups.find((tie) => !tie.resolved);
      if (globalTie === undefined || globalResolutionIndex >= 6) {
        throw new Error("Expected a bounded unresolved global qualifier tie.");
      }
      await repository.resolveGlobalSeedTie({
        commandId: randomUUID(),
        reviewVersionId: randomUUID(),
        tournamentId: fixture.tournamentId,
        expectedTournamentRowVersion: progression.rowVersion,
        activeReviewVersionId: globalReview.reviewVersionId,
        seedCalculationId: globalReview.seedCalculationId,
        tieGroupId: globalTie.tieGroupId,
        orderedTeamIds: globalTie.teamIds,
        reason: "Fixture global tie order",
        confirmationDigest: "c".repeat(64),
        administratorId: fixture.adminId,
        occurredAt: isoMinute(40 + globalResolutionIndex)
      });
      globalResolutionIndex += 1;
      progression = requireProgression(
        await repository.readProgression(fixture.tournamentId)
      );
    }
    expect(globalResolutionIndex).toBeGreaterThan(0);
    expect(progression.effectiveSeeds).toHaveLength(6);
    const reversed = [...progression.effectiveSeeds].reverse();
    await repository.applySeedOverridePermutation({
      commandId: randomUUID(),
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: progression.rowVersion,
      calculationId: progression.activeSeedCalculationId as string,
      overrideDigest: "d".repeat(64),
      reason: "Fixture full seed reversal",
      rows: reversed.map((row, index) => ({
        teamId: row.teamId,
        previousSeed: row.effectiveSeed,
        newSeed: index + 1,
        overrideId: randomUUID()
      })),
      confirmationDigest: "e".repeat(64),
      administratorId: fixture.adminId,
      occurredAt: isoMinute(41)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.activeSeedOverride?.overrideDigest).toBe("d".repeat(64));
    const storedOverride = await database.query<{ override_digest: string }>(`
      SELECT override_digest
      FROM engine_seed_override_commands
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(storedOverride.rows[0]?.override_digest).toBe("d".repeat(64));

    const workbookId = await seedCumulativeWorkbook(
      database, fixture, progression.rowVersion
    );
    const bracket = createEightSlotBracket(fixture.tournamentId, progression);
    const publication = await repository.publishBracket({
      publicationId: randomUUID(),
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: progression.rowVersion,
      seedCalculationId: progression.activeSeedCalculationId as string,
      seedOverrideCommandId: progression.activeSeedOverrideCommandId,
      cumulativeWorkbookId: workbookId,
      bracket,
      confirmationDigest: "f".repeat(64),
      administratorId: fixture.adminId,
      occurredAt: isoMinute(42)
    });
    expect(publication.playableMatchIds).toHaveLength(2);
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const rounds = progression.activeBracket?.rounds;
    expect(rounds?.[0]?.matches.filter((match) => !match.playable)).toHaveLength(2);
    expect(rounds?.[1]?.matches.filter((match) => match.playable)).toHaveLength(1);

    const sealedCalculationId = progression.pods[0]?.activeCalculationId;
    const activeOverrideId = progression.activeSeedOverrideCommandId;
    if (sealedCalculationId === undefined || activeOverrideId === undefined) {
      throw new Error("Expected active standing and override artifacts.");
    }
    await expect(database.query(`
      INSERT INTO engine_standing_rows (
        id, tournament_id, calculation_id, team_id, public_key,
        rank, wins, losses, cup_differential, qualified
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, 99, 0, 0, 0, false
      )
    `, [
      randomUUID(), fixture.tournamentId, sealedCalculationId,
      fixture.teamIds[0], `late-standing-${randomUUID()}`
    ])).rejects.toThrow(/sealed/i);
    await expect(database.query(`
      INSERT INTO engine_seed_override_command_rows (
        command_id, tournament_id, team_id,
        previous_seed, new_seed, override_id
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, 1, 1, NULL)
    `, [
      activeOverrideId, fixture.tournamentId, fixture.teamIds[0]
    ])).rejects.toThrow(/sealed/i);
    const mismatchedBracketId = randomUUID();
    await database.query(`
      INSERT INTO engine_brackets (
        id, tournament_id, public_key, name, bracket_size,
        placement_policy, status, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'Mismatched Active Bracket', 8,
        'standard_mirrored_seeded', 'draft', $4
      )
    `, [
      mismatchedBracketId, fixture.tournamentId,
      `mismatched-${mismatchedBracketId}`, isoMinute(42)
    ]);
    await expect(database.query(`
      UPDATE engine_active_brackets SET bracket_id = $2::uuid
      WHERE tournament_id = $1::uuid
    `, [fixture.tournamentId, mismatchedBracketId]))
      .rejects.toThrow(/matching publication/i);
    const orphanBracketId = randomUUID();
    const orphanRoundOneId = randomUUID();
    const orphanRoundTwoId = randomUUID();
    const orphanPublishedAt = isoMinute(42);
    await database.query(`
      INSERT INTO engine_brackets (
        id, tournament_id, public_key, name, bracket_size,
        placement_policy, status, published_at, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'Orphan Boundary Bracket', 4,
        'standard_mirrored_seeded', 'published', $4, $4
      )
    `, [
      orphanBracketId, fixture.tournamentId,
      `orphan-${orphanBracketId}`, orphanPublishedAt
    ]);
    for (const [roundId, sequence] of [
      [orphanRoundOneId, 1], [orphanRoundTwoId, 2]
    ] as const) {
      await database.query(`
        INSERT INTO engine_bracket_rounds (
          id, tournament_id, bracket_id, public_key, name, sequence
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
      `, [
        roundId, fixture.tournamentId, orphanBracketId,
        `orphan-round-${sequence}`, `Orphan Round ${sequence}`, sequence
      ]);
      await database.query(`
        INSERT INTO engine_bracket_matches (
          id, tournament_id, bracket_id, round_id, match_id,
          public_key, sequence, playable
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL, $5, 1, false
        )
      `, [
        randomUUID(), fixture.tournamentId, orphanBracketId, roundId,
        `orphan-node-${sequence}`
      ]);
    }
    await expect(database.query(`
      INSERT INTO engine_bracket_publications (
        id, tournament_id, bracket_id, seed_calculation_id,
        seed_override_command_id, cumulative_workbook_id,
        confirmation_digest, published_by_admin_id, published_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        $6::uuid, $7, $8::uuid, $9
      )
    `, [
      randomUUID(), fixture.tournamentId, orphanBracketId,
      progression.activeSeedCalculationId, activeOverrideId, workbookId,
      "5".repeat(64), fixture.adminId, orphanPublishedAt
    ])).rejects.toThrow(/stale or incomplete/i);

    const firstPlayedNode = bracket.rounds[0]?.matches[0];
    const secondPlayedNode = bracket.rounds[0]?.matches[1];
    const nextNodeId = bracket.rounds[1]?.matches[0]?.id;
    if (
      firstPlayedNode?.match === undefined || secondPlayedNode?.match === undefined ||
      nextNodeId === undefined
    ) {
      throw new Error("Expected two first-round playable and future nodes.");
    }
    const firstWinner = firstPlayedNode.slots[0]?.teamId;
    if (firstWinner === undefined) throw new Error("Expected a direct seeded winner.");
    await applyOperator(repository, progression, {
      matchId: firstPlayedNode.match.id,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: firstWinner,
      reason: "Fixture first-round forfeit",
      adminId: fixture.adminId,
      occurredAt: isoMinute(43)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const secondWinner = secondPlayedNode.slots[0]?.teamId;
    if (secondWinner === undefined) throw new Error("Expected second direct winner.");
    await applyOperator(repository, progression, {
      matchId: secondPlayedNode.match.id,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: secondWinner,
      reason: "Fixture second first-round forfeit",
      adminId: fixture.adminId,
      occurredAt: isoMinute(44)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const nextNode = progression.activeBracket?.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.bracketMatchId === nextNodeId);
    expect(nextNode).toMatchObject({
      playable: true,
      instanceNumber: 1,
      participantsFrozen: false,
      participantTeamIds: [firstWinner, secondWinner],
      matchStatus: "scheduled"
    });
    expect(nextNode?.matchId).toBeDefined();
    if (nextNode?.matchId === undefined) throw new Error("Expected next match identity.");
    const detachedMatchId = nextNode.matchId;
    const preservedCommentId = `progression-comment-${randomUUID()}`;
    await database.query(`
      INSERT INTO comments (
        id, match_id, author_kind, author_display_name, body, created_at
      ) VALUES ($1, $2, 'guest', 'Fixture Guest', 'Preserve me.', $3)
    `, [preservedCommentId, detachedMatchId, isoMinute(44)]);

    await applyOperator(repository, progression, {
      matchId: firstPlayedNode.match.id,
      matchRowVersion: 2,
      commandType: "postpone",
      reason: "Fixture invalidates an unstarted downstream match",
      adminId: fixture.adminId,
      occurredAt: isoMinute(45)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const invalidatedNode = progression.activeBracket?.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.bracketMatchId === nextNodeId);
    expect(invalidatedNode).toMatchObject({
      playable: false,
      instanceNumber: 1,
      participantsFrozen: false
    });
    expect(invalidatedNode?.matchId).toBe(detachedMatchId);
    expect(invalidatedNode?.participantTeamIds).toBeUndefined();
    const invalidation = await database.query<{
      affected_match_id: string;
      active_resolution_count: string;
      preserved_match_count: string;
      preserved_comment_count: string;
    }>(`
      SELECT invalidation.affected_match_id::text,
             (SELECT count(*)::text
              FROM engine_active_bracket_match_resolutions active
              WHERE active.tournament_id = invalidation.tournament_id
                AND active.bracket_match_id = invalidation.bracket_match_id)
               AS active_resolution_count,
             (SELECT count(*)::text FROM engine_matches match
              WHERE match.id = invalidation.affected_match_id)
               AS preserved_match_count,
             (SELECT count(*)::text FROM comments comment
              JOIN engine_matches match ON match.public_key = comment.match_id
              WHERE match.id = invalidation.affected_match_id)
               AS preserved_comment_count
      FROM engine_bracket_resolution_invalidations invalidation
      WHERE invalidation.tournament_id = $1::uuid
    `, [fixture.tournamentId]);
    expect(invalidation.rows[0]).toEqual({
      affected_match_id: detachedMatchId,
      active_resolution_count: "0",
      preserved_match_count: "1",
      preserved_comment_count: "1"
    });

    const restoredFirstResolution = await applyOperator(repository, progression, {
      matchId: firstPlayedNode.match.id,
      matchRowVersion: 3,
      commandType: "forfeit",
      winnerTeamId: firstWinner,
      reason: "Fixture restores the first-round result",
      adminId: fixture.adminId,
      occurredAt: isoMinute(46)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const restoredNextNode = progression.activeBracket?.rounds
      .flatMap((round) => round.matches)
      .find((match) => match.bracketMatchId === nextNodeId);
    expect(restoredNextNode).toMatchObject({
      playable: true,
      matchId: detachedMatchId,
      instanceNumber: 1,
      participantsFrozen: false,
      participantTeamIds: [firstWinner, secondWinner],
      matchStatus: "scheduled"
    });
    const playoffSequences = await database.query<{ sequence: number }>(`
      SELECT sequence
      FROM engine_matches
      WHERE tournament_id = $1::uuid AND stage = 'playoffs'
      ORDER BY sequence
    `, [fixture.tournamentId]);
    expect(playoffSequences.rows.map((row) => row.sequence)).toEqual([4, 5, 8, 9]);

    const restoredMatchId = restoredNextNode?.matchId;
    const nextWinner = restoredNextNode?.slots[0]?.teamId;
    if (restoredMatchId === undefined || nextWinner === undefined) {
      throw new Error("Expected restored next-match participants.");
    }
    await applyOperator(repository, progression, {
      matchId: restoredMatchId,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: nextWinner,
      reason: "Fixture freezes dependent semifinal",
      adminId: fixture.adminId,
      occurredAt: isoMinute(47)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const sameWinnerPreview = await repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: restoredFirstResolution.activation.matchRowVersion,
      commandType: "forfeit",
      winnerTeamId: firstWinner,
      reason: "Fixture preserves the resolved winner"
    });
    expect(sameWinnerPreview.requiresCascade).toBe(false);
    const sameWinnerResult = await applyOperator(repository, progression, {
      matchId: firstPlayedNode.match.id,
      matchRowVersion: restoredFirstResolution.activation.matchRowVersion,
      commandType: "forfeit",
      winnerTeamId: firstWinner,
      reason: "Fixture preserves the resolved winner",
      adminId: fixture.adminId,
      occurredAt: isoMinute(48)
    });
    const sourceMatchRowVersion = sameWinnerResult.activation.matchRowVersion;
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );

    const losingTeam = firstPlayedNode.slots[1]?.teamId;
    if (losingTeam === undefined) throw new Error("Expected first-round loser.");
    const correctionPreview = await repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: sourceMatchRowVersion,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture corrected first-round winner"
    });
    expect(correctionPreview.requiresCascade).toBe(true);
    const activeBefore = await activeRevisionId(database, firstPlayedNode.match.id);
    await expect(repository.recordOperatorMatchResolution({
      commandId: randomUUID(),
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: sourceMatchRowVersion,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture corrected first-round winner",
      revisionId: parseStableUuid(randomUUID(), "match_revision"),
      revisionPublicKey: `operator-correction-${randomUUID()}`,
      eventId: randomUUID(),
      rulesVersion: 1,
      confirmationDigest: correctionPreview.confirmationDigest,
      actorId: fixture.adminId,
      occurredAt: isoMinute(48),
      writerLeaseExpiresAt: isoMinute(53)
    })).rejects.toThrow(/replacement|cascade|started/i);
    expect(await activeRevisionId(database, firstPlayedNode.match.id)).toBe(activeBefore);

    await expect(repository.recordOperatorMatchResolution({
      commandId: randomUUID(),
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: sourceMatchRowVersion,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture corrected first-round winner",
      revisionId: parseStableUuid(randomUUID(), "match_revision"),
      revisionPublicKey: `operator-stale-${randomUUID()}`,
      eventId: randomUUID(),
      rulesVersion: 1,
      confirmationDigest: "0".repeat(64),
      actorId: fixture.adminId,
      occurredAt: isoMinute(49),
      writerLeaseExpiresAt: isoMinute(54)
    })).rejects.toThrow(/confirmation/i);
    expect(await activeRevisionId(database, firstPlayedNode.match.id)).toBe(activeBefore);

    await expect(repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: fixture.podMatches[0]!.matchId,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: 2,
      commandType: "postpone",
      reason: "Forbidden correction after publication"
    })).rejects.toThrow(/lifecycle/i);

    const otherSemifinal = progression.activeBracket?.rounds[1]?.matches[1];
    const otherSemifinalWinner = otherSemifinal?.slots[0]?.teamId;
    if (otherSemifinal?.matchId === undefined || otherSemifinalWinner === undefined) {
      throw new Error("Expected the structural-bye semifinal match.");
    }
    await applyOperator(repository, progression, {
      matchId: otherSemifinal.matchId,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: otherSemifinalWinner,
      reason: "Fixture resolves the other semifinal",
      adminId: fixture.adminId,
      occurredAt: isoMinute(50)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const championship = progression.activeBracket?.rounds[2]?.matches[0];
    const firstChampion = championship?.slots[0]?.teamId;
    if (championship?.matchId === undefined || firstChampion === undefined) {
      throw new Error("Expected a playable championship.");
    }
    await applyOperator(repository, progression, {
      matchId: championship.matchId,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: firstChampion,
      reason: "Fixture completes the championship",
      adminId: fixture.adminId,
      occurredAt: isoMinute(51)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("completed");
    expect(progression.activeBracket?.status).toBe("completed");

    const sourceResolutionId = progression.activeBracket?.rounds[0]?.matches[0]
      ?.resolutionId;
    if (sourceResolutionId === undefined) {
      throw new Error("Expected the active corrected source resolution.");
    }
    const cascadePreview = await repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: sourceMatchRowVersion,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture atomically replaces started downstream matches"
    });
    expect(cascadePreview.requiresCascade).toBe(true);
    const replacementSemifinalId = createStablePlayoffMatchInstanceId({
      tournamentId: fixture.tournamentId,
      bracketMatchId: nextNodeId,
      instanceNumber: 2
    });
    const pendingChampionshipId = createStablePlayoffMatchInstanceId({
      tournamentId: fixture.tournamentId,
      bracketMatchId: championship.bracketMatchId,
      instanceNumber: 2
    });
    const cascadeRevisionId = parseStableUuid(randomUUID(), "match_revision");
    const cascadeReplacements = [{
      replacementId: randomUUID(),
      bracketMatchId: nextNodeId,
      previousMatchId: restoredMatchId,
      reason: "Replace the already-started semifinal",
      match: {
        id: replacementSemifinalId,
        publicKey: replacementSemifinalId,
        sequence: 11,
        metadata: { bracketMatchId: nextNodeId, instanceNumber: 2 },
        slots: [{
          ...winnerSlot(nextNodeId, 1, firstPlayedNode.id),
          teamId: losingTeam
        }, {
          ...winnerSlot(nextNodeId, 2, secondPlayedNode.id),
          teamId: secondWinner
        }]
      }
    }, {
      replacementId: randomUUID(),
      bracketMatchId: championship.bracketMatchId,
      previousMatchId: championship.matchId,
      reason: "Reserve the championship until its corrected source resolves",
      createWhenPlayable: true as const,
      pendingMatch: {
        id: pendingChampionshipId,
        publicKey: pendingChampionshipId,
        sequence: 12,
        metadata: {
          bracketMatchId: championship.bracketMatchId,
          instanceNumber: 2
        }
      }
    }] as const;
    const cascadeInput = {
      commandId: randomUUID(),
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: sourceMatchRowVersion,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture atomically replaces started downstream matches",
      revisionId: cascadeRevisionId,
      revisionPublicKey: `operator-cascade-${randomUUID()}`,
      eventId: randomUUID(),
      rulesVersion: 1,
      confirmationDigest: cascadePreview.confirmationDigest,
      cascadeConfirmationDigest: "9".repeat(64),
      actorId: fixture.adminId,
      occurredAt: isoMinute(52),
      writerLeaseExpiresAt: isoMinute(57),
      previousResolutionId: sourceResolutionId,
      correctedResolutionId: randomUUID(),
      correctedAdvancementId: randomUUID(),
      replacements: cascadeReplacements
    } as const;
    const revisionBeforeCascade = await activeRevisionId(
      database, firstPlayedNode.match.id
    );
    await expect(repository.recordOperatorMatchResolutionWithCascade({
      ...cascadeInput,
      confirmationDigest: "0".repeat(64)
    })).rejects.toThrow(/confirmation/i);
    expect(await activeRevisionId(database, firstPlayedNode.match.id))
      .toBe(revisionBeforeCascade);
    expect((await database.query(`
      SELECT 1 FROM engine_matches WHERE id = $1::uuid
    `, [pendingChampionshipId])).rows).toHaveLength(0);
    const cascade = await repository.recordOperatorMatchResolutionWithCascade(
      cascadeInput
    );
    expect(cascade.replacementMatchIds).toEqual([
      replacementSemifinalId, pendingChampionshipId
    ]);
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("playoffs");
    const replacementSemifinal = progression.activeBracket?.rounds[1]?.matches[0];
    expect(replacementSemifinal).toMatchObject({
      matchId: replacementSemifinalId,
      instanceNumber: 2,
      playable: true,
      participantTeamIds: [losingTeam, secondWinner],
      participantsFrozen: false
    });
    expect(replacementSemifinal?.resolutionId).toBeUndefined();
    expect(progression.activeBracket?.rounds[2]?.matches[0]).toMatchObject({
      playable: false
    });
    expect(progression.activeBracket?.rounds[2]?.matches[0]?.matchId)
      .toBeUndefined();
    expect(progression.activeBracket?.rounds[2]?.matches[0]?.resolutionId)
      .toBeUndefined();
    const cascadeInvalidations = await database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM engine_bracket_resolution_invalidations
      WHERE tournament_id = $1::uuid AND correction_revision_id = $2::uuid
    `, [fixture.tournamentId, cascadeRevisionId]);
    expect(cascadeInvalidations.rows[0]?.count).toBe("2");
    const reserved = await database.query<{
      identity_only: boolean;
      stage: string;
      status: string | null;
    }>(`
      SELECT identity_only, stage, status
      FROM engine_matches WHERE id = $1::uuid
    `, [pendingChampionshipId]);
    expect(reserved.rows[0]).toEqual({
      identity_only: true,
      stage: "legacy_unknown",
      status: null
    });

    await applyOperator(repository, progression, {
      matchId: replacementSemifinalId,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: losingTeam,
      reason: "Fixture resolves the replacement semifinal",
      adminId: fixture.adminId,
      occurredAt: isoMinute(53)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const replacementChampionship = progression.activeBracket?.rounds[2]?.matches[0];
    expect(replacementChampionship).toMatchObject({
      matchId: pendingChampionshipId,
      instanceNumber: 2,
      playable: true,
      participantTeamIds: [losingTeam, otherSemifinalWinner],
      participantsFrozen: false
    });
    if (replacementChampionship?.matchId === undefined) {
      throw new Error("Expected the reserved championship to materialize.");
    }
    const replacementChampionshipResult = await applyOperator(
      repository, progression, {
        matchId: replacementChampionship.matchId,
        matchRowVersion: 1,
        commandType: "forfeit",
        winnerTeamId: losingTeam,
        reason: "Fixture completes the replacement championship",
        adminId: fixture.adminId,
        occurredAt: isoMinute(54)
      }
    );
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("completed");

    const correctedChampionshipResult = await applyOperator(repository, progression, {
      matchId: replacementChampionship.matchId,
      matchRowVersion: replacementChampionshipResult.activation.matchRowVersion,
      commandType: "forfeit",
      winnerTeamId: otherSemifinalWinner,
      reason: "Fixture corrects the completed champion",
      adminId: fixture.adminId,
      occurredAt: isoMinute(55)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("completed");
    expect(progression.activeBracket?.rounds[2]?.matches[0]?.winnerTeamId)
      .toBe(otherSemifinalWinner);

    await applyOperator(repository, progression, {
      matchId: replacementChampionship.matchId,
      matchRowVersion: correctedChampionshipResult.activation.matchRowVersion,
      commandType: "postpone",
      reason: "Fixture reopens a completed championship",
      adminId: fixture.adminId,
      occurredAt: isoMinute(56)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("playoffs");
    expect(progression.activeBracket?.status).toBe("published");
    expect(progression.activeBracket?.rounds[2]?.matches[0]?.winnerTeamId)
      .toBeUndefined();

    await applyOperator(repository, progression, {
      matchId: replacementChampionship.matchId,
      matchRowVersion: correctedChampionshipResult.activation.matchRowVersion + 1,
      commandType: "forfeit",
      winnerTeamId: otherSemifinalWinner,
      reason: "Fixture recompletes the reopened championship",
      adminId: fixture.adminId,
      occurredAt: isoMinute(57)
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("completed");

    const noWinnerSource = progression.activeBracket?.rounds[0]?.matches[0];
    const noWinnerSemifinal = progression.activeBracket?.rounds[1]?.matches[0];
    const noWinnerChampionship = progression.activeBracket?.rounds[2]?.matches[0];
    if (
      noWinnerSource?.resolutionId === undefined ||
      noWinnerSemifinal?.matchId === undefined ||
      noWinnerChampionship?.matchId === undefined
    ) {
      throw new Error("Expected a fully resolved bracket before no-winner cascade.");
    }
    const noWinnerPreview = await repository.previewOperatorMatchResolution({
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: cascade.activation.matchRowVersion,
      commandType: "postpone",
      reason: "Fixture removes the upstream winner"
    });
    expect(noWinnerPreview.requiresCascade).toBe(true);
    expect(noWinnerPreview.proposedWinnerTeamId).toBeUndefined();
    const pendingSemifinalThree = createStablePlayoffMatchInstanceId({
      tournamentId: fixture.tournamentId,
      bracketMatchId: noWinnerSemifinal.bracketMatchId,
      instanceNumber: 3
    });
    const pendingChampionshipThree = createStablePlayoffMatchInstanceId({
      tournamentId: fixture.tournamentId,
      bracketMatchId: noWinnerChampionship.bracketMatchId,
      instanceNumber: 3
    });
    const noWinnerRevisionId = parseStableUuid(randomUUID(), "match_revision");
    const noWinnerCascadeDigest = "6".repeat(64);
    const noWinnerCascade = await repository.recordOperatorMatchResolutionWithCascade({
      commandId: randomUUID(),
      tournamentId: fixture.tournamentId,
      matchId: firstPlayedNode.match.id,
      expectedTournamentRowVersion: progression.rowVersion,
      expectedMatchRowVersion: cascade.activation.matchRowVersion,
      commandType: "postpone",
      reason: "Fixture removes the upstream winner",
      revisionId: noWinnerRevisionId,
      revisionPublicKey: `operator-no-winner-${randomUUID()}`,
      eventId: randomUUID(),
      rulesVersion: 1,
      confirmationDigest: noWinnerPreview.confirmationDigest,
      cascadeConfirmationDigest: noWinnerCascadeDigest,
      actorId: fixture.adminId,
      occurredAt: isoMinute(58),
      writerLeaseExpiresAt: isoMinute(63),
      previousResolutionId: noWinnerSource.resolutionId,
      replacements: [{
        replacementId: randomUUID(),
        bracketMatchId: noWinnerSemifinal.bracketMatchId,
        previousMatchId: noWinnerSemifinal.matchId,
        reason: "Reserve semifinal instance three until source re-resolution",
        createWhenPlayable: true,
        pendingMatch: {
          id: pendingSemifinalThree,
          publicKey: pendingSemifinalThree,
          sequence: 13,
          metadata: {
            bracketMatchId: noWinnerSemifinal.bracketMatchId,
            instanceNumber: 3
          }
        }
      }, {
        replacementId: randomUUID(),
        bracketMatchId: noWinnerChampionship.bracketMatchId,
        previousMatchId: noWinnerChampionship.matchId,
        reason: "Reserve championship instance three until source re-resolution",
        createWhenPlayable: true,
        pendingMatch: {
          id: pendingChampionshipThree,
          publicKey: pendingChampionshipThree,
          sequence: 14,
          metadata: {
            bracketMatchId: noWinnerChampionship.bracketMatchId,
            instanceNumber: 3
          }
        }
      }]
    });
    expect(noWinnerCascade.progression.bracketResolutionId).toBeUndefined();
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("playoffs");
    expect(progression.activeBracket?.rounds[0]?.matches[0]).toMatchObject({
      matchStatus: "postponed"
    });
    expect(progression.activeBracket?.rounds[0]?.matches[0]?.winnerTeamId)
      .toBeUndefined();
    expect(progression.activeBracket?.rounds[0]?.matches[0]?.resolutionId)
      .toBeUndefined();
    for (const node of [
      progression.activeBracket?.rounds[1]?.matches[0],
      progression.activeBracket?.rounds[2]?.matches[0]
    ]) {
      expect(node).toMatchObject({ playable: false });
      expect(node?.matchId).toBeUndefined();
      expect(node?.resolutionId).toBeUndefined();
    }
    const noWinnerInvalidations = await database.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM engine_bracket_resolution_invalidations
      WHERE tournament_id = $1::uuid AND correction_revision_id = $2::uuid
    `, [fixture.tournamentId, noWinnerRevisionId]);
    expect(noWinnerInvalidations.rows[0]?.count).toBe("3");
    const storedCascadeDigest = await database.query<{
      confirmation_digest: string;
      cascade_confirmation_digest: string | null;
    }>(`
      SELECT confirmation_digest, cascade_confirmation_digest
      FROM engine_operator_match_commands
      WHERE revision_id = $1::uuid
    `, [noWinnerRevisionId]);
    expect(storedCascadeDigest.rows[0]).toEqual({
      confirmation_digest: noWinnerPreview.confirmationDigest,
      cascade_confirmation_digest: noWinnerCascadeDigest
    });
  });

  it("auto-completes a one-qualifier structural bracket at publication", async () => {
    const fixture = await seedScheduledPodMatch(
      database, publicTournamentId, { allowByes: true }
    );
    let progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    await applyOperator(repository, progression, {
      matchId: fixture.matchId,
      matchRowVersion: 1,
      commandType: "forfeit",
      winnerTeamId: fixture.teamIds[0],
      reason: "Fixture selects the sole qualifier",
      adminId: fixture.adminId,
      occurredAt: "2035-01-02T00:00:00.000Z"
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    const pod = progression.pods[0];
    if (pod?.activeCalculationId === undefined) {
      throw new Error("Expected finalizable one-qualifier pod standings.");
    }
    await repository.finalizePod({
      tournamentId: fixture.tournamentId,
      podId: fixture.podId,
      expectedTournamentRowVersion: progression.rowVersion,
      calculationId: pod.activeCalculationId,
      finalizationId: randomUUID(),
      reason: "Fixture finalizes the sole qualifier",
      confirmationDigest: "7".repeat(64),
      administratorId: fixture.adminId,
      occurredAt: "2035-01-02T00:01:00.000Z"
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("seeding_review");
    expect(progression.effectiveSeeds).toHaveLength(1);
    const workbookId = await seedCumulativeWorkbook(
      database, fixture, progression.rowVersion
    );
    const bracket = createOneQualifierBracket(
      fixture.tournamentId, progression.effectiveSeeds[0]!.teamId
    );
    const publication = await repository.publishBracket({
      publicationId: randomUUID(),
      tournamentId: fixture.tournamentId,
      expectedTournamentRowVersion: progression.rowVersion,
      seedCalculationId: progression.activeSeedCalculationId as string,
      cumulativeWorkbookId: workbookId,
      bracket,
      confirmationDigest: "8".repeat(64),
      administratorId: fixture.adminId,
      occurredAt: "2035-01-02T00:02:00.000Z"
    });
    expect(publication).toMatchObject({
      lifecycle: "completed",
      playableMatchIds: []
    });
    progression = requireProgression(
      await repository.readProgression(fixture.tournamentId)
    );
    expect(progression.lifecycle).toBe("completed");
    expect(progression.activeBracket?.status).toBe("completed");
    expect(progression.activeBracket?.rounds[0]?.matches[0]).toMatchObject({
      playable: false,
      winnerTeamId: fixture.teamIds[0]
    });
  });

  it("rejects same-round and backward bracket winner sources at the SQL boundary", async () => {
    const fixture = await seedScheduledPodMatch(database, publicTournamentId);
    const bracketId = randomUUID();
    const firstRoundId = randomUUID();
    const laterRoundId = randomUUID();
    const destinationId = randomUUID();
    const sameRoundSourceId = randomUUID();
    const laterRoundSourceId = randomUUID();
    await database.query(`
      INSERT INTO engine_brackets (
        id, tournament_id, public_key, name, bracket_size,
        placement_policy, status, created_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'Boundary Bracket', 4,
        'standard_mirrored_seeded', 'draft', $4
      )
    `, [bracketId, fixture.tournamentId, `boundary-${bracketId}`, isoMinute(1)]);
    for (const [roundId, sequence] of [
      [firstRoundId, 1], [laterRoundId, 2]
    ] as const) {
      await database.query(`
        INSERT INTO engine_bracket_rounds (
          id, tournament_id, bracket_id, public_key, name, sequence
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
      `, [
        roundId, fixture.tournamentId, bracketId,
        `boundary-round-${sequence}`, `Boundary Round ${sequence}`, sequence
      ]);
    }
    for (const [matchId, roundId, sequence] of [
      [destinationId, firstRoundId, 1],
      [sameRoundSourceId, firstRoundId, 2],
      [laterRoundSourceId, laterRoundId, 1]
    ] as const) {
      await database.query(`
        INSERT INTO engine_bracket_matches (
          id, tournament_id, bracket_id, round_id, match_id,
          public_key, sequence, playable
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL, $5, $6, false
        )
      `, [
        matchId, fixture.tournamentId, bracketId, roundId,
        `boundary-node-${matchId}`, sequence
      ]);
    }
    for (const sourceId of [sameRoundSourceId, laterRoundSourceId]) {
      await expect(database.query(`
        INSERT INTO engine_bracket_slots (
          id, tournament_id, bracket_match_id, public_key,
          slot_number, source_type, source_bracket_match_id
        ) VALUES (
          $1::uuid, $2::uuid, $3::uuid, $4, 1, 'match_winner', $5::uuid
        )
      `, [
        randomUUID(), fixture.tournamentId, destinationId,
        `invalid-source-${sourceId}`, sourceId
      ])).rejects.toThrow(/prior round/i);
    }
    await database.query(`
      INSERT INTO engine_bracket_slots (
        id, tournament_id, bracket_match_id, public_key,
        slot_number, source_type, source_bracket_match_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 'match_winner', $5::uuid
      )
    `, [
      randomUUID(), fixture.tournamentId, laterRoundSourceId,
      `valid-source-${destinationId}`, destinationId
    ]);
    const secondLaterDestinationId = randomUUID();
    await database.query(`
      INSERT INTO engine_bracket_matches (
        id, tournament_id, bracket_id, round_id, match_id,
        public_key, sequence, playable
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, NULL, $5, 2, false
      )
    `, [
      secondLaterDestinationId, fixture.tournamentId, bracketId, laterRoundId,
      `boundary-node-${secondLaterDestinationId}`
    ]);
    await expect(database.query(`
      INSERT INTO engine_bracket_slots (
        id, tournament_id, bracket_match_id, public_key,
        slot_number, source_type, source_bracket_match_id
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, 1, 'match_winner', $5::uuid
      )
    `, [
      randomUUID(), fixture.tournamentId, secondLaterDestinationId,
      `fanout-source-${destinationId}`, destinationId
    ])).rejects.toThrow(/duplicate key|one_consumer/i);
  });
});

async function seedScheduledPodMatch(
  database: PostgresDatabase,
  publicTournamentId: string,
  options: { readonly allowByes?: boolean } = {}
) {
  const [tournament, pod, teamOne, teamTwo, playerOne, playerTwo,
    membershipOne, membershipTwo, match] = Array.from(
    { length: 9 }, () => randomUUID()
  );
  const now = "2035-01-01T00:00:00.000Z";
  const admin = randomUUID();
  await database.query(`
    INSERT INTO tournaments (id, game_type, year, name)
    VALUES ($1, 'ruski', 2035, 'Progression Integration')
  `, [publicTournamentId]);
  await database.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, $2, $2, 'Progression Admin')
  `, [admin, `progression-${admin}`]);
  await database.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, setup_published_at, created_at, updated_at
    ) VALUES (
      $1::uuid, $2, 'ruski', 2035, 'Progression Integration',
      'draft_setup', 'private', 1, NULL, $3, $3
    )
  `, [tournament, publicTournamentId, now]);
  await database.query(`
    INSERT INTO engine_tournament_configurations (
      tournament_id, format_version, format_type, team_count, pod_count,
      pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
      bracket_size, allow_byes, standings_rules, locked_at
    ) VALUES (
      $1::uuid, 1, 'pod_and_single_elimination', 2, 1,
      ARRAY[2]::smallint[], 1, 1, 1, 2, $3,
      ARRAY['record','cupDifferential','teamShootingPercentage',
            'administratorResolution']::text[], $2
    )
  `, [tournament, now, options.allowByes ?? true]);
  await database.query(`
    INSERT INTO engine_pods (
      id, tournament_id, public_key, name, normalized_name, sequence
    ) VALUES ($1::uuid, $2::uuid, 'pod-one', 'Pod One', 'pod one', 1)
  `, [pod, tournament]);
  for (const [index, team] of [teamOne, teamTwo].entries()) {
    await database.query(`
      INSERT INTO engine_teams (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
    `, [
      team, tournament, `team-${index + 1}`,
      `Team ${index + 1}`, `team ${index + 1}`, index + 1
    ]);
    await database.query(`
      INSERT INTO engine_pod_teams (
        tournament_id, pod_id, team_id, initial_seed, assigned_at
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
    `, [tournament, pod, team, index + 1, now]);
  }
  for (const [index, values] of [
    [playerOne, membershipOne, teamOne],
    [playerTwo, membershipTwo, teamTwo]
  ].entries()) {
    const [player, membership, team] = values;
    await database.query(`
      INSERT INTO engine_players (
        id, tournament_id, public_key, display_name, created_at
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
    `, [player, tournament, `player-${index + 1}`, `Player ${index + 1}`, now]);
    await database.query(`
      INSERT INTO engine_roster_memberships (
        id, tournament_id, public_key, team_id, player_id, roster_slot,
        opened_at, opened_by
      ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 1, $6, 'fixture')
    `, [membership, tournament, `membership-${index + 1}`, team, player, now]);
  }
  await database.query(`
    INSERT INTO match_identities (match_id, tournament_id, created_at)
    VALUES ('progression-match', $1, $2)
  `, [publicTournamentId, now]);
  await database.query(`
    INSERT INTO engine_matches (
      id, tournament_id, public_key, stage, pod_id, sequence,
      status, score_availability, row_version, created_at, updated_at
    ) VALUES (
      $1::uuid, $2::uuid, 'progression-match', 'pod_play', $3::uuid, 1,
      'scheduled', 'not_started', 1, $4, $4
    )
  `, [match, tournament, pod, now]);
  for (const [index, team] of [teamOne, teamTwo].entries()) {
    await database.query(`
      INSERT INTO engine_match_slots (
        tournament_id, match_id, slot_number, source_type, team_id
      ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
    `, [tournament, match, index + 1, team]);
  }
  await publishFixtureSetup(database, tournament, now);
  return {
    tournamentId: parseStableUuid(tournament, "tournament"),
    podId: parseStableUuid(pod, "pod"),
    matchId: parseStableUuid(match, "match"),
    teamIds: [
      parseStableUuid(teamOne, "tournament_team"),
      parseStableUuid(teamTwo, "tournament_team")
    ] as const,
    adminId: admin
  };
}

async function seedGeneralizedProgression(
  database: PostgresDatabase,
  publicTournamentId: string
) {
  const tournamentId = parseStableUuid(randomUUID(), "tournament");
  const adminId = randomUUID();
  const now = "2036-01-01T00:00:00.000Z";
  await database.query(`
    INSERT INTO tournaments (id, game_type, year, name)
    VALUES ($1, 'ruski', 2036, 'Generalized Progression')
  `, [publicTournamentId]);
  await database.query(`
    INSERT INTO admin_accounts (
      id, login_name, normalized_login_name, display_name
    ) VALUES ($1::uuid, $2, $2, 'Generalized Admin')
  `, [adminId, `generalized-${adminId}`]);
  await database.query(`
    INSERT INTO engine_tournaments (
      id, public_key, game_type, year, name, lifecycle, visibility,
      row_version, setup_published_at, created_at, updated_at
    ) VALUES (
      $1::uuid, $2, 'ruski', 2036, 'Generalized Progression',
      'draft_setup', 'private', 1, NULL, $3, $3
    )
  `, [tournamentId, publicTournamentId, now]);
  await database.query(`
    INSERT INTO engine_tournament_configurations (
      tournament_id, format_version, format_type, team_count, pod_count,
      pod_sizes, players_per_team, games_per_pair, qualifiers_per_pod,
      bracket_size, allow_byes, standings_rules, locked_at
    ) VALUES (
      $1::uuid, 1, 'pod_and_single_elimination', 6, 3,
      ARRAY[2,2,2]::smallint[], 1, 1, 2, 8, true,
      ARRAY['record','cupDifferential','teamShootingPercentage',
            'administratorResolution']::text[], $2
    )
  `, [tournamentId, now]);
  const podMatches: {
    podIndex: number;
    matchId: ReturnType<typeof parseStableUuid<"match">>;
    teamIds: readonly [TournamentTeamId, TournamentTeamId];
  }[] = [];
  const teamIds: TournamentTeamId[] = [];
  for (let podIndex = 0; podIndex < 3; podIndex += 1) {
    const podId = parseStableUuid(randomUUID(), "pod");
    await database.query(`
      INSERT INTO engine_pods (
        id, tournament_id, public_key, name, normalized_name, sequence
      ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
    `, [
      podId, tournamentId, `pod-${podIndex + 1}`,
      `Pod ${podIndex + 1}`, `pod ${podIndex + 1}`, podIndex + 1
    ]);
    const podTeamIds: TournamentTeamId[] = [];
    for (let slot = 0; slot < 2; slot += 1) {
      const sequence = podIndex * 2 + slot + 1;
      const teamId = parseStableUuid(randomUUID(), "tournament_team");
      const playerId = parseStableUuid(randomUUID(), "tournament_player");
      const membershipId = parseStableUuid(randomUUID(), "roster_membership");
      teamIds.push(teamId);
      podTeamIds.push(teamId);
      await database.query(`
        INSERT INTO engine_teams (
          id, tournament_id, public_key, name, normalized_name, sequence
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
      `, [
        teamId, tournamentId, `team-${sequence}`,
        `Team ${sequence}`, `team ${sequence}`, sequence
      ]);
      await database.query(`
        INSERT INTO engine_pod_teams (
          tournament_id, pod_id, team_id, initial_seed, assigned_at
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5)
      `, [tournamentId, podId, teamId, slot + 1, now]);
      await database.query(`
        INSERT INTO engine_players (
          id, tournament_id, public_key, display_name, created_at
        ) VALUES ($1::uuid, $2::uuid, $3, $4, $5)
      `, [playerId, tournamentId, `player-${sequence}`, `Player ${sequence}`, now]);
      await database.query(`
        INSERT INTO engine_roster_memberships (
          id, tournament_id, public_key, team_id, player_id, roster_slot,
          opened_at, opened_by
        ) VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 1, $6, 'fixture')
      `, [
        membershipId, tournamentId, `membership-${sequence}`,
        teamId, playerId, now
      ]);
    }
    const matchId = parseStableUuid(randomUUID(), "match");
    const matchPublicKey = `pod-match-${podIndex + 1}`;
    await database.query(`
      INSERT INTO match_identities (match_id, tournament_id, created_at)
      VALUES ($1, $2, $3)
    `, [matchPublicKey, publicTournamentId, now]);
    await database.query(`
      INSERT INTO engine_matches (
        id, tournament_id, public_key, stage, pod_id, sequence,
        status, score_availability, row_version, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, 'pod_play', $4::uuid, $5,
        'scheduled', 'not_started', 1, $6, $6
      )
    `, [matchId, tournamentId, matchPublicKey, podId, podIndex + 1, now]);
    for (const [slot, teamId] of podTeamIds.entries()) {
      await database.query(`
        INSERT INTO engine_match_slots (
          tournament_id, match_id, slot_number, source_type, team_id
        ) VALUES ($1::uuid, $2::uuid, $3, 'team', $4::uuid)
      `, [tournamentId, matchId, slot + 1, teamId]);
    }
    podMatches.push({
      podIndex,
      matchId,
      teamIds: [podTeamIds[0]!, podTeamIds[1]!]
    });
  }
  await publishFixtureSetup(database, tournamentId, now);
  return { tournamentId, adminId, teamIds, podMatches, publicTournamentId };
}

async function publishFixtureSetup(
  database: PostgresDatabase,
  tournamentId: TournamentId | string,
  occurredAt: string
): Promise<void> {
  await database.query(`
    UPDATE engine_tournaments
    SET lifecycle = 'setup_published', setup_published_at = $2, updated_at = $2
    WHERE id = $1::uuid
  `, [tournamentId, occurredAt]);
  await database.query(`
    UPDATE engine_tournaments
    SET lifecycle = 'pod_play', updated_at = $2
    WHERE id = $1::uuid
  `, [tournamentId, occurredAt]);
}

async function applyOperator(
  repository: PostgresTournamentProgressionRepository,
  progression: TournamentProgressionRecord,
  input: {
    matchId: ReturnType<typeof parseStableUuid<"match">>;
    matchRowVersion: number;
    commandType: "cancel" | "forfeit" | "postpone";
    winnerTeamId?: TournamentTeamId;
    reason: string;
    adminId: string;
    occurredAt: string;
  }
) {
  const preview = await repository.previewOperatorMatchResolution({
    tournamentId: progression.tournamentId,
    matchId: input.matchId,
    expectedTournamentRowVersion: progression.rowVersion,
    expectedMatchRowVersion: input.matchRowVersion,
    commandType: input.commandType,
    ...(input.winnerTeamId === undefined ? {} : {
      winnerTeamId: input.winnerTeamId
    }),
    reason: input.reason
  });
  return repository.recordOperatorMatchResolution({
    commandId: randomUUID(),
    tournamentId: progression.tournamentId,
    matchId: input.matchId,
    expectedTournamentRowVersion: progression.rowVersion,
    expectedMatchRowVersion: input.matchRowVersion,
    commandType: input.commandType,
    ...(input.winnerTeamId === undefined ? {} : {
      winnerTeamId: input.winnerTeamId
    }),
    reason: input.reason,
    revisionId: parseStableUuid(randomUUID(), "match_revision"),
    revisionPublicKey: `operator-${input.commandType}-${randomUUID()}`,
    eventId: randomUUID(),
    rulesVersion: 1,
    confirmationDigest: preview.confirmationDigest,
    actorId: input.adminId,
    occurredAt: input.occurredAt,
    writerLeaseExpiresAt: new Date(
      Date.parse(input.occurredAt) + 5 * 60 * 1000
    ).toISOString()
  });
}

async function seedCumulativeWorkbook(
  database: PostgresDatabase,
  fixture: {
    readonly tournamentId: TournamentId;
    readonly adminId: string;
  },
  tournamentRowVersion: number
): Promise<string> {
  const workbookId = randomUUID();
  await database.query(`
    INSERT INTO engine_generated_workbooks (
      id, tournament_id, generation_revision, workbook_schema_version,
      generation_kind, source_tournament_row_version, source_digest,
      artifact_digest, artifact_size_bytes, artifact, filename,
      generated_by_admin_id, generated_at
    ) VALUES (
      $1::uuid, $2::uuid, 1, 1, 'playoffs_cumulative', $3,
      $4, $5, 1, decode('00','hex'), 'playoffs-cumulative.xlsx',
      $6::uuid, $7
    )
  `, [
    workbookId, fixture.tournamentId, tournamentRowVersion,
    "1".repeat(64), "2".repeat(64), fixture.adminId, isoMinute(42)
  ]);
  return workbookId;
}

function createOneQualifierBracket(
  tournamentId: TournamentId,
  qualifierTeamId: TournamentTeamId
) {
  const bracketId = createSingleEliminationBracketId(tournamentId);
  const roundId = createBracketRoundId(bracketId, 1);
  const matchId = createBracketMatchId(bracketId, 1, 1);
  return {
    id: bracketId,
    publicKey: `bracket-${bracketId}`,
    name: "One Qualifier Structural Bracket",
    bracketSize: 2,
    rounds: [bracketRound(roundId, 1, "Championship", [
      structuralByeNode(
        tournamentId, matchId, roundId, 1, qualifierTeamId, 1, 2
      )
    ])]
  };
}

function createEightSlotBracket(
  tournamentId: TournamentId,
  progression: TournamentProgressionRecord
) {
  const bracketId = createSingleEliminationBracketId(tournamentId);
  const teamsBySeed = new Map(
    progression.effectiveSeeds.map((row) => [row.effectiveSeed, row.teamId])
  );
  const roundIds = [1, 2, 3].map((round) =>
    createBracketRoundId(bracketId, round)
  );
  const roundOneIds = [1, 2, 3, 4].map((position) =>
    createBracketMatchId(bracketId, 1, position)
  );
  const roundTwoIds = [1, 2].map((position) =>
    createBracketMatchId(bracketId, 2, position)
  );
  const finalId = createBracketMatchId(bracketId, 3, 1);
  const roundOne = [
    playableNode(tournamentId, roundOneIds[0]!, roundIds[0]!, 1,
      seededTeam(teamsBySeed, 1), 1, seededTeam(teamsBySeed, 6), 6),
    playableNode(tournamentId, roundOneIds[1]!, roundIds[0]!, 2,
      seededTeam(teamsBySeed, 4), 4, seededTeam(teamsBySeed, 5), 5),
    structuralByeNode(tournamentId, roundOneIds[2]!, roundIds[0]!, 3,
      seededTeam(teamsBySeed, 2), 2, 7),
    structuralByeNode(tournamentId, roundOneIds[3]!, roundIds[0]!, 4,
      seededTeam(teamsBySeed, 3), 3, 8)
  ];
  const roundTwo = [
    futureNode(roundTwoIds[0]!, roundIds[1]!, 1, roundOneIds[0]!, roundOneIds[1]!),
    futureNode(roundTwoIds[1]!, roundIds[1]!, 2, roundOneIds[2]!, roundOneIds[3]!)
  ];
  const final = futureNode(finalId, roundIds[2]!, 1, roundTwoIds[0]!, roundTwoIds[1]!);
  const rounds: readonly BracketRoundInput[] = [
    bracketRound(roundIds[0]!, 1, "Round of 8", roundOne),
    bracketRound(roundIds[1]!, 2, "Semifinals", roundTwo),
    bracketRound(roundIds[2]!, 3, "Championship", [final])
  ];
  return {
    id: bracketId,
    publicKey: `bracket-${bracketId}`,
    name: "Generalized Eight Slot Bracket",
    bracketSize: 8,
    rounds
  };
}

function bracketRound(
  id: ReturnType<typeof createBracketRoundId>,
  sequence: number,
  name: string,
  matches: readonly BracketNodeInput[]
): BracketRoundInput {
  return { id, publicKey: `round-${sequence}`, name, sequence, matches };
}

function structuralByeNode(
  tournamentId: TournamentId,
  id: BracketMatchId,
  roundId: ReturnType<typeof createBracketRoundId>,
  sequence: number,
  teamId: TournamentTeamId,
  seed: number,
  byeSeed: number
): BracketNodeInput {
  void tournamentId;
  void roundId;
  return {
    id,
    publicKey: `node-${id}`,
    sequence,
    playable: false,
    slots: [teamSlot(id, 1, teamId, seed), byeSlot(id, 2, byeSeed)]
  };
}

function playableNode(
  tournamentId: TournamentId,
  id: BracketMatchId,
  roundId: ReturnType<typeof createBracketRoundId>,
  sequence: number,
  teamOneId: TournamentTeamId,
  seedOne: number,
  teamTwoId: TournamentTeamId,
  seedTwo: number
): BracketNodeInput {
  void roundId;
  const slots = [
    teamSlot(id, 1, teamOneId, seedOne),
    teamSlot(id, 2, teamTwoId, seedTwo)
  ] as const;
  const matchId = createStablePlayoffMatchInstanceId({
    tournamentId, bracketMatchId: id, instanceNumber: 1
  });
  const match: PlayoffMatchInput = {
    id: matchId,
    publicKey: matchId,
    sequence,
    slots
  };
  return { id, publicKey: `node-${id}`, sequence, playable: true, match, slots };
}

function futureNode(
  id: BracketMatchId,
  roundId: ReturnType<typeof createBracketRoundId>,
  sequence: number,
  sourceOne: BracketMatchId,
  sourceTwo: BracketMatchId
): BracketNodeInput {
  void roundId;
  return {
    id,
    publicKey: `node-${id}`,
    sequence,
    playable: false,
    slots: [winnerSlot(id, 1, sourceOne), winnerSlot(id, 2, sourceTwo)]
  };
}

function teamSlot(
  bracketMatchId: BracketMatchId,
  slotNumber: 1 | 2,
  teamId: TournamentTeamId,
  seed: number
): BracketSlotInput {
  return {
    id: createBracketSlotId(bracketMatchId, slotNumber),
    publicKey: `slot-${slotNumber}`,
    slotNumber,
    sourceType: "team",
    teamId,
    seed
  };
}

function byeSlot(
  bracketMatchId: BracketMatchId,
  slotNumber: 1 | 2,
  seed: number
): BracketSlotInput {
  return {
    id: createBracketSlotId(bracketMatchId, slotNumber),
    publicKey: `slot-${slotNumber}`,
    slotNumber,
    sourceType: "bye",
    seed
  };
}

function winnerSlot(
  bracketMatchId: BracketMatchId,
  slotNumber: 1 | 2,
  sourceBracketMatchId: BracketMatchId
): BracketSlotInput {
  return {
    id: createBracketSlotId(bracketMatchId, slotNumber),
    publicKey: `slot-${slotNumber}`,
    slotNumber,
    sourceType: "match_winner",
    sourceBracketMatchId
  };
}

function seededTeam(
  teamsBySeed: ReadonlyMap<number, TournamentTeamId>,
  seed: number
): TournamentTeamId {
  const teamId = teamsBySeed.get(seed);
  if (teamId === undefined) throw new Error(`Missing effective seed ${seed}.`);
  return teamId;
}

function requireProgression(
  progression: TournamentProgressionRecord | null
): TournamentProgressionRecord {
  if (progression === null) throw new Error("Tournament progression is missing.");
  return progression;
}

async function activeRevisionId(
  database: PostgresDatabase,
  matchId: ReturnType<typeof parseStableUuid<"match">>
): Promise<string | null> {
  return (await database.query<{ active_revision_id: string | null }>(`
    SELECT active_revision_id::text FROM engine_matches WHERE id = $1::uuid
  `, [matchId])).rows[0]?.active_revision_id ?? null;
}

function isoMinute(minute: number): string {
  return new Date(Date.UTC(2036, 0, 1, 0, minute)).toISOString();
}
