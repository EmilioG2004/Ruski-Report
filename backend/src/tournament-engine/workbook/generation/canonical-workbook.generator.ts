import { createHash } from "node:crypto";

import { Workbook } from "exceljs";

import { canonicalSha256 } from "../canonical-json";
import { CANONICAL_WORKBOOK_SHEETS } from "../schema";
import {
  createBlankScorecardBaselineFingerprint,
  createScheduledScorecardBaselineFingerprint,
  createWorkbookSemanticModel
} from "./baseline-fingerprint";
import { buildControlSheet } from "./control-sheet.builder";
import { validateGenerationInput } from "./generation-validation";
import { buildMetadataSheet } from "./metadata-sheet.builder";
import { buildScorecardSheet } from "./scorecard-sheet.builder";
import {
  CanonicalWorkbookGenerationInput,
  CanonicalWorkbookMatchInput,
  CanonicalWorkbookSheetManifestEntry,
  CanonicalWorkbookTeamInput,
  GeneratedCanonicalWorkbook
} from "./types";

export async function generateCanonicalTournamentWorkbook(
  input: CanonicalWorkbookGenerationInput
): Promise<GeneratedCanonicalWorkbook> {
  validateGenerationInput(input);
  const workbook = createWorkbook(input);
  const podsById = new Map(input.pods.map((pod) => [pod.id, pod]));
  const teamsById = new Map(input.teams.map((team) => [team.id, team]));
  const matches = [...input.matches].sort(
    (left, right) => left.sequence - right.sequence
  );
  const playersPerTeam = input.teams[0].players.length;
  const sheetNamesByMatchId = createMatchSheetNames(input);
  const manifest: CanonicalWorkbookSheetManifestEntry[] = [];
  const baselineFingerprints: Record<string, string> = {};

  const control = workbook.addWorksheet(CANONICAL_WORKBOOK_SHEETS.control);
  buildControlSheet(control, input, sheetNamesByMatchId);
  manifest.push(nonGameManifest(1, "control", CANONICAL_WORKBOOK_SHEETS.control, "control"));

  const blank = workbook.addWorksheet(CANONICAL_WORKBOOK_SHEETS.blankScorecard);
  buildScorecardSheet(blank, {
    workbook: input,
    sheetId: "blank-scorecard",
    playersPerTeam
  });
  manifest.push({
    order: 2,
    sheetId: "blank-scorecard",
    sheetName: CANONICAL_WORKBOOK_SHEETS.blankScorecard,
    sheetKind: "blank",
    matchId: null,
    stage: null,
    podId: null,
    bracketMatchId: null,
    teamIds: [],
    baselineFingerprint: createBlankScorecardBaselineFingerprint(
      input.tournament.id
    )
  });

  const semanticMatchSheets: Array<{
    sheetId: string;
    sheetName: string;
    matchId: string;
    baselineFingerprint: string;
  }> = [];
  matches.forEach((match, index) => {
    const firstTeam = teamsById.get(match.participantTeamIds[0]);
    const secondTeam = teamsById.get(match.participantTeamIds[1]);
    const pod = match.stage === "pod_play"
      ? podsById.get(match.podId)
      : undefined;
    if (firstTeam === undefined || secondTeam === undefined ||
        (match.stage === "pod_play" && pod === undefined)) {
      throw new Error("Validated workbook generation input lost a referenced identity.");
    }
    const teams = resolveMatchTeams(match, [firstTeam, secondTeam]);
    const sheetId = `match:${match.id}`;
    const sheetName = requireSheetName(sheetNamesByMatchId, match.id);
    const fingerprint = createScheduledScorecardBaselineFingerprint({
      tournamentId: input.tournament.id,
      match,
      teams
    });
    const worksheet = workbook.addWorksheet(sheetName);
    buildScorecardSheet(worksheet, {
      workbook: input,
      sheetId,
      playersPerTeam,
      match,
      pod,
      teams
    });
    baselineFingerprints[match.id] = fingerprint;
    manifest.push({
      order: index + 3,
      sheetId,
      sheetName,
      sheetKind: "game",
      matchId: match.id,
      stage: match.stage,
      podId: match.stage === "pod_play" ? match.podId : null,
      bracketMatchId: match.stage === "playoffs"
        ? match.bracketMatchId
        : null,
      teamIds: match.participantTeamIds,
      baselineFingerprint: fingerprint
    });
    semanticMatchSheets.push({
      sheetId,
      sheetName,
      matchId: match.id,
      baselineFingerprint: fingerprint
    });
  });

  const metadataOrder = manifest.length + 1;
  const metadataManifest = nonGameManifest(
    metadataOrder,
    "metadata",
    CANONICAL_WORKBOOK_SHEETS.metadata,
    "metadata"
  );
  manifest.push(metadataManifest);
  const metadata = workbook.addWorksheet(CANONICAL_WORKBOOK_SHEETS.metadata);
  buildMetadataSheet(metadata, input, manifest);

  const semanticDigest = canonicalSha256(
    createWorkbookSemanticModel(input, semanticMatchSheets)
  );
  const generated = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(generated);
  return {
    buffer,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    sizeBytes: buffer.byteLength,
    semanticDigest,
    manifest,
    baselineFingerprints
  };
}

