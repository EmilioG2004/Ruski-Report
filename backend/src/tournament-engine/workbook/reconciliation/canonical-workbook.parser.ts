import { createHash } from "node:crypto";

import { Cell, CellValue, Workbook, Worksheet } from "exceljs";

import {
  isStableUuid,
  parseStableUuid,
  TournamentStage
} from "../../domain";
import {
  CANONICAL_SCORECARD,
  CANONICAL_SCORECARD_HEADERS,
  CANONICAL_SCORECARD_LAYOUT_VERSION,
  CANONICAL_SCORECARD_METADATA_KEYS,
  CANONICAL_SCORECARD_STATUS_VALUES,
  CANONICAL_WORKBOOK_LIMITS,
  CANONICAL_WORKBOOK_MAGIC,
  CANONICAL_WORKBOOK_SCHEMA_VERSION,
  CANONICAL_WORKBOOK_SHEETS,
  CanonicalScorecardStatus
} from "../schema";
import { CanonicalWorkbookSafetyError } from "./errors";
import {
  ParsedWorkbookShotRow,
  ParsedCanonicalScorecardSheet,
  ParsedCanonicalWorkbook,
  ParsedCanonicalWorkbookControl,
  ParsedCanonicalWorkbookManifestEntry,
  ParseCanonicalWorkbookInput,
  WorkbookIssue,
  WorkbookParticipantIdentity
} from "./types";
import { preflightCanonicalXlsx } from "./xlsx-preflight";

const GLOBAL_METADATA_KEYS = [
  "magic",
  "workbookSchemaVersion",
  "scorecardLayoutVersion",
  "tournamentId",
  "generationId",
  "generationRevision",
  "generationSourceDigest",
  "generatedAt"
] as const;
const MANIFEST_HEADERS = [
  "sheetId",
  "sheetName",
  "sheetKind",
  "matchId",
  "stage",
  "podId",
  "bracketMatchId",
  "team1Id",
  "team2Id",
  "baselineFingerprint"
] as const;

export class CanonicalWorkbookParser {
  async readIdentity(buffer: Buffer): Promise<ParsedCanonicalWorkbookControl> {
    const workbook = await loadPreflightedWorkbook(buffer);
    const worksheet = workbook.getWorksheet(CANONICAL_WORKBOOK_SHEETS.metadata);
    if (worksheet === undefined) {
      throw identityError(
        "MISSING_WORKBOOK_METADATA",
        "Workbook canonical identity metadata is missing."
      );
    }
    const issues: WorkbookIssue[] = [];
    const values = readGlobalMetadataValues(worksheet, issues);
    const control = validateControl(values, undefined, issues);
    const firstError = issues.find((issue) => issue.severity === "error");
    if (control === undefined || firstError !== undefined) {
      throw new CanonicalWorkbookSafetyError(
        "Workbook canonical identity is invalid.",
        firstError ?? error(
          "WORKBOOK_IDENTITY_INVALID",
          "Workbook canonical identity is invalid."
        )
      );
    }
    return control;
  }

  async parse(input: ParseCanonicalWorkbookInput): Promise<ParsedCanonicalWorkbook> {
    const workbook = await loadPreflightedWorkbook(input.buffer);

    const issues: WorkbookIssue[] = [];
    if (workbook.worksheets.length > CANONICAL_WORKBOOK_LIMITS.maximumWorksheetCount) {
      issues.push(error("WORKSHEET_COUNT_LIMIT", "Workbook contains too many worksheets."));
    }
    const metadataWorksheet = workbook.getWorksheet(CANONICAL_WORKBOOK_SHEETS.metadata);
    const { control, manifest } = metadataWorksheet === undefined
      ? missingGlobalMetadata(issues)
      : parseGlobalMetadata(metadataWorksheet, input, issues);
    const scorecards: ParsedCanonicalScorecardSheet[] = [];
    const ignoredWorksheetNames: string[] = [];

    workbook.worksheets.forEach((worksheet, worksheetIndex) => {
      if (
        worksheet.name === CANONICAL_WORKBOOK_SHEETS.control ||
        worksheet.name === CANONICAL_WORKBOOK_SHEETS.metadata
      ) {
        return;
      }
      if (looksLikeCanonicalScorecard(worksheet)) {
        scorecards.push(parseScorecard(worksheet, worksheetIndex, input, issues));
      } else {
        ignoredWorksheetNames.push(worksheet.name);
      }
    });

    return {
      checksum: createHash("sha256").update(input.buffer).digest("hex"),
      control,
      manifest,
      scorecards,
      ignoredWorksheetNames,
      issues
    };
  }
}

