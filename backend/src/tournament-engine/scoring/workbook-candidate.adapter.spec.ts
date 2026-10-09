import {
  MatchRevisionId,
  parseStableUuid,
  StableUuidKind,
  TournamentId
} from "../domain";
import { MatchRevisionEventInput } from "../persistence/contracts";
import {
  digestWorkbookParticipants,
  digestWorkbookValue,
  WorkbookRevisionCandidateInput
} from "../workbook/persistence/contracts";
import {
  CanonicalScoringValidationError,
  materializeWorkbookCandidate,
  previewWorkbookCandidate,
  reduceCanonicalRuskiEvents
} from ".";

describe("canonical workbook candidate scoring", () => {
  it("materializes makes, classified misses, and Vom exactly once in turn order", () => {
    const candidate = fixture(2, [
      marker(2, 10, { make: true }),
      marker(1, 11, { miss: true, tri: true, vom: true }),
      marker(1, 10, { miss: true, guy: true }),
      marker(1, 12, { miss: true, di: true }),
      marker(1, 13, { miss: true, splashOut: true })
    ], { status: "final", availability: "complete" });

    const preview = previewWorkbookCandidate(candidate);

    expect(preview.events.map((event) => ({
      sequence: event.sequence,
      teamId: event.teamId,
      playerId: event.playerId,
      type: event.type,
      outcome: event.shotAttempt?.outcome,
      classification: event.shotAttempt?.classification,
      cupDelta: event.shotAttempt?.cupDelta,
      turn: event.shotAttempt?.turnNumber,
      shotInTurn: event.shotAttempt?.shotInTeamTurn
    }))).toEqual([
      expect.objectContaining({ sequence: 1, type: "shot_attempt", classification: "guy", turn: 1, shotInTurn: 1 }),
      expect.objectContaining({ sequence: 2, type: "shot_attempt", classification: "tri", cupDelta: 3, turn: 1, shotInTurn: 2 }),
      expect.objectContaining({ sequence: 3, type: "vom", outcome: undefined }),
      expect.objectContaining({ sequence: 4, type: "shot_attempt", outcome: "make", cupDelta: 1 }),
      expect.objectContaining({ sequence: 5, type: "shot_attempt", classification: "di", cupDelta: 2, turn: 2 }),
      expect.objectContaining({ sequence: 6, type: "shot_attempt", classification: "splash_out", cupDelta: 0, turn: 2 })
    ]);
    expect(preview.reduction.match).toEqual({
      attempts: 5,
      makes: 1,
      misses: 4,
      shootingPercentage: 0.2,
      splashOuts: 1,
      guys: 1,
      tris: 1,
      dis: 1,
      voms: 1,
      cupsScored: 6
    });
    expect(preview.winnerTeamId).toBe(candidate.teams[0].teamId);
    expect(preview.teams.map((team) => [team.score, team.result]))
      .toEqual([[5, "win"], [1, "loss"]]);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])(
    "maps stable ownership and turn metadata for %i players per team",
    (playersPerTeam) => {
      const candidate = fixture(playersPerTeam, [
        marker(1, 9 + playersPerTeam, { miss: true }),
        marker(1, 10 + playersPerTeam, { make: true }),
        marker(2, 10, { miss: true })
      ]);
      const preview = previewWorkbookCandidate(candidate);
      const firstSideEvents = preview.events.filter((event) =>
        event.teamId === candidate.teams[0].teamId
      );

      expect(firstSideEvents[0]).toMatchObject({
        playerId: candidate.teams[0].players[playersPerTeam - 1].playerId,
        shotAttempt: {
          turnNumber: 1,
          teamTurnOrder: 1,
          shotInTeamTurn: playersPerTeam
        }
      });
      expect(firstSideEvents[1]).toMatchObject({
        playerId: candidate.teams[0].players[0].playerId,
        shotAttempt: { turnNumber: 2, shotInTeamTurn: 1 }
      });
    }
  );

  it.each([
    { miss: true, make: true },
    { make: true, guy: true },
    { miss: true, guy: true, tri: true },
    { di: true }
  ])("rejects invalid marker combination %#", (markers) => {
    expectValidationCode(
      () => previewWorkbookCandidate(fixture(2, [marker(1, 10, markers)])),
      "CANDIDATE_MARKER_COMBINATION_INVALID"
    );
  });

  it("keeps live zero-zero scores available and final empty scores unrecorded", () => {
    const live = previewWorkbookCandidate(fixture(2, []));
    expect(live.status).toBe("in_progress");
    expect(live.scoreAvailability).toBe("partial");
    expect(live.teams.map((team) => team.score)).toEqual([0, 0]);
    expect(live.winnerTeamId).toBeUndefined();

    const unrecorded = previewWorkbookCandidate(fixture(2, [], {
      status: "final",
      availability: "unrecorded"
    }));
    expect(unrecorded.events).toEqual([]);
    expect(unrecorded.teams.map((team) => team.score)).toEqual([undefined, undefined]);
    expect(unrecorded.teams.map((team) => team.result)).toEqual(["pending", "pending"]);
  });

  it("rejects a tied final with a complete score", () => {
    expectValidationCode(
      () => previewWorkbookCandidate(fixture(2, [
        marker(1, 10, { make: true }),
        marker(2, 10, { make: true })
      ], { status: "final", availability: "complete" })),
      "CANDIDATE_FINAL_SCORE_TIED"
    );
  });

  it("strictly rejects participant, row, and envelope tampering", () => {
    const original = fixture(2, [marker(1, 10, { miss: true })]);
    const missingRow = replaceEnvelope(original, {
      rows: (original.envelope.rows as unknown[]).slice(1)
    });
    expectValidationCode(
      () => previewWorkbookCandidate(missingRow),
      "CANDIDATE_ROW_SET_INVALID"
    );

    const rows = [...original.envelope.rows as Array<Record<string, unknown>>];
    rows[0] = { ...rows[0], playerId: rawUuid(999_999) };
    expectValidationCode(
      () => previewWorkbookCandidate(replaceEnvelope(original, { rows })),
      "CANDIDATE_ROW_IDENTITY_MISMATCH"
    );

    expectValidationCode(
      () => previewWorkbookCandidate({
        ...original,
        participantDigest: "0".repeat(64)
      }),
      "CANDIDATE_PARTICIPANT_DIGEST_INVALID"
    );
  });

  it("accepts non-authoritative v2 additions while keeping v1 exact", () => {
    const original = fixture(2, [marker(1, 10, { make: true })]);
    const v1WithFormula = replaceEnvelope(original, {
      formulaObservations: [{ cell: "D3", result: 1 }]
    });
    expectValidationCode(
      () => previewWorkbookCandidate(v1WithFormula),
      "CANDIDATE_V1_FIELD_UNEXPECTED"
    );

    const v2 = replaceEnvelope({ ...original, envelopeSchemaVersion: 2 }, {
      contract: "workbook-match-revision-candidate-v2",
      formulaObservations: [{ cell: "D3", result: 999 }]
    });
    expect(previewWorkbookCandidate(v2).reduction.match.makes).toBe(1);
  });

  it("produces deterministic retries and distinct A-B-A correction identities", () => {
    const candidateA = fixture(2, [marker(1, 10, { miss: true })]);
    const first = materialize(candidateA);
    const retry = materialize(candidateA);
    expect(retry).toEqual(first);

    const candidateB = fixture(2, [marker(1, 10, { make: true })], {
      candidateSequence: 902,
      sourceRevisionNumber: 2,
      previousCandidateId: candidateA.candidateId
    });
    const second = materialize(candidateB, {
      id: first.preview.revisionId,
      revisionNumber: 1
    });
    const candidateAAgain = fixture(2, [marker(1, 10, { miss: true })], {
      candidateSequence: 903,
      sourceRevisionNumber: 3,
      previousCandidateId: candidateB.candidateId
    });
    const third = materialize(candidateAAgain, {
      id: second.preview.revisionId,
      revisionNumber: 2
    });

    expect([first.preview.revisionId, second.preview.revisionId, third.preview.revisionId])
      .toEqual(expect.arrayContaining([
        expect.any(String), expect.any(String), expect.any(String)
      ]));
    expect(new Set([
      first.preview.revisionId,
      second.preview.revisionId,
      third.preview.revisionId
    ]).size).toBe(3);
    expect(third.activation.revision).toMatchObject({
      revisionNumber: 3,
      previousRevisionId: second.preview.revisionId
    });
    expect(third.preview.events[0].id).not.toBe(first.preview.events[0].id);
  });

  it("requires an audited reason when materializing corrections", () => {
    const correction = fixture(2, [marker(1, 10, { make: true })], {
      candidateSequence: 904,
      sourceRevisionNumber: 2,
      previousCandidateId: rawUuid(900),
      reason: "correction"
    });
    expectValidationCode(
      () => materialize(correction, stable(800, "match_revision")),
      "MATERIALIZATION_CORRECTION_REASON_REQUIRED"
    );
    expect(materialize(correction, stable(800, "match_revision"), "Correct row")
      .activation.revision.correctionReason).toBe("Correct row");
  });
});

