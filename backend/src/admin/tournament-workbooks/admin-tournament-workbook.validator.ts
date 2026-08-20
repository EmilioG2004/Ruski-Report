import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  ApplyAdminWorkbookImportRequest,
  AssignAdminWorkbookSheetsRequest,
  GenerateAdminTournamentWorkbookRequest
} from "./admin-tournament-workbook.contracts";

export function parseGenerateWorkbookRequest(
  request: GenerateAdminTournamentWorkbookRequest | null | undefined
): { expectedTournamentRowVersion: number } {
  return {
    expectedTournamentRowVersion: positiveInteger(
      request?.expectedTournamentRowVersion,
      "expectedTournamentRowVersion"
    )
  };
}

export function parseWorkbookAssignmentsRequest(
  request: AssignAdminWorkbookSheetsRequest | null | undefined
): {
  expectedPreviewDigest?: string;
  assignments: Readonly<Record<string, string>>;
} {
  const digest = optionalDigest(request?.expectedPreviewDigest);
  const value = request?.assignments;
  if (!isObject(value)) {
    throw badRequest(
      "WORKBOOK_ASSIGNMENTS_INVALID",
      "Workbook assignments must map observation IDs to exact match IDs.",
      "assignments"
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 260) {
    throw badRequest(
      "WORKBOOK_ASSIGNMENTS_INVALID",
      "Workbook assignments must contain between one and 260 entries.",
      "assignments"
    );
  }
  const assignments: Record<string, string> = {};
  for (const [observationId, matchId] of entries) {
    if (typeof matchId !== "string" || !isStableUuid(observationId) ||
        !isStableUuid(matchId)) {
      throw badRequest(
        "WORKBOOK_ASSIGNMENT_ID_INVALID",
        "Workbook assignments require exact stable identifiers.",
        `assignments.${observationId}`
      );
    }
    assignments[observationId] = matchId;
  }
  return {
    ...(digest === undefined ? {} : { expectedPreviewDigest: digest }),
    assignments
  };
}

export function parseWorkbookApplyRequest(
  request: ApplyAdminWorkbookImportRequest | null | undefined
): {
  previewDigest: string;
  acceptedObservationIds: readonly string[];
  skippedObservationIds: readonly string[];
  correctionReasons: Readonly<Record<string, string>>;
} {
  const previewDigest = requiredDigest(request?.previewDigest);
  const acceptedObservationIds = stableUuidList(
    request?.acceptedObservationIds,
    "acceptedObservationIds"
  );
  const skippedObservationIds = request?.skippedObservationIds === undefined
    ? []
    : stableUuidList(request.skippedObservationIds, "skippedObservationIds");
  if (new Set([...acceptedObservationIds, ...skippedObservationIds]).size !==
      acceptedObservationIds.length + skippedObservationIds.length) {
    throw badRequest(
      "WORKBOOK_SELECTION_OVERLAP",
      "A workbook observation cannot be both accepted and skipped.",
      "acceptedObservationIds"
    );
  }
  const correctionReasons = parseCorrectionReasons(request?.correctionReasons);
  return {
    previewDigest,
    acceptedObservationIds,
    skippedObservationIds,
    correctionReasons
  };
}

export function parseWorkbookAssignmentForm(
  body: unknown
): AssignAdminWorkbookSheetsRequest {
  const form = flatForm(body);
  return {
    expectedPreviewDigest: form.expectedPreviewDigest,
    assignments: Object.fromEntries(
      Object.entries(form).flatMap(([name, value]) =>
        name.startsWith("assignments.")
          ? [[name.slice("assignments.".length), value]]
          : []
      )
    )
  };
}

export function parseWorkbookApplyForm(
  body: unknown,
  proposedObservationIds: readonly string[]
): ApplyAdminWorkbookImportRequest {
  const form = flatForm(body);
  const accepted = stringList(form.acceptedObservationIds) ?? [];
  const acceptedSet = new Set(accepted);
  return {
    previewDigest: form.previewDigest,
    acceptedObservationIds: accepted,
    skippedObservationIds: proposedObservationIds.filter(
      (observationId) => !acceptedSet.has(observationId)
    ),
    correctionReasons: Object.fromEntries(
      Object.entries(form).flatMap(([name, value]) =>
        name.startsWith("correctionReasons.")
          ? [[name.slice("correctionReasons.".length), value]]
          : []
      )
    )
  };
}

function parseCorrectionReasons(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) {
    return {};
  }
  if (!isObject(value) || Object.keys(value).length > 260) {
    throw badRequest(
      "WORKBOOK_CORRECTION_REASONS_INVALID",
      "Workbook correction reasons are invalid.",
      "correctionReasons"
    );
  }
  const reasons: Record<string, string> = {};
  for (const [observationId, reason] of Object.entries(value)) {
    if (!isStableUuid(observationId) || typeof reason !== "string") {
      throw badRequest(
        "WORKBOOK_CORRECTION_REASON_INVALID",
        "Workbook correction reasons require stable observation identifiers.",
        `correctionReasons.${observationId}`
      );
    }
    const normalized = reason.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (normalized.length === 0 || normalized.length > 500) {
      throw badRequest(
        "WORKBOOK_CORRECTION_REASON_INVALID",
        "A correction reason must contain between one and 500 characters.",
        `correctionReasons.${observationId}`
      );
    }
    reasons[observationId] = normalized;
  }
  return reasons;
}

function stableUuidList(value: unknown, path: string): readonly string[] {
  const values = stringList(value);
  if (values === undefined) {
    throw badRequest(
      "WORKBOOK_SELECTION_INVALID",
      "Workbook selections require unique stable observation identifiers.",
      path
    );
  }
  if (values.length > 260 || values.some((item) => !isStableUuid(item)) ||
      new Set(values).size !== values.length) {
    throw badRequest(
      "WORKBOOK_SELECTION_INVALID",
      "Workbook selections require unique stable observation identifiers.",
      path
    );
  }
  return values;
}

function stringList(value: unknown): string[] | undefined {
  if (value === undefined) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  return undefined;
}

function positiveInteger(value: unknown, path: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) {
    throw badRequest(
      "WORKBOOK_ROW_VERSION_INVALID",
      "The expected tournament row version must be a positive integer.",
      path
    );
  }
  return Number(parsed);
}

function requiredDigest(value: unknown): string {
  const digest = optionalDigest(value);
  if (digest === undefined) {
    throw badRequest(
      "WORKBOOK_PREVIEW_DIGEST_INVALID",
      "A valid workbook preview digest is required.",
      "previewDigest"
    );
  }
  return digest;
}

function optionalDigest(value: unknown): string | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw badRequest(
      "WORKBOOK_PREVIEW_DIGEST_INVALID",
      "The workbook preview digest is invalid.",
      "previewDigest"
    );
  }
  return value;
}

function flatForm(body: unknown): Record<string, string | string[]> {
  if (!isObject(body)) {
    throw badRequest(
      "WORKBOOK_FORM_INVALID",
      "The workbook form is invalid.",
      "body"
    );
  }
  const entries = Object.entries(body);
  if (entries.length > 800 || entries.some(([, value]) =>
    typeof value !== "string" &&
    !(Array.isArray(value) && value.every((item) => typeof item === "string"))
  )) {
    throw badRequest(
      "WORKBOOK_FORM_INVALID",
      "The workbook form is invalid.",
      "body"
    );
  }
  return Object.fromEntries(entries) as Record<string, string | string[]>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(code: string, message: string, path: string): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: 400,
    details: [{ code, message, path }]
  });
}
