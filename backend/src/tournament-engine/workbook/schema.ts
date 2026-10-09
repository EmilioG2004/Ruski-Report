export const CANONICAL_WORKBOOK_MAGIC = "ruski-report-canonical-workbook";
export const CANONICAL_WORKBOOK_SCHEMA_VERSION = 1;
export const CANONICAL_SCORECARD_LAYOUT_VERSION = 1;

export const CANONICAL_WORKBOOK_SHEETS = Object.freeze({
  control: "Control",
  blankScorecard: "Blank Scorecard",
  metadata: "__Ruski Metadata"
});

export const CANONICAL_SCORECARD_STATUS_VALUES = Object.freeze([
  "SCHEDULED",
  "LIVE GAME",
  "FINAL"
] as const);

export type CanonicalScorecardStatus =
  typeof CANONICAL_SCORECARD_STATUS_VALUES[number];

export const CANONICAL_SCORECARD = Object.freeze({
  printArea: "B1:S89",
  statusCell: "B2",
  teamNameCells: ["B8", "K8"] as const,
  playerNameCells: ["C3", "C4", "L3", "L4"] as const,
  leftHeaders: ["B9", "C9", "D9", "E9", "F9", "G9", "H9", "I9", "J9"] as const,
  rightHeaders: ["K9", "L9", "M9", "N9", "O9", "P9", "Q9", "R9", "S9"] as const,
  leftShotRows: { start: 10, end: 89, shotColumn: "B", shooterColumn: "C" },
  rightShotRows: { start: 10, end: 89, shotColumn: "K", shooterColumn: "L" },
  markerColumns: Object.freeze({
    left: ["D", "E", "F", "G", "H", "I", "J"] as const,
    right: ["M", "N", "O", "P", "Q", "R", "S"] as const
  }),
  markerKeys: [
    "miss",
    "make",
    "splashOut",
    "guy",
    "tri",
    "di",
    "vom"
  ] as const,
  metadataColumns: { key: "V", value: "W" },
  rowIdentityColumns: {
    sideNumber: "X",
    teamId: "Y",
    playerId: "Z",
    rosterMembershipId: "AA"
  },
  hiddenColumns: { start: 22, end: 27 }
});

export const CANONICAL_SCORECARD_METADATA_KEYS = Object.freeze([
  "magic",
  "workbookSchemaVersion",
  "scorecardLayoutVersion",
  "tournamentId",
  "generationId",
  "generationRevision",
  "generationSourceDigest",
  "sheetId",
  "sheetKind",
  "matchId",
  "stage",
  "podId",
  "bracketMatchId",
  "team1Id",
  "team2Id"
] as const);

export type CanonicalScorecardMetadataKey =
  typeof CANONICAL_SCORECARD_METADATA_KEYS[number];

export type CanonicalScorecardSheetKind = "blank" | "game";

export const CANONICAL_SCORECARD_HEADERS = Object.freeze([
  "Shot",
  "Shooter",
  "Miss",
  "Make",
  "Splash-Out",
  "Guy",
  "Tri",
  "Di",
  "Vom"
] as const);

export const CANONICAL_WORKBOOK_LIMITS = Object.freeze({
  maximumCompressedBytes: 10 * 1024 * 1024,
  maximumUncompressedBytes: 64 * 1024 * 1024,
  maximumEntryBytes: 16 * 1024 * 1024,
  maximumEntryCount: 512,
  maximumCompressionRatio: 200,
  maximumWorksheetCount: 260,
  maximumScorecardRows: 89,
  maximumScorecardColumns: 27,
  previewLifetimeSeconds: 24 * 60 * 60,
  writerLeaseSeconds: 5 * 60
});
