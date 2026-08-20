import { createHash } from "node:crypto";

import { Cell, ValueType, Workbook, Worksheet } from "exceljs";

import {
  parseStableUuid,
  RosterMembershipId
} from "../../domain";
import {
  generatePodRoundRobinSchedule
} from "../../scheduling";
import {
  createCompleteMainTournamentSetup,
  createCompleteSmallTournamentSetup,
  createSmallTournamentConfiguration
} from "../../setup/synthetic-tournament-setup.fixture";
import { createMainTournamentConfiguration } from "../../configuration";
import {
  CANONICAL_SCORECARD_METADATA_KEYS,
  CANONICAL_WORKBOOK_SHEETS
} from "../schema";
import { createScheduledScorecardBaselineFingerprint } from "./baseline-fingerprint";
import { generateCanonicalTournamentWorkbook } from "./canonical-workbook.generator";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookTeamInput,
  GeneratedCanonicalWorkbook
} from "./types";

describe("generateCanonicalTournamentWorkbook", () => {
  it("generates the 48-match main workbook with canonical identity metadata", async () => {
    const input = createMainInput();
    const generated = await generateCanonicalTournamentWorkbook(input);
    const workbook = await loadWorkbook(generated);

    expect(generated.sizeBytes).toBe(generated.buffer.byteLength);
    expect(generated.sha256).toBe(
      createHash("sha256").update(generated.buffer).digest("hex")
    );
    expect(generated.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(generated.semanticDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(generated.baselineFingerprints)).toHaveLength(48);
    expect(generated.manifest).toHaveLength(51);
    expect(workbook.worksheets).toHaveLength(51);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      CANONICAL_WORKBOOK_SHEETS.control,
      CANONICAL_WORKBOOK_SHEETS.blankScorecard,
      ...Array.from({ length: 48 }, (_, index) => generated.manifest[index + 2].sheetName),
      CANONICAL_WORKBOOK_SHEETS.metadata
    ]);
    const metadata = requireWorksheet(workbook, CANONICAL_WORKBOOK_SHEETS.metadata);
    expect(metadata.state).toBe("veryHidden");
    expect(metadata.getCell("A1").value).toBe("magic");
    expect(metadata.getCell("B1").value).toBe("ruski-report-canonical-workbook");
    expect(metadata.getCell("B4").value).toBe(input.tournament.id);
    expect(metadata.getCell("B5").value).toBe(input.generation.id);
    expect(metadata.getCell("A11").value).toBe("sheetId");
    expect(metadata.getCell("J12").value).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.getCell("F13").value).toBe(input.matches[0].podId);
    expect(workbook.getWorksheet("Regular Season Standings")).toBeUndefined();
    expect(workbook.getWorksheet("Playoff Bracket (16)")).toBeUndefined();
    const firstMatch = input.matches[0];
    const firstManifest = generated.manifest.find(
      (entry) => entry.sheetKind === "game" && entry.matchId === firstMatch.id
    );
    expect(firstManifest).toMatchObject({
      sheetName: "P01-R01-M01",
      stage: "pod_play",
      podId: firstMatch.podId,
      teamIds: firstMatch.participantTeamIds,
      baselineFingerprint: generated.baselineFingerprints[firstMatch.id]
    });
    const sheet = requireWorksheet(workbook, firstManifest?.sheetName);
    expect(readLocalMetadata(sheet)).toEqual({
      magic: "ruski-report-canonical-workbook",
      workbookSchemaVersion: 1,
      scorecardLayoutVersion: 1,
      tournamentId: input.tournament.id,
      generationId: input.generation.id,
      generationRevision: input.generation.revision,
      generationSourceDigest: input.generation.sourceDigest,
      sheetId: `match:${firstMatch.id}`,
      sheetKind: "game",
      matchId: firstMatch.id,
      stage: "pod_play",
      podId: firstMatch.podId,
      bracketMatchId: null,
      team1Id: firstMatch.participantTeamIds[0],
      team2Id: firstMatch.participantTeamIds[1]
    });
    expect(sheet.getCell("V17").value).toBe("playersPerTeam");
    expect(sheet.getCell("W17").value).toBe(2);
    expect(participantDirectory(sheet)).toHaveLength(4);
    expect(participantDirectory(sheet).map((row) => row.sideNumber)).toEqual([
      1,
      1,
      2,
      2
    ]);
    for (let column = 22; column <= 27; column += 1) {
      expect(sheet.getColumn(column).hidden).toBe(true);
    }
  });

  it("preserves the familiar scorecard layout, formulas, and print behavior", async () => {
    const generated = await generateCanonicalTournamentWorkbook(createSmallInput());
    const workbook = await loadWorkbook(generated);
    const game = requireWorksheet(workbook, "P01-R01-M01");

    expect(game.getCell("B2").value).toBe("SCHEDULED");
    expect(game.getCell("B2").dataValidation).toMatchObject({
      type: "list",
      formulae: ['"SCHEDULED,LIVE GAME,FINAL"']
    });
    expect(game.getCell("B9").value).toBe("Shot");
    expect(game.getCell("J9").value).toBe("Vom");
    expect(game.getCell("K9").value).toBe("Shot");
    expect(game.getCell("S9").value).toBe("Vom");
    expect(game.getCell("B10").value).toBe(1);
    expect(game.getCell("B11").value).toBe(1);
    expect(game.getCell("B88").value).toBe(40);
    expect(game.getCell("B89").value).toBe(40);
    expect(formula(game.getCell("C10"))).toBe('IF($W$20="","",$W$20)');
    expect(formula(game.getCell("C11"))).toBe('IF($W$21="","",$W$21)');
    expect(formula(game.getCell("D3"))).toContain("D$10:D$89");
    expect(formula(game.getCell("D5"))).toBe("IFERROR(E3/(E3+D3),0)");
    expect(formulaResult(game.getCell("D3")) ?? 0).toBe(0);
    expect(formulaResult(game.getCell("D5")) ?? 0).toBe(0);
    expect(fillColor(game.getCell("D10"))).toBe("FFF4CCCC");
    expect(fillColor(game.getCell("E10"))).toBe("FFD9EAD3");
    expect(game.views[0]).toMatchObject({
      state: "frozen",
      ySplit: 9,
      topLeftCell: "A10",
      showGridLines: false
    });
    expect(game.pageSetup).toMatchObject({
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 2,
      printArea: "B1:S89",
      printTitlesRow: "1:9"
    });
    expect(scanFormulaErrors(workbook)).toEqual([]);
  });

  it("creates an unassigned blank with a stable semantic baseline", async () => {
    const input = createSmallInput();
    const generated = await generateCanonicalTournamentWorkbook(input);
    const workbook = await loadWorkbook(generated);
    const blank = requireWorksheet(workbook, CANONICAL_WORKBOOK_SHEETS.blankScorecard);
    const manifest = generated.manifest.find((entry) => entry.sheetKind === "blank");

    expect(manifest?.baselineFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(readLocalMetadata(blank)).toMatchObject({
      sheetId: "blank-scorecard",
      sheetKind: "blank",
      matchId: null,
      stage: null,
      podId: null,
      team1Id: null,
      team2Id: null
    });
    expect(participantDirectory(blank)).toEqual([]);
    expect(blank.getCell("W17").value).toBe(2);
    expect(blank.getCell("W20").value).toBe("Player 1");
    expect(blank.getCell("W28").value).toBe("Player 1");
    expect(formula(blank.getCell("C10"))).toBe('IF($W$20="","",$W$20)');
    expect(formulaResult(blank.getCell("C10"))).toBe("Player 1");
    expect(blank.getCell("B1").value).toBe("UNASSIGNED SCORECARD TEMPLATE");
    expect(blank.getCell("B8").value).toBe("Unassigned left team");
    expect(blank.getCell("K8").value).toBe("Unassigned right team");
  });

  it("produces an identical semantic manifest for the same generation input", async () => {
    const input = createMainInput();
    const first = await generateCanonicalTournamentWorkbook(input);
    const second = await generateCanonicalTournamentWorkbook(input);

    expect(second.manifest).toEqual(first.manifest);
    expect(second.baselineFingerprints).toEqual(first.baselineFingerprints);
    expect(second.semanticDigest).toBe(first.semanticDigest);
    expect(second.sizeBytes).toBeGreaterThan(0);
  });

  it("generates compact deterministic tabs for a small setup", async () => {
    const generated = await generateCanonicalTournamentWorkbook(createSmallInput());
    const workbook = await loadWorkbook(generated);

    expect(generated.manifest.filter((entry) => entry.sheetKind === "game"))
      .toHaveLength(2);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Control",
      "Blank Scorecard",
      "P01-R01-M01",
      "P02-R01-M01",
      "__Ruski Metadata"
    ]);
  });

  it.each([3, 8])(
    "supports a deterministic %i-player scorecard contract",
    async (playersPerTeam) => {
      const input = withPlayersPerTeam(createSmallInput(), playersPerTeam);
      const generated = await generateCanonicalTournamentWorkbook(input);
      const workbook = await loadWorkbook(generated);
      const game = requireWorksheet(workbook, "P01-R01-M01");
      const control = requireWorksheet(workbook, CANONICAL_WORKBOOK_SHEETS.control);

      expect(game.getCell("W17").value).toBe(playersPerTeam);
      expect(game.getCell(`W${19 + playersPerTeam}`).value).toBe(
        `Sanitized Player 1.${playersPerTeam}`
      );
      expect(game.getCell(`W${27 + playersPerTeam}`).value).toBe(
        `Sanitized Player 2.${playersPerTeam}`
      );
      if (playersPerTeam < 8) {
        expect(game.getCell(`W${20 + playersPerTeam}`).value).toBeNull();
        expect(game.getCell(`W${28 + playersPerTeam}`).value).toBeNull();
      }

      const participants = participantDirectory(game);
      expect(participants).toHaveLength(playersPerTeam * 2);
      expect(game.getCell(`X${playersPerTeam}`).value).toBe(1);
      expect(game.getCell("X9").value).toBe(2);
      expect(game.getCell(`X${8 + playersPerTeam}`).value).toBe(2);
      expect(game.getCell("B10").value).toBe(1);
      expect(game.getCell(`B${9 + playersPerTeam}`).value).toBe(1);
      expect(game.getCell(`B${10 + playersPerTeam}`).value).toBe(2);
      expect(formula(game.getCell("C10"))).toBe('IF($W$20="","",$W$20)');
      expect(formula(game.getCell(`C${9 + playersPerTeam}`))).toBe(
        `IF($W$${19 + playersPerTeam}="","",$W$${19 + playersPerTeam})`
      );
      expect(formula(game.getCell(`C${10 + playersPerTeam}`))).toBe(
        'IF($W$20="","",$W$20)'
      );
      expect(game.getCell("B3").value).toBe("Team totals:");
      expect(formula(game.getCell("D3"))).toBe('COUNTIF(D$10:D$89,"<>")');
      expect(String(game.getCell("C5").value)).toContain(
        `Sanitized Player 1.${playersPerTeam}`
      );
      expect(control.getCell(13, 3 + playersPerTeam).value).toBe(
        `Player ${playersPerTeam}`
      );
      expect(scanFormulaErrors(workbook)).toEqual([]);
    }
  );

  it("freezes historical match rosters without rewriting later match identity", async () => {
    const input = createMainInput();
    const historicalMatch = input.matches[0];
    const sharedTeamId = historicalMatch.participantTeamIds[0];
    const laterMatch = input.matches.find(
      (match, index) =>
        index > 0 && match.participantTeamIds.includes(sharedTeamId)
    );
    const sharedTeam = input.teams.find((team) => team.id === sharedTeamId);
    const historicalOpponent = input.teams.find(
      (team) => team.id === historicalMatch.participantTeamIds[1]
    );
    if (laterMatch === undefined || sharedTeam === undefined ||
        historicalOpponent === undefined) {
      throw new Error("Main fixture must contain repeat matches for a team.");
    }
    const currentReplacement = sharedTeam.players[1];
    const historicalPlayer = {
      id: parseStableUuid(
        "00000000-0000-4000-8000-000000090001",
        "tournament_player"
      ),
      rosterMembershipId: parseStableUuid(
        "00000000-0000-4000-8000-000000090002",
        "roster_membership"
      ),
      rosterSlot: 2,
      displayName: "Historical Player"
    } as const;
    const frozenPlayers = [sharedTeam.players[0], historicalPlayer] as const;
    const generated = await generateCanonicalTournamentWorkbook({
      ...input,
      matches: input.matches.map((match) =>
        match.id === historicalMatch.id
          ? {
              ...match,
              participantRosters: [
                { teamId: sharedTeamId, players: frozenPlayers },
                {
                  teamId: historicalOpponent.id,
                  players: historicalOpponent.players
                }
              ]
            }
          : match
      )
    });
    const workbook = await loadWorkbook(generated);
    const historicalSheet = requireWorksheet(
      workbook,
      sheetNameForMatch(generated, historicalMatch.id)
    );
    const laterSheet = requireWorksheet(
      workbook,
      sheetNameForMatch(generated, laterMatch.id)
    );
    const historicalParticipants = participantDirectory(historicalSheet)
      .filter((participant) => participant.teamId === sharedTeamId);
    const laterParticipants = participantDirectory(laterSheet)
      .filter((participant) => participant.teamId === sharedTeamId);
    const historicalManifest = generated.manifest.find((entry) =>
      entry.sheetKind === "game" && entry.matchId === historicalMatch.id
    );

    expect(historicalManifest?.baselineFingerprint).toBe(
      createScheduledScorecardBaselineFingerprint({
        tournamentId: input.tournament.id,
        match: historicalMatch,
        teams: [
          { ...sharedTeam, players: frozenPlayers },
          historicalOpponent
        ]
      })
    );
    expect(historicalParticipants.map((participant) => participant.rosterMembershipId))
      .toContain(historicalPlayer.rosterMembershipId);
    expect(historicalParticipants.map((participant) => participant.rosterMembershipId))
      .not.toContain(currentReplacement.rosterMembershipId);
    expect(laterParticipants.map((participant) => participant.rosterMembershipId))
      .toContain(currentReplacement.rosterMembershipId);
    expect(laterParticipants.map((participant) => participant.rosterMembershipId))
      .not.toContain(historicalPlayer.rosterMembershipId);
    expect(historicalSheet.getCell("W21").value).toBe("Historical Player");
    const laterSideIndex = laterMatch.participantTeamIds.indexOf(sharedTeamId);
    expect(laterSheet.getCell(`W${laterSideIndex === 0 ? 21 : 29}`).value)
      .toBe(currentReplacement.displayName);
  });

  it("keeps maximum-length and non-ASCII display names out of sheet identity", async () => {
    const input = createSmallInput();
    const longName = `Équipe d'été ${"東京".repeat(50)}`;
    const teams = input.teams.map((team, index): CanonicalWorkbookTeamInput => ({
      ...team,
      name: `${longName} ${index + 1}`,
      players: team.players.map((player, playerIndex) => ({
        ...player,
        displayName: `${playerIndex === 0 ? "Zoë O'Connor" : "李 小龍"} ${"é".repeat(70)}`
      }))
    }));
    const generated = await generateCanonicalTournamentWorkbook({
      ...input,
      tournament: { ...input.tournament, name: longName },
      pods: input.pods.map((pod) => ({ ...pod, name: `${pod.name} · Ñandú` })),
      teams
    });
    const workbook = await loadWorkbook(generated);
    const game = requireWorksheet(workbook, "P01-R01-M01");

    expect(workbook.worksheets.every((sheet) => sheet.name.length <= 31)).toBe(true);
    expect(String(game.getCell("B1").value)).toContain("Ñandú");
    expect(game.getCell("B1").alignment?.shrinkToFit).toBe(true);
    expect(game.getCell("C3").value).toContain("Zoë");
    expect(scanFormulaErrors(workbook)).toEqual([]);
  });

  it("rejects draft and identity-inconsistent generation inputs", async () => {
    const draft = createSmallInput();
    await expect(generateCanonicalTournamentWorkbook({
      ...draft,
      tournament: { ...draft.tournament, lifecycle: "draft_setup" }
    })).rejects.toThrow("published tournament");

    const mismatched = createSmallInput();
    await expect(generateCanonicalTournamentWorkbook({
      ...mismatched,
      matches: [{
        ...mismatched.matches[0],
        participantTeamIds: [
          mismatched.matches[0].participantTeamIds[0],
          mismatched.teams.find(
            (team) => team.podId !== mismatched.matches[0].podId
          )?.id ?? mismatched.matches[0].participantTeamIds[1]
        ]
      }]
    })).rejects.toThrow("participants must belong to its pod");

    const tooManyPlayers = withPlayersPerTeam(createSmallInput(), 9);
    await expect(generateCanonicalTournamentWorkbook(tooManyPlayers))
      .rejects.toThrow("between one and eight");

    const inconsistentPlayers = createSmallInput();
    await expect(generateCanonicalTournamentWorkbook({
      ...inconsistentPlayers,
      teams: inconsistentPlayers.teams.map((team, index) =>
        index === 0 ? team : { ...team, players: team.players.slice(0, 1) }
      )
    })).rejects.toThrow("same number of scorecard players");
  });
});