async function loadPreflightedWorkbook(buffer: Buffer): Promise<Workbook> {
  preflightCanonicalXlsx(buffer);
  const workbook = new Workbook();
  try {
    const contents = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
    await workbook.xlsx.load(contents);
    return workbook;
  } catch {
    throw identityError("XLSX_PARSE_FAILED", "Workbook package could not be parsed.");
  }
}

function identityError(code: string, message: string): CanonicalWorkbookSafetyError {
  return new CanonicalWorkbookSafetyError(message, error(code, message));
}

function readGlobalMetadataValues(
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  GLOBAL_METADATA_KEYS.forEach((expectedKey, index) => {
    const row = index + 1;
    const key = readPrimitive(worksheet.getCell(`A${row}`), issues, `metadata.A${row}`);
    const value = readPrimitive(worksheet.getCell(`B${row}`), issues, `metadata.B${row}`);
    if (key !== expectedKey) {
      issues.push(error(
        "WORKBOOK_METADATA_KEY_MISMATCH",
        `Expected workbook metadata key '${expectedKey}'.`,
        `metadata.A${row}`
      ));
    }
    values[expectedKey] = value;
  });
  return values;
}

function missingGlobalMetadata(issues: WorkbookIssue[]): {
  control: undefined;
  manifest: readonly ParsedCanonicalWorkbookManifestEntry[];
} {
  issues.push(error(
    "MISSING_WORKBOOK_METADATA",
    `Workbook is missing '${CANONICAL_WORKBOOK_SHEETS.metadata}'.`
  ));
  return { control: undefined, manifest: [] };
}

function parseGlobalMetadata(
  worksheet: Worksheet,
  input: ParseCanonicalWorkbookInput,
  issues: WorkbookIssue[]
): {
  control?: ParsedCanonicalWorkbookControl;
  manifest: readonly ParsedCanonicalWorkbookManifestEntry[];
} {
  if (worksheet.state !== "veryHidden") {
    issues.push(error(
      "WORKBOOK_METADATA_NOT_VERY_HIDDEN",
      "Canonical workbook metadata must remain very hidden.",
      `worksheets.${worksheet.name}`
    ));
  }
  const values = readGlobalMetadataValues(worksheet, issues);
  const control = validateControl(values, input, issues);
  const manifest = parseManifest(worksheet, issues);
  return { control, manifest };
}

function validateControl(
  values: Readonly<Record<string, unknown>>,
  input: ParseCanonicalWorkbookInput | undefined,
  issues: WorkbookIssue[]
): ParsedCanonicalWorkbookControl | undefined {
  const tournamentId = text(values.tournamentId);
  const generationId = text(values.generationId);
  const sourceDigest = text(values.generationSourceDigest);
  const generatedAt = text(values.generatedAt);
  const schemaVersion = integer(values.workbookSchemaVersion);
  const layoutVersion = integer(values.scorecardLayoutVersion);
  const generationRevision = integer(values.generationRevision);
  const checks: Array<[boolean, string, string]> = [
    [values.magic === CANONICAL_WORKBOOK_MAGIC, "WORKBOOK_MAGIC_MISMATCH", "Workbook magic is invalid."],
    [schemaVersion === CANONICAL_WORKBOOK_SCHEMA_VERSION, "WORKBOOK_SCHEMA_MISMATCH", "Workbook schema version is unsupported."],
    [layoutVersion === CANONICAL_SCORECARD_LAYOUT_VERSION, "SCORECARD_LAYOUT_MISMATCH", "Scorecard layout version is unsupported."],
    [isStableUuid(tournamentId ?? ""), "WORKBOOK_TOURNAMENT_ID_INVALID", "Workbook tournament identity is invalid."],
    [isStableUuid(generationId ?? ""), "WORKBOOK_GENERATION_ID_INVALID", "Workbook generation identity is invalid."],
    [generationRevision !== undefined && generationRevision > 0, "WORKBOOK_GENERATION_REVISION_INVALID", "Workbook generation revision is invalid."],
    [input === undefined || tournamentId === input.scope.tournamentId, "WORKBOOK_TOURNAMENT_MISMATCH", "Workbook belongs to another tournament."],
    [input === undefined || generationId === input.scope.generation.generationId, "WORKBOOK_GENERATION_MISMATCH", "Workbook generation identity does not match the selected generation."],
    [input === undefined || generationRevision === input.scope.generation.generationRevision, "WORKBOOK_GENERATION_REVISION_MISMATCH", "Workbook generation revision does not match the selected generation."],
    [input === undefined || sourceDigest === input.scope.generation.generationSourceDigest, "WORKBOOK_SOURCE_DIGEST_MISMATCH", "Workbook source digest does not match the selected generation."],
    [/^[a-f0-9]{64}$/.test(sourceDigest ?? ""), "WORKBOOK_SOURCE_DIGEST_INVALID", "Workbook generation source digest is invalid."],
    [generatedAt !== undefined && Number.isFinite(Date.parse(generatedAt)), "WORKBOOK_GENERATED_AT_INVALID", "Workbook generated timestamp is invalid."]
  ];
  checks.forEach(([valid, code, message]) => {
    if (!valid) {
      issues.push(error(code, message, "metadata"));
    }
  });
  if (
    !isStableUuid(tournamentId ?? "") ||
    !isStableUuid(generationId ?? "") ||
    schemaVersion === undefined ||
    layoutVersion === undefined ||
    generationRevision === undefined ||
    sourceDigest === undefined ||
    generatedAt === undefined
  ) {
    return undefined;
  }
  return {
    magic: CANONICAL_WORKBOOK_MAGIC,
    workbookSchemaVersion: schemaVersion,
    scorecardLayoutVersion: layoutVersion,
    tournamentId: parseStableUuid(tournamentId!, "tournament"),
    generationId: generationId!,
    generationRevision,
    generationSourceDigest: sourceDigest,
    generatedAt
  };
}