describe("reduceCanonicalRuskiEvents", () => {
  it("rejects noncanonical cup effects", () => {
    const invalid: MatchRevisionEventInput = {
      id: stable(700, "scoring_event"),
      sequence: 1,
      type: "shot_attempt",
      teamId: stable(10, "tournament_team"),
      playerId: stable(11, "tournament_player"),
      shotAttempt: { outcome: "miss", classification: "tri", cupDelta: 0 }
    };
    expectValidationCode(
      () => reduceCanonicalRuskiEvents([invalid]),
      "CANONICAL_CUP_DELTA_INVALID"
    );
  });
});

interface MarkerInput {
  sideNumber: 1 | 2;
  worksheetRow: number;
  values: Partial<Record<MarkerKey, boolean>>;
}

type MarkerKey = "miss" | "make" | "splashOut" | "guy" | "tri" | "di" | "vom";

interface FixtureOptions {
  status?: "in_progress" | "final";
  availability?: "partial" | "complete" | "unrecorded";
  candidateSequence?: number;
  sourceRevisionNumber?: number;
  previousCandidateId?: string;
  reason?: "initial" | "workbook_update" | "correction";
}

function fixture(
  playersPerTeam: number,
  markerInputs: readonly MarkerInput[],
  options: FixtureOptions = {}
): WorkbookRevisionCandidateInput {
  const tournamentId = rawUuid(1);
  const matchId = rawUuid(2);
  const teams = [1, 2].map((sideNumber) => ({
    sideNumber: sideNumber as 1 | 2,
    teamId: rawUuid(10 + sideNumber),
    displayName: `Team ${sideNumber}`,
    players: Array.from({ length: playersPerTeam }, (_, index) => ({
      playerId: rawUuid(100 + sideNumber * 10 + index),
      rosterMembershipId: rawUuid(200 + sideNumber * 10 + index),
      rosterSlot: index + 1,
      displayName: `Player ${sideNumber}.${index + 1}`
    }))
  })) as WorkbookRevisionCandidateInput["teams"];
  const participants = teams.flatMap((team) => team.players.map((player) => ({
    sideNumber: team.sideNumber,
    teamId: team.teamId,
    playerId: player.playerId,
    rosterMembershipId: player.rosterMembershipId,
    rosterSlot: player.rosterSlot,
    displayNameAtImport: player.displayName
  })));
  const markerByRow = new Map(markerInputs.map((input) => [
    `${input.sideNumber}:${input.worksheetRow}`,
    input.values
  ]));
  const rows = ([1, 2] as const).flatMap((sideNumber) =>
    Array.from({ length: 80 }, (_, index) => {
      const worksheetRow = index + 10;
      const rosterSlot = index % playersPerTeam + 1;
      const player = teams[sideNumber - 1].players[rosterSlot - 1];
      return {
        sideNumber,
        worksheetRow,
        shotNumber: Math.floor(index / playersPerTeam) + 1,
        teamId: teams[sideNumber - 1].teamId,
        playerId: player.playerId,
        rosterMembershipId: player.rosterMembershipId,
        rosterSlot,
        markers: markerValues(markerByRow.get(`${sideNumber}:${worksheetRow}`) ?? {})
      };
    })
  );
  const sourceRevisionNumber = options.sourceRevisionNumber ?? 1;
  const candidateId = rawUuid(options.candidateSequence ?? 901);
  const fingerprint = digestWorkbookValue({ markerInputs, candidateId });
  const participantDigest = digestWorkbookParticipants(teams);
  const status = options.status ?? "in_progress";
  const availability = options.availability ?? "partial";
  const reason = options.reason ?? (sourceRevisionNumber === 1 ? "initial" : "workbook_update");
  const envelope = {
    contract: "workbook-match-revision-candidate-v1",
    semanticCandidateId: rawUuid((options.candidateSequence ?? 901) + 1_000),
    tournamentId,
    matchId,
    sourceRevisionNumber,
    previousCandidateId: options.previousCandidateId ?? null,
    fingerprint,
    proposedStatus: status,
    proposedScoreAvailability: availability,
    reason,
    participantDigest,
    participants,
    rows
  };
  return {
    candidateId,
    matchId,
    ...(options.previousCandidateId === undefined
      ? {}
      : { previousAppliedCandidateId: options.previousCandidateId }),
    sourceRevisionNumber,
    fingerprint,
    proposedStatus: status,
    proposedScoreAvailability: availability,
    reason,
    requiresConfirmation: reason === "correction",
    expectedMatchRowVersion: 1,
    expectedSourceStateVersion: sourceRevisionNumber - 1,
    envelopeSchemaVersion: 1,
    envelope,
    envelopeDigest: digestWorkbookValue(envelope),
    participantDigest,
    teams
  };
}

