import { Workbook, Worksheet } from "exceljs";

import {
  MatchId,
  PodId,
  parseStableUuid,
  TournamentTeamId
} from "../../../domain";
import {
  CanonicalWorkbookGenerationInput,
  generateCanonicalTournamentWorkbook
} from "../../generation";
import {
  CanonicalWorkbookScope,
  ParsedCanonicalWorkbookManifestEntry,
  WorkbookParticipantIdentity
} from "../types";

export interface SanitizedWorkbookFixture {
  readonly input: CanonicalWorkbookGenerationInput;
  readonly scope: CanonicalWorkbookScope;
  readonly buffer: Buffer;
  readonly matchIds: readonly [MatchId, MatchId];
}

export async function createSanitizedWorkbookFixture(): Promise<SanitizedWorkbookFixture> {
  return createFixture(2);
}

export async function createSanitizedMultiPlayerWorkbookFixture(): Promise<SanitizedWorkbookFixture> {
  return createFixture(8);
}

export async function createSanitizedPlayerCountWorkbookFixture(
  playersPerTeam: number
): Promise<SanitizedWorkbookFixture> {
  return createFixture(playersPerTeam);
}

async function createFixture(playersPerTeam: number): Promise<SanitizedWorkbookFixture> {
  const tournamentId = stable(1, "tournament");
  const podId = stable(2, "pod");
  const teamIds = [
    stable(10, "tournament_team"),
    stable(11, "tournament_team"),
    stable(12, "tournament_team")
  ];
  const teams = teamIds.map((teamId, teamIndex) => ({
    id: teamId,
    name: `Sanitized Team ${teamIndex + 1}`,
    sequence: teamIndex + 1,
    podId,
    initialSeed: teamIndex + 1,
    players: Array.from({ length: playersPerTeam }, (_, index) => index + 1)
      .map((slot) => ({
        id: stable(100 + teamIndex * 8 + slot, "tournament_player"),
        rosterMembershipId: stable(
          200 + teamIndex * 8 + slot,
          "roster_membership"
        ),
        rosterSlot: slot,
        displayName: `Player ${teamIndex + 1}-${slot}`
      }))
  }));
  const matchIds = [stable(20, "match"), stable(21, "match")] as const;
  const matches = [
    podMatch(matchIds[0], podId, 1, teamIds[0], teamIds[1]),
    podMatch(matchIds[1], podId, 2, teamIds[1], teamIds[2])
  ];
  const input: CanonicalWorkbookGenerationInput = {
    generation: {
      id: rawUuid(30),
      revision: 1,
      sourceDigest: "a".repeat(64),
      generatedAt: "2027-01-01T12:00:00.000Z"
    },
    tournament: {
      id: tournamentId,
      name: "Sanitized Tournament",
      year: 2027,
      lifecycle: "setup_published"
    },
    pods: [{ id: podId, name: "Pod 1", sequence: 1 }],
    teams,
    matches
  };
  const generated = await generateCanonicalTournamentWorkbook(input);
  const manifest: ParsedCanonicalWorkbookManifestEntry[] = [];
  generated.manifest.forEach((entry) => {
    if (entry.sheetKind === "blank") {
      manifest.push({
        sheetId: entry.sheetId,
        sheetName: entry.sheetName,
        sheetKind: entry.sheetKind,
        baselineFingerprint: entry.baselineFingerprint
      });
    }
    if (entry.sheetKind === "game") {
      const match = matches.find((candidate) => candidate.id === entry.matchId)!;
      manifest.push({
        sheetId: entry.sheetId,
        sheetName: entry.sheetName,
        sheetKind: entry.sheetKind,
        matchId: entry.matchId,
        stage: entry.stage,
        podId: match.podId,
        teamIds: entry.teamIds,
        baselineFingerprint: entry.baselineFingerprint
      });
    }
  });
  const scope: CanonicalWorkbookScope = {
    tournamentId,
    generation: {
      generationId: input.generation.id,
      generationRevision: input.generation.revision,
      generationSourceDigest: input.generation.sourceDigest
    },
    manifest,
    matches: matches.map((match) => ({
      matchId: match.id,
      matchRowVersion: 1,
      canonicalStatus: "scheduled",
      stage: match.stage,
      podId: match.podId,
      teamIds: match.participantTeamIds,
      participants: match.participantTeamIds.flatMap((teamId, sideIndex) =>
        participantsForTeam(teams, teamId, sideIndex + 1)
      ),
      sourceState: undefined
    }))
  };
  return { input, scope, buffer: generated.buffer, matchIds };
}

export async function mutateWorkbook(
  buffer: Buffer,
  mutation: (workbook: Workbook) => void
): Promise<Buffer> {
  const workbook = new Workbook();
  const contents = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
  await workbook.xlsx.load(contents);
  mutation(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function matchWorksheet(workbook: Workbook, matchId: string): Worksheet {
  const worksheet = workbook.worksheets.find((candidate) =>
    candidate.getCell("W10").value === matchId
  );
  if (worksheet === undefined) {
    throw new Error("Sanitized match worksheet was not found.");
  }
  return worksheet;
}

export function copyBlankWorksheet(workbook: Workbook, name: string): Worksheet {
  const source = workbook.getWorksheet("Blank Scorecard");
  if (source === undefined) {
    throw new Error("Sanitized blank scorecard was not found.");
  }
  const copy = workbook.addWorksheet(name);
  for (let row = 1; row <= 89; row += 1) {
    for (let column = 1; column <= 27; column += 1) {
      const sourceCell = source.getCell(row, column);
      const targetCell = copy.getCell(row, column);
      targetCell.value = sourceCell.value;
    }
  }
  return copy;
}

function participantsForTeam(
  teams: CanonicalWorkbookGenerationInput["teams"],
  teamId: TournamentTeamId,
  sideNumber: number
): WorkbookParticipantIdentity[] {
  const team = teams.find((candidate) => candidate.id === teamId);
  if (team === undefined) {
    throw new Error("Sanitized participant team was not found.");
  }
  return team.players.map((player) => ({
    sideNumber: sideNumber as 1 | 2,
    teamId,
    playerId: player.id,
    rosterMembershipId: player.rosterMembershipId,
    rosterSlot: player.rosterSlot,
    displayName: player.displayName
  }));
}

function podMatch(
  id: MatchId,
  podId: PodId,
  sequence: number,
  firstTeamId: TournamentTeamId,
  secondTeamId: TournamentTeamId
) {
  return {
    id,
    podId,
    stage: "pod_play" as const,
    sequence,
    sequenceInPod: sequence,
    roundNumber: sequence,
    gameNumberForPair: 1,
    participantTeamIds: [firstTeamId, secondTeamId] as const
  };
}

function stable<Kind extends Parameters<typeof parseStableUuid>[1]>(
  sequence: number,
  kind: Kind
): ReturnType<typeof parseStableUuid<Kind>> {
  return parseStableUuid(rawUuid(sequence), kind);
}

function rawUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