function parseManifest(
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): ParsedCanonicalWorkbookManifestEntry[] {
  MANIFEST_HEADERS.forEach((expected, index) => {
    const address = `${columnName(index + 1)}11`;
    const actual = readPrimitive(worksheet.getCell(address), issues, `metadata.${address}`);
    if (actual !== expected) {
      issues.push(error(
        "WORKBOOK_MANIFEST_HEADER_MISMATCH",
        `Expected manifest header '${expected}'.`,
        `metadata.${address}`
      ));
    }
  });
  const entries: ParsedCanonicalWorkbookManifestEntry[] = [];
  const sheetIds = new Set<string>();
  const matchIds = new Set<string>();
  for (let row = 12; row <= worksheet.rowCount; row += 1) {
    const raw = MANIFEST_HEADERS.map((_, index) =>
      readPrimitive(
        worksheet.getCell(row, index + 1),
        issues,
        `metadata.${columnName(index + 1)}${row}`
      )
    );
    if (raw.every((value) => value === null)) {
      continue;
    }
    const [sheetIdValue, sheetNameValue, kindValue, matchIdValue, stageValue,
      podIdValue, bracketMatchIdValue, team1Value, team2Value, fingerprintValue] = raw;
    const sheetId = text(sheetIdValue);
    const sheetName = text(sheetNameValue);
    const sheetKind = text(kindValue);
    const matchId = text(matchIdValue);
    const stage = text(stageValue);
    const podId = text(podIdValue);
    const bracketMatchId = text(bracketMatchIdValue);
    const team1Id = text(team1Value);
    const team2Id = text(team2Value);
    const baselineFingerprint = text(fingerprintValue);
    const valid =
      validSheetId(sheetId) &&
      sheetName !== undefined &&
      (sheetKind === "blank" || sheetKind === "game") &&
      /^[a-f0-9]{64}$/.test(baselineFingerprint ?? "") &&
      (sheetKind !== "blank" || (
        sheetId === "blank-scorecard" &&
        matchId === undefined &&
        stage === undefined &&
        podId === undefined &&
        bracketMatchId === undefined &&
        team1Id === undefined &&
        team2Id === undefined
      )) &&
      (sheetKind !== "game" || (
        isStableUuid(matchId ?? "") &&
        sheetId === `match:${matchId}` &&
        (stage === "pod_play" || stage === "playoffs") &&
        ((stage === "pod_play" && isStableUuid(podId ?? "") &&
          bracketMatchId === undefined) ||
         (stage === "playoffs" && podId === undefined &&
          isStableUuid(bracketMatchId ?? ""))) &&
        isStableUuid(team1Id ?? "") &&
        isStableUuid(team2Id ?? "") &&
        team1Id !== team2Id
      ));
    if (!valid) {
      issues.push(error(
        "WORKBOOK_MANIFEST_ENTRY_INVALID",
        `Workbook manifest row ${row} is invalid.`,
        `metadata.${row}`
      ));
      continue;
    }
    if (sheetIds.has(sheetId!) || (matchId !== undefined && matchIds.has(matchId))) {
      issues.push(error(
        "WORKBOOK_MANIFEST_ID_DUPLICATE",
        `Workbook manifest row ${row} duplicates a stable identity.`,
        `metadata.${row}`
      ));
      continue;
    }
    sheetIds.add(sheetId!);
    if (matchId !== undefined) {
      matchIds.add(matchId);
    }
    entries.push({
      sheetId: sheetId!,
      sheetName: sheetName!,
      sheetKind: sheetKind as "blank" | "game",
      matchId: matchId === undefined ? undefined : parseStableUuid(matchId, "match"),
      stage: stage as TournamentStage | undefined,
      podId: podId === undefined ? undefined : stablePodId(podId, issues, row),
      bracketMatchId,
      teamIds: team1Id === undefined || team2Id === undefined
        ? undefined
        : [
          parseStableUuid(team1Id, "tournament_team"),
          parseStableUuid(team2Id, "tournament_team")
        ],
      baselineFingerprint: baselineFingerprint!
    });
  }
  return entries;
}