function marker(
  sideNumber: 1 | 2,
  worksheetRow: number,
  values: Partial<Record<MarkerKey, boolean>>
): MarkerInput {
  return { sideNumber, worksheetRow, values };
}

function markerValues(values: Partial<Record<MarkerKey, boolean>>) {
  return {
    miss: values.miss ?? false,
    make: values.make ?? false,
    splashOut: values.splashOut ?? false,
    guy: values.guy ?? false,
    tri: values.tri ?? false,
    di: values.di ?? false,
    vom: values.vom ?? false
  };
}

function replaceEnvelope(
  candidate: WorkbookRevisionCandidateInput,
  patch: Readonly<Record<string, unknown>>
): WorkbookRevisionCandidateInput {
  const envelope = { ...candidate.envelope, ...patch };
  return {
    ...candidate,
    envelope,
    envelopeDigest: digestWorkbookValue(envelope)
  };
}

function materialize(
  candidate: WorkbookRevisionCandidateInput,
  activeRevision?: MatchRevisionId | { id: MatchRevisionId; revisionNumber: number },
  correctionReason?: string
) {
  const active = typeof activeRevision === "string"
    ? { id: activeRevision, revisionNumber: 1 }
    : activeRevision;
  return materializeWorkbookCandidate({
    candidate,
    tournamentId: parseStableUuid(
      String(candidate.envelope.tournamentId),
      "tournament"
    ),
    batchId: rawUuid(500),
    observationId: rawUuid(501),
    actorId: rawUuid(502),
    createdAt: "2027-01-01T00:00:00.000Z",
    confirmationDigest: "a".repeat(64),
    ...(correctionReason === undefined ? {} : { correctionReason }),
    ...(active === undefined ? {} : { activeRevision: active })
  });
}

function expectValidationCode(operation: () => unknown, code: string): void {
  try {
    operation();
    throw new Error("Expected canonical scoring validation to fail.");
  } catch (caught) {
    expect(caught).toBeInstanceOf(CanonicalScoringValidationError);
    expect((caught as CanonicalScoringValidationError).issues.map((issue) => issue.code))
      .toContain(code);
  }
}

function stable<Kind extends StableUuidKind>(sequence: number, kind: Kind) {
  return parseStableUuid(rawUuid(sequence), kind);
}

function rawUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