function createMainInput(): CanonicalWorkbookGenerationInput {
  const setup = createCompleteMainTournamentSetup();
  return createInput(
    setup,
    generatePodRoundRobinSchedule(createMainTournamentConfiguration(), setup)
  );
}

function createSmallInput(): CanonicalWorkbookGenerationInput {
  const setup = createCompleteSmallTournamentSetup();
  return createInput(
    setup,
    generatePodRoundRobinSchedule(createSmallTournamentConfiguration(), setup)
  );
}

function createInput(
  setup: ReturnType<typeof createCompleteMainTournamentSetup>,
  matches: ReturnType<typeof generatePodRoundRobinSchedule>
): CanonicalWorkbookGenerationInput {
  const assignmentByTeam = new Map(
    setup.pods.flatMap((pod) => pod.teamAssignments.map((assignment) => [
      assignment.teamId,
      { podId: pod.id, initialSeed: assignment.initialSeed }
    ] as const))
  );
  return {
    generation: {
      id: "00000000-0000-4000-8000-000000009001",
      revision: 1,
      sourceDigest: "a".repeat(64),
      generatedAt: "2026-08-20T12:00:00.000Z"
    },
    tournament: {
      id: setup.tournamentId,
      name: "Sanitized Tournament",
      year: 2027,
      lifecycle: "setup_published"
    },
    pods: setup.pods.map((pod) => ({
      id: pod.id,
      name: pod.name,
      sequence: pod.sequence
    })),
    teams: setup.teams.map((team, teamIndex) => {
      const assignment = assignmentByTeam.get(team.id);
      if (assignment === undefined) {
        throw new Error("Fixture team is missing its pod assignment.");
      }
      return {
        id: team.id,
        name: team.name,
        sequence: teamIndex + 1,
        podId: assignment.podId,
        initialSeed: assignment.initialSeed,
        players: team.playerIds.map((playerId, playerIndex) => ({
          id: playerId,
          rosterMembershipId: membershipId(teamIndex, playerIndex),
          rosterSlot: playerIndex + 1,
          displayName: `Sanitized Player ${teamIndex + 1}.${playerIndex + 1}`
        }))
      };
    }),
    matches
  };
}