function stablePodId(value: string, issues: WorkbookIssue[], row: number) {
  if (!isStableUuid(value)) {
    issues.push(error(
      "WORKBOOK_MANIFEST_POD_ID_INVALID",
      `Workbook manifest row ${row} has an invalid pod identity.`,
      `metadata.${row}`
    ));
    return undefined;
  }
  return parseStableUuid(value, "pod");
}

function looksLikeCanonicalScorecard(worksheet: Worksheet): boolean {
  const magic = normalizedCellText(worksheet.getCell("W1").value);
  if (magic === CANONICAL_WORKBOOK_MAGIC) {
    return true;
  }
  return [...CANONICAL_SCORECARD.leftHeaders, ...CANONICAL_SCORECARD.rightHeaders]
    .some((address, index) => normalizedCellText(worksheet.getCell(address).value) ===
      CANONICAL_SCORECARD_HEADERS[index % CANONICAL_SCORECARD_HEADERS.length]);
}

function parseScorecard(
  worksheet: Worksheet,
  worksheetIndex: number,
  input: ParseCanonicalWorkbookInput,
  workbookIssues: WorkbookIssue[]
): ParsedCanonicalScorecardSheet {
  const issues: WorkbookIssue[] = [];
  const metadata: Record<string, unknown> = {};
  CANONICAL_SCORECARD_METADATA_KEYS.forEach((expectedKey, index) => {
    const row = index + 1;
    const keyCell = `${CANONICAL_SCORECARD.metadataColumns.key}${row}`;
    const valueCell = `${CANONICAL_SCORECARD.metadataColumns.value}${row}`;
    const key = readPrimitive(worksheet.getCell(keyCell), issues, sheetPath(worksheet, keyCell));
    metadata[expectedKey] = readPrimitive(
      worksheet.getCell(valueCell),
      issues,
      sheetPath(worksheet, valueCell)
    );
    if (key !== expectedKey) {
      issues.push(error(
        "SCORECARD_METADATA_KEY_MISMATCH",
        `Expected scorecard metadata key '${expectedKey}'.`,
        sheetPath(worksheet, keyCell)
      ));
    }
  });
  validateScorecardHeaders(worksheet, issues);
  const sheetKind = text(metadata.sheetKind) === "blank" ? "blank" : "game";
  const statusValue = readPrimitive(
    worksheet.getCell(CANONICAL_SCORECARD.statusCell),
    issues,
    sheetPath(worksheet, CANONICAL_SCORECARD.statusCell)
  );
  const status = CANONICAL_SCORECARD_STATUS_VALUES.includes(statusValue as CanonicalScorecardStatus)
    ? statusValue as CanonicalScorecardStatus
    : "SCHEDULED";
  if (!CANONICAL_SCORECARD_STATUS_VALUES.includes(statusValue as CanonicalScorecardStatus)) {
    issues.push(error(
      "SCORECARD_STATUS_INVALID",
      "Scorecard status must be SCHEDULED, LIVE GAME, or FINAL.",
      sheetPath(worksheet, CANONICAL_SCORECARD.statusCell)
    ));
  }
  const playersPerTeam = parsePlayersPerTeam(worksheet, issues);
  const matchId = optionalStableId(text(metadata.matchId), "match", issues, worksheet, "matchId");
  const podId = optionalStableId(text(metadata.podId), "pod", issues, worksheet, "podId");
  const team1Id = optionalStableId(text(metadata.team1Id), "tournament_team", issues, worksheet, "team1Id");
  const team2Id = optionalStableId(text(metadata.team2Id), "tournament_team", issues, worksheet, "team2Id");
  const participants = parseParticipantDirectory(worksheet, playersPerTeam, issues);
  const rows = parseShotRows(worksheet, playersPerTeam, issues);
  validateSheetMetadata(
    metadata,
    sheetKind,
    matchId,
    team1Id,
    team2Id,
    participants,
    worksheet,
    issues
  );
  validateSheetScope(metadata, input, worksheet, issues);
  validateRecordedRows(status, rows, worksheet, issues);
  const sheet: ParsedCanonicalScorecardSheet = {
    worksheetIndex,
    worksheetName: worksheet.name,
    sheetId: text(metadata.sheetId) ?? "",
    sheetKind,
    status,
    playersPerTeam,
    matchId,
    stage: parseStage(text(metadata.stage), issues, worksheet),
    podId,
    bracketMatchId: text(metadata.bracketMatchId),
    teamIds: team1Id === undefined || team2Id === undefined
      ? undefined
      : [team1Id, team2Id],
    participants,
    rows,
    issues
  };
  workbookIssues.push(...issues.filter((issue) => issue.code.startsWith("WORKBOOK_")));
  return sheet;
}