function resolveMatchTeams(
  match: CanonicalWorkbookMatchInput,
  currentTeams: readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput]
): readonly [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput] {
  if (match.participantRosters === undefined) {
    return currentTeams;
  }
  return currentTeams.map((team, sideIndex) => ({
    ...team,
    players: match.participantRosters?.[sideIndex].players ?? team.players
  })) as [CanonicalWorkbookTeamInput, CanonicalWorkbookTeamInput];
}

function createWorkbook(input: CanonicalWorkbookGenerationInput): Workbook {
  const workbook = new Workbook();
  const generatedAt = new Date(input.generation.generatedAt);
  workbook.creator = "Ruski Report";
  workbook.lastModifiedBy = "Ruski Report";
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;
  workbook.properties.date1904 = false;
  return workbook;
}

function createMatchSheetNames(
  input: CanonicalWorkbookGenerationInput
): ReadonlyMap<string, string> {
  const podSequenceById = new Map(
    input.pods.map((pod) => [pod.id, pod.sequence])
  );
  const roundOccurrences = new Map<string, number>();
  const names = new Map<string, string>();
  [...input.matches]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((match) => {
      if (match.stage === "playoffs") {
        const name = `PO-R${pad(match.roundNumber)}-M${pad(match.sequenceInRound)}`;
        if (name.length > 31) {
          throw new Error("Generated worksheet name exceeds Excel's limit.");
        }
        names.set(match.id, name);
        return;
      }
      const podSequence = podSequenceById.get(match.podId);
      if (podSequence === undefined) {
        throw new Error("Validated match references an unknown pod.");
      }
      const roundKey = `${match.podId}:${match.roundNumber}`;
      const matchInRound = (roundOccurrences.get(roundKey) ?? 0) + 1;
      roundOccurrences.set(roundKey, matchInRound);
      const name = `P${pad(podSequence)}-R${pad(match.roundNumber)}-M${pad(matchInRound)}`;
      if (name.length > 31) {
        throw new Error("Generated worksheet name exceeds Excel's limit.");
      }
      names.set(match.id, name);
    });
  return names;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function requireSheetName(
  names: ReadonlyMap<string, string>,
  matchId: string
): string {
  const name = names.get(matchId);
  if (name === undefined) {
    throw new Error(`Missing generated worksheet name for match '${matchId}'.`);
  }
  return name;
}

function nonGameManifest(
  order: number,
  sheetId: "control" | "metadata",
  sheetName: string,
  sheetKind: "control" | "metadata"
): CanonicalWorkbookSheetManifestEntry {
  return {
    order,
    sheetId,
    sheetName,
    sheetKind,
    matchId: null,
    teamIds: [],
    baselineFingerprint: null
  };
}