function membershipId(
  teamIndex: number,
  playerIndex: number
): RosterMembershipId {
  return parseStableUuid(
    `00000000-0000-4000-8000-${String(20_000 + teamIndex * 2 + playerIndex).padStart(12, "0")}`,
    "roster_membership"
  );
}

function withPlayersPerTeam(
  input: CanonicalWorkbookGenerationInput,
  playersPerTeam: number
): CanonicalWorkbookGenerationInput {
  return {
    ...input,
    teams: input.teams.map((team, teamIndex) => ({
      ...team,
      players: Array.from({ length: playersPerTeam }, (_, playerIndex) =>
        team.players[playerIndex] ?? {
          id: parseStableUuid(
            `00000000-0000-4000-8000-${String(
              300_000 + teamIndex * 10 + playerIndex
            ).padStart(12, "0")}`,
            "tournament_player"
          ),
          rosterMembershipId: parseStableUuid(
            `00000000-0000-4000-8000-${String(
              400_000 + teamIndex * 10 + playerIndex
            ).padStart(12, "0")}`,
            "roster_membership"
          ),
          rosterSlot: playerIndex + 1,
          displayName: `Sanitized Player ${teamIndex + 1}.${playerIndex + 1}`
        }
      )
    }))
  };
}

async function loadWorkbook(
  generated: GeneratedCanonicalWorkbook
): Promise<Workbook> {
  const workbook = new Workbook();
  const bytes = generated.buffer.buffer.slice(
    generated.buffer.byteOffset,
    generated.buffer.byteOffset + generated.buffer.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(bytes);
  return workbook;
}

function requireWorksheet(
  workbook: Workbook,
  name: string | undefined
): Worksheet {
  const worksheet = name === undefined ? undefined : workbook.getWorksheet(name);
  if (worksheet === undefined) {
    throw new Error(`Expected generated worksheet '${name ?? "undefined"}'.`);
  }
  return worksheet;
}

function sheetNameForMatch(
  generated: GeneratedCanonicalWorkbook,
  matchId: string
): string {
  const entry = generated.manifest.find((candidate) =>
    candidate.sheetKind === "game" && candidate.matchId === matchId
  );
  if (entry === undefined) {
    throw new Error(`Expected generated manifest entry for match '${matchId}'.`);
  }
  return entry.sheetName;
}

function readLocalMetadata(
  worksheet: Worksheet
): Record<string, string | number | null> {
  return Object.fromEntries(
    CANONICAL_SCORECARD_METADATA_KEYS.map((key, index) => [
      key,
      worksheet.getCell(`W${index + 1}`).value as string | number | null
    ])
  );
}

function participantDirectory(worksheet: Worksheet): Array<{
  sideNumber: number;
  teamId: string;
  playerId: string;
  rosterMembershipId: string;
}> {
  return Array.from({ length: 16 }, (_, index) => index + 1)
    .flatMap((row) => {
      const sideNumber = worksheet.getCell(`X${row}`).value;
      if (typeof sideNumber !== "number") {
        return [];
      }
      return [{
        sideNumber,
        teamId: String(worksheet.getCell(`Y${row}`).value),
        playerId: String(worksheet.getCell(`Z${row}`).value),
        rosterMembershipId: String(worksheet.getCell(`AA${row}`).value)
      }];
    });
}

function formula(cell: Cell): string | undefined {
  const value = cell.value;
  return value !== null && typeof value === "object" && "formula" in value
    ? value.formula
    : undefined;
}

function formulaResult(cell: Cell): unknown {
  const value = cell.value;
  return value !== null && typeof value === "object" && "result" in value
    ? value.result
    : undefined;
}

function fillColor(cell: Cell): string | undefined {
  const fill = cell.fill;
  return fill.type === "pattern" ? fill.fgColor?.argb : undefined;
}

function scanFormulaErrors(workbook: Workbook): string[] {
  const failures: string[] = [];
  const errorPattern = /#REF!|#DIV\/0!|#VALUE!|#NAME\?|#N\/A/i;
  workbook.eachSheet((worksheet) => {
    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.type !== ValueType.Formula) {
          return;
        }
        const formulaText = formula(cell) ?? "";
        const result = formulaResult(cell);
        if (errorPattern.test(formulaText) ||
            (typeof result === "string" && errorPattern.test(result))) {
          failures.push(`${worksheet.name}!${cell.address}`);
        }
      });
    });
  });
  return failures;
}