function parsePlayersPerTeam(
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): number {
  const key = readPrimitive(
    worksheet.getCell("V17"), issues, sheetPath(worksheet, "V17")
  );
  const value = readPrimitive(
    worksheet.getCell("W17"), issues, sheetPath(worksheet, "W17")
  );
  const playersPerTeam = integer(value);
  if (key !== "playersPerTeam" ||
      playersPerTeam === undefined || playersPerTeam < 1 || playersPerTeam > 8) {
    issues.push(error(
      "SCORECARD_PLAYER_COUNT_INVALID",
      "Scorecard playersPerTeam metadata must be an integer from 1 through 8.",
      `worksheets.${worksheet.name}.metadata.playersPerTeam`
    ));
    return 1;
  }
  for (let slot = 1; slot <= 8; slot += 1) {
    for (const sideNumber of [1, 2] as const) {
      const row = sideNumber === 1 ? 19 + slot : 27 + slot;
      const expectedKey = `team${sideNumber}PlayerSlot${slot}DisplayName`;
      const actualKey = readPrimitive(
        worksheet.getCell(`V${row}`), issues, sheetPath(worksheet, `V${row}`)
      );
      readPrimitive(
        worksheet.getCell(`W${row}`), issues, sheetPath(worksheet, `W${row}`)
      );
      if (actualKey !== expectedKey) {
        issues.push(error(
          "SCORECARD_PLAYER_DISPLAY_KEY_MISMATCH",
          `Expected hidden player display key '${expectedKey}'.`,
          sheetPath(worksheet, `V${row}`)
        ));
      }
    }
  }
  return playersPerTeam;
}

function validateSheetScope(
  metadata: Readonly<Record<string, unknown>>,
  input: ParseCanonicalWorkbookInput,
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): void {
  const expected = input.scope;
  const matches =
    text(metadata.tournamentId) === expected.tournamentId &&
    text(metadata.generationId) === expected.generation.generationId &&
    integer(metadata.generationRevision) === expected.generation.generationRevision &&
    text(metadata.generationSourceDigest) === expected.generation.generationSourceDigest;
  if (!matches) {
    issues.push(error(
      "SCORECARD_GENERATION_SCOPE_MISMATCH",
      "Scorecard metadata does not belong to the selected tournament generation.",
      `worksheets.${worksheet.name}.metadata`
    ));
  }
}

function validateScorecardHeaders(worksheet: Worksheet, issues: WorkbookIssue[]): void {
  [CANONICAL_SCORECARD.leftHeaders, CANONICAL_SCORECARD.rightHeaders]
    .forEach((addresses) => addresses.forEach((address, index) => {
      const actual = readPrimitive(worksheet.getCell(address), issues, sheetPath(worksheet, address));
      if (actual !== CANONICAL_SCORECARD_HEADERS[index]) {
        issues.push(error(
          "SCORECARD_HEADER_MISMATCH",
          `Expected scorecard header '${CANONICAL_SCORECARD_HEADERS[index]}'.`,
          sheetPath(worksheet, address)
        ));
      }
    }));
}

function validateSheetMetadata(
  metadata: Readonly<Record<string, unknown>>,
  sheetKind: "blank" | "game",
  matchId: string | undefined,
  team1Id: string | undefined,
  team2Id: string | undefined,
  participants: readonly WorkbookParticipantIdentity[],
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): void {
  const validDigest = /^[a-f0-9]{64}$/.test(text(metadata.generationSourceDigest) ?? "");
  const commonValid =
    metadata.magic === CANONICAL_WORKBOOK_MAGIC &&
    integer(metadata.workbookSchemaVersion) === CANONICAL_WORKBOOK_SCHEMA_VERSION &&
    integer(metadata.scorecardLayoutVersion) === CANONICAL_SCORECARD_LAYOUT_VERSION &&
    isStableUuid(text(metadata.tournamentId) ?? "") &&
    isStableUuid(text(metadata.generationId) ?? "") &&
    integer(metadata.generationRevision) !== undefined &&
    validDigest &&
    (metadata.sheetKind === "blank" || metadata.sheetKind === "game") &&
    validSheetId(text(metadata.sheetId));
  if (!commonValid) {
    issues.push(error(
      "SCORECARD_METADATA_INVALID",
      "Scorecard stable metadata is incomplete or invalid.",
      `worksheets.${worksheet.name}.metadata`
    ));
  }
  if (
    sheetKind === "game" &&
    (matchId === undefined || text(metadata.sheetId) !== `match:${matchId}` ||
      team1Id === undefined || team2Id === undefined || team1Id === team2Id)
  ) {
    issues.push(error(
      "SCORECARD_MATCH_METADATA_INVALID",
      "Generated game scorecard is missing exact match or team identity.",
      `worksheets.${worksheet.name}.metadata`
    ));
  }
  if (
    sheetKind === "blank" &&
    (text(metadata.sheetId) !== "blank-scorecard" ||
      matchId !== undefined ||
      metadata.stage !== null ||
      metadata.podId !== null ||
      metadata.bracketMatchId !== null ||
      team1Id !== undefined ||
      team2Id !== undefined ||
      participants.length !== 0)
  ) {
    issues.push(error(
      "SCORECARD_BLANK_METADATA_INVALID",
      "Canonical blank scorecard must not embed match or participant identity.",
      `worksheets.${worksheet.name}.metadata`
    ));
  }
}

function parseParticipantDirectory(
  worksheet: Worksheet,
  playersPerTeam: number,
  issues: WorkbookIssue[]
): WorkbookParticipantIdentity[] {
  const participants: WorkbookParticipantIdentity[] = [];
  for (let row = 1; row <= 16; row += 1) {
    const cells = CANONICAL_SCORECARD.rowIdentityColumns;
    const values = [cells.sideNumber, cells.teamId, cells.playerId, cells.rosterMembershipId]
      .map((column) => readPrimitive(
        worksheet.getCell(`${column}${row}`),
        issues,
        sheetPath(worksheet, `${column}${row}`)
      ));
    if (values.every((value) => value === null)) {
      continue;
    }
    const sideNumber = integer(values[0]);
    const teamId = text(values[1]);
    const playerId = text(values[2]);
    const membershipId = text(values[3]);
    const expectedSideNumber = row <= 8 ? 1 : 2;
    const rosterSlot = row <= 8 ? row : row - 8;
    const displayCell = `W${expectedSideNumber === 1 ? 19 + rosterSlot : 27 + rosterSlot}`;
    const displayName = text(readPrimitive(
      worksheet.getCell(displayCell),
      issues,
      sheetPath(worksheet, displayCell)
    ));
    if (
      sideNumber !== expectedSideNumber ||
      rosterSlot > playersPerTeam ||
      !isStableUuid(teamId ?? "") ||
      !isStableUuid(playerId ?? "") ||
      !isStableUuid(membershipId ?? "") ||
      displayName === undefined
    ) {
      issues.push(error(
        "SCORECARD_PARTICIPANT_METADATA_INVALID",
        `Scorecard participant identity row ${row} is invalid.`,
        sheetPath(worksheet, `X${row}:AA${row}`)
      ));
      continue;
    }
    participants.push({
      sideNumber,
      teamId: parseStableUuid(teamId!, "tournament_team"),
      playerId: parseStableUuid(playerId!, "tournament_player"),
      rosterMembershipId: parseStableUuid(membershipId!, "roster_membership"),
      rosterSlot,
      displayName: displayName!
    });
  }
  return participants;
}

function parseShotRows(
  worksheet: Worksheet,
  playersPerTeam: number,
  issues: WorkbookIssue[]
): ParsedWorkbookShotRow[] {
  return ([
    [1, CANONICAL_SCORECARD.leftShotRows, CANONICAL_SCORECARD.markerColumns.left],
    [2, CANONICAL_SCORECARD.rightShotRows, CANONICAL_SCORECARD.markerColumns.right]
  ] as const).flatMap(([sideNumber, layout, markerColumns]) =>
    Array.from({ length: layout.end - layout.start + 1 }, (_, offset) => {
      const row = layout.start + offset;
      const shotCell = `${layout.shotColumn}${row}`;
      const shooterCell = `${layout.shooterColumn}${row}`;
      const shotNumberValue = readPrimitive(
        worksheet.getCell(shotCell), issues, sheetPath(worksheet, shotCell)
      );
      const shooterValue = readShooter(
        worksheet.getCell(shooterCell),
        shooterCell,
        row,
        playersPerTeam,
        issues,
        sheetPath(worksheet, shooterCell)
      );
      const markerValues = markerColumns.map((column) => {
        const address = `${column}${row}`;
        return parseMarker(
          readPrimitive(worksheet.getCell(address), issues, sheetPath(worksheet, address)),
          issues,
          sheetPath(worksheet, address)
        );
      });
      const parsedShotNumber = shotNumberValue === null
        ? undefined
        : integer(shotNumberValue);
      const shotNumber = parsedShotNumber ?? null;
      if (shotNumberValue !== null &&
          (parsedShotNumber === undefined || parsedShotNumber <= 0)) {
        issues.push(error(
          "SCORECARD_SHOT_NUMBER_INVALID",
          "Shot number must be a positive integer.",
          sheetPath(worksheet, shotCell)
        ));
      }
      const expectedShotNumber = Math.floor((row - layout.start) / playersPerTeam) + 1;
      if (parsedShotNumber !== expectedShotNumber) {
        issues.push(error(
          "SCORECARD_SHOT_NUMBER_SEQUENCE_INVALID",
          "Shot number does not match the stable scorecard row sequence.",
          sheetPath(worksheet, shotCell)
        ));
      }
      const shooter = shooterValue === null ? null : text(shooterValue) ?? null;
      if (shooterValue !== null && shooter === null) {
        issues.push(error(
          "SCORECARD_SHOOTER_INVALID",
          "Shooter must be plain text.",
          sheetPath(worksheet, shooterCell)
        ));
      }
      const [miss, make, splashOut, guy, tri, di, vom] = markerValues;
      validateMarkerCombination(
        { miss, make, splashOut, guy, tri, di, vom },
        issues,
        `worksheets.${worksheet.name}.rows.${sideNumber}.${row}`
      );
      return {
        sideNumber,
        worksheetRow: row,
        shotNumber,
        observedShooter: shooter,
        markers: { miss, make, splashOut, guy, tri, di, vom }
      };
    })
  );
}

function validateMarkerCombination(
  markers: ParsedWorkbookShotRow["markers"],
  issues: WorkbookIssue[],
  path: string
): void {
  const specialCount = [markers.splashOut, markers.guy, markers.tri, markers.di]
    .filter(Boolean).length;
  if (specialCount > 1) {
    issues.push(error(
      "SCORECARD_SPECIAL_MISS_CONFLICT",
      "Only one special miss classification may decorate a shot.",
      path
    ));
  }
  if (markers.make && (markers.miss || specialCount > 0)) {
    issues.push(error(
      "SCORECARD_MAKE_MISS_CONFLICT",
      "A make cannot also be a miss or special miss.",
      path
    ));
  }
  if (specialCount > 0 && !markers.miss) {
    issues.push(error(
      "SCORECARD_SPECIAL_MISS_WITHOUT_MISS",
      "A special miss classification requires the miss marker.",
      path
    ));
  }
}

function validateRecordedRows(
  status: CanonicalScorecardStatus,
  rows: readonly ParsedWorkbookShotRow[],
  worksheet: Worksheet,
  issues: WorkbookIssue[]
): void {
  const hasRecordedInput = rows.some((row) => Object.values(row.markers).some(Boolean));
  if (status === "SCHEDULED" && hasRecordedInput) {
    issues.push(error(
      "SCHEDULED_SCORECARD_HAS_INPUT",
      "A scheduled scorecard cannot contain recorded scoring input.",
      `worksheets.${worksheet.name}`
    ));
  }
}

function parseMarker(
  value: unknown,
  issues: WorkbookIssue[],
  path: string
): boolean {
  if (value === null || value === false || value === 0) {
    return false;
  }
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["x", "true", "1"].includes(normalized)) {
      return true;
    }
  }
  issues.push(error(
    "SCORECARD_MARKER_INVALID",
    "Scorecard marker must be blank, X, true, or 1.",
    path
  ));
  return false;
}

function parseStage(
  value: string | undefined,
  issues: WorkbookIssue[],
  worksheet: Worksheet
): TournamentStage | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "pod_play" || value === "playoffs") {
    return value;
  }
  issues.push(error(
    "SCORECARD_STAGE_INVALID",
    "Scorecard stage is invalid.",
    `worksheets.${worksheet.name}.metadata.stage`
  ));
  return undefined;
}

function optionalStableId(
  value: string | undefined,
  kind: "match" | "pod" | "tournament_team",
  issues: WorkbookIssue[],
  worksheet: Worksheet,
  field: string
): any {
  if (value === undefined) {
    return undefined;
  }
  if (!isStableUuid(value)) {
    issues.push(error(
      "SCORECARD_STABLE_ID_INVALID",
      `Scorecard ${field} is not a stable UUID.`,
      `worksheets.${worksheet.name}.metadata.${field}`
    ));
    return undefined;
  }
  return parseStableUuid(value, kind);
}

function readPrimitive(
  cell: Cell,
  issues: WorkbookIssue[],
  path: string
): string | number | boolean | null {
  if (isFormula(cell.value)) {
    issues.push(error(
      "FORMULA_NOT_ALLOWED_IN_INPUT",
      "Formulas are not allowed in editable or metadata cells.",
      path
    ));
    return null;
  }
  return normalizeCellValue(cell.value);
}

function readShooter(
  cell: Cell,
  address: string,
  row: number,
  playersPerTeam: number,
  issues: WorkbookIssue[],
  path: string
): string | number | boolean | null {
  if (!isFormula(cell.value)) {
    return readPrimitive(cell, issues, path);
  }
  const value = cell.value as { formula?: string; sharedFormula?: string; result?: CellValue };
  const sideNumber = address.startsWith("C") ? 1 : 2;
  const rosterSlot = (row - 10) % playersPerTeam + 1;
  const displayRow = sideNumber === 1 ? 19 + rosterSlot : 27 + rosterSlot;
  const permitted = new Set([
    `=$W$${displayRow}`,
    `IF($W$${displayRow}="","",$W$${displayRow})`
  ]);
  if (!permitted.has(value.formula ?? "") || value.sharedFormula !== undefined) {
    issues.push(error(
      "FORMULA_NOT_ALLOWED_IN_INPUT",
      "Only the generated shooter-reference formula is allowed in a shooter cell.",
      path
    ));
    return null;
  }
  return normalizeCellValue(value.result ?? null);
}

function isFormula(value: CellValue): boolean {
  return value !== null && typeof value === "object" &&
    ("formula" in value || "sharedFormula" in value);
}

function normalizeCellValue(value: CellValue): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if ("text" in value && typeof value.text === "string") {
    return normalizeCellValue(value.text);
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return normalizeCellValue(value.richText.map((item) => item.text).join(""));
  }
  return null;
}

function normalizedCellText(value: CellValue): string | undefined {
  const normalized = normalizeCellValue(value);
  return typeof normalized === "string" ? normalized : undefined;
}

function integer(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length === 0 ? undefined : normalized;
}

function validSheetId(value: string | undefined): boolean {
  return value !== undefined && value.length <= 256 && /^[a-z0-9:_-]+$/i.test(value);
}

function columnName(index: number): string {
  return String.fromCharCode(64 + index);
}

function sheetPath(worksheet: Worksheet, cell: string): string {
  return `worksheets.${worksheet.name}.${cell}`;
}

function error(code: string, message: string, path?: string): WorkbookIssue {
  return { code, severity: "error", message, path };
}
