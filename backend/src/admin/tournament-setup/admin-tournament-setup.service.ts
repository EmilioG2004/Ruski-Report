import { randomUUID } from "node:crypto";

import { HttpStatus, Injectable } from "@nestjs/common";

import { AppError } from "../../errors";
import {
  copyTournamentConfiguration,
  createMainTournamentConfiguration
} from "../../tournament-engine/configuration";
import {
  parseStableUuid,
  StableUuidKind,
  TournamentId,
  TournamentSetup
} from "../../tournament-engine/domain";
import {
  AdminTournamentSetupRecord,
  DraftPlayerInput,
  DraftPodInput,
  DraftTeamInput,
  EngineAuditCommand,
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError,
  PostgresTournamentSetupRepository
} from "../../tournament-engine/persistence";
import { createTournamentSetupPreview } from "../../tournament-engine/setup";
import {
  AdministratorPrincipal,
  AdministratorSecurityAuditService
} from "../security";
import {
  AdminTournamentDetailResponse,
  AdminTournamentSetupPreviewResponse,
  AdminTournamentSetupPublicationResponse,
  AdminTournamentSummaryResponse,
  CreateAdminTournamentRequest,
  PreviewAdminTournamentSetupRequest,
  PublishAdminTournamentSetupRequest,
  ReplaceAdminTournamentSetupRequest
} from "./admin-tournament-setup.contracts";
import {
  AdminTournamentSetupValidator,
  canonicalWorkbookCapacityIssues,
  ValidatedDraftPlayerRequest
} from "./admin-tournament-setup.validator";

@Injectable()
export class AdminTournamentSetupService {
  constructor(
    private readonly repository: PostgresTournamentSetupRepository,
    private readonly validator: AdminTournamentSetupValidator,
    private readonly securityAudit: AdministratorSecurityAuditService
  ) {}

  async list(): Promise<AdminTournamentSummaryResponse[]> {
    return (await this.repository.list()).map(mapSummary);
  }

  async create(
    request: CreateAdminTournamentRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentDetailResponse> {
    return this.auditedMutation(
      "administrator_tournament_created",
      principal,
      undefined,
      async () => {
        const validated = this.validator.parseCreate(request);
        const tournamentId = stableId("tournament");
        const configuration = validated.configuration.kind === "preset"
          ? createMainTournamentConfiguration()
          : copyTournamentConfiguration(validated.configuration.value);
        const createdAt = now();
        const pods: DraftPodInput[] = Array.from(
          { length: configuration.podCount },
          (_, index) => {
            const id = stableId("pod");
            const name = `Pod ${index + 1}`;
            return {
              id,
              publicKey: id,
              name,
              normalizedName: normalizeName(name),
              sequence: index + 1
            };
          }
        );

        try {
          const result = await this.repository.createDraft({
            tournament: {
              id: tournamentId,
              publicKey: tournamentId,
              gameType: "ruski",
              year: validated.year,
              name: validated.name,
              visibility: "private"
            },
            configuration,
            pods,
            teams: [],
            createdAt,
            audit: auditCommand(
              principal.administratorId,
              "tournament_draft_created",
              createdAt,
              { podCount: pods.length, teamCount: 0 }
            )
          });
          return mapDetail({
            tournament: {
              tournamentId,
              publicKey: tournamentId,
              gameType: "ruski",
              year: validated.year,
              name: validated.name,
              lifecycle: "draft_setup",
              visibility: "private",
              rowVersion: result.rowVersion,
              setupPublishedAt: null,
              createdAt,
              updatedAt: createdAt
            },
            configuration,
            pods,
            teams: []
          });
        } catch (error) {
          throw mapPersistenceError(error);
        }
      }
    );
  }

  async get(tournamentIdValue: string): Promise<AdminTournamentDetailResponse> {
    const record = await this.findRequired(tournamentIdValue);
    return mapDetail(record);
  }

  async replaceDraft(
    tournamentIdValue: string,
    request: ReplaceAdminTournamentSetupRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentDetailResponse> {
    return this.auditedMutation(
      "administrator_tournament_setup_updated",
      principal,
      tournamentIdValue,
      async () => {
        const current = await this.findRequired(tournamentIdValue);
        requireDraft(current);
        const validated = this.validator.parseReplacement(request, current);
        requireExpectedVersion(current, validated.expectedRowVersion);
        const updatedAt = now();
        const pods = validated.pods.map((pod) => {
          const existing = current.pods.find((item) => item.id === pod.id);
          if (existing === undefined) {
            throw invalidDraftIdentity("Pod ID does not belong to this draft.");
          }
          return {
            ...existing,
            name: pod.name,
            normalizedName: pod.normalizedName
          };
        });
        const currentTeams = new Map<
          string,
          AdminTournamentSetupRecord["teams"][number]
        >(current.teams.map((team) => [team.id, team]));
        const currentPlayers = new Map<string, DraftPlayerInput>(
          current.teams.flatMap((team) =>
            team.players.map((player) => [player.id, player] as const)
          )
        );
        const teams: DraftTeamInput[] = validated.teams.map((team, teamIndex) => {
          const existing = team.id === undefined
            ? undefined
            : currentTeams.get(parseStableUuid(team.id, "tournament_team"));
          const id = existing?.id ?? stableId("tournament_team");
          return {
            id,
            publicKey: existing?.publicKey ?? id,
            name: team.name,
            normalizedName: team.normalizedName,
            sequence: teamIndex + 1,
            podId: parseStableUuid(team.podId, "pod"),
            initialSeed: team.initialSeed,
            players: team.players.map((player, playerIndex) =>
              resolvePlayer(player, currentPlayers, playerIndex)
            ),
            metadata: existing?.metadata
          };
        });

        try {
          const result = await this.repository.replaceDraft({
            tournamentId: current.tournament.tournamentId,
            expectedRowVersion: validated.expectedRowVersion,
            pods,
            teams,
            updatedAt,
            audit: auditCommand(
              principal.administratorId,
              "tournament_draft_setup_updated",
              updatedAt,
              { podCount: pods.length, teamCount: teams.length }
            )
          });
          return mapDetail({
            tournament: {
              ...current.tournament,
              rowVersion: result.rowVersion,
              updatedAt
            },
            configuration: current.configuration,
            pods,
            teams
          });
        } catch (error) {
          throw mapPersistenceError(error);
        }
      }
    );
  }

  async preview(
    tournamentIdValue: string,
    request: PreviewAdminTournamentSetupRequest | null | undefined
  ): Promise<AdminTournamentSetupPreviewResponse> {
    const current = await this.findRequired(tournamentIdValue);
    requireDraft(current);
    const expectedRowVersion = this.validator.parsePreview(request);
    requireExpectedVersion(current, expectedRowVersion);
    return mapPreview(current);
  }

  async publish(
    tournamentIdValue: string,
    request: PublishAdminTournamentSetupRequest | null | undefined,
    principal: AdministratorPrincipal
  ): Promise<AdminTournamentSetupPublicationResponse> {
    return this.auditedMutation(
      "administrator_tournament_setup_published",
      principal,
      tournamentIdValue,
      async () => {
        const current = await this.findRequired(tournamentIdValue);
        requireDraft(current);
        const validated = this.validator.parsePublish(request);
        requireExpectedVersion(current, validated.expectedRowVersion);
        const preview = mapPreview(current);
        if (!preview.publishable || preview.previewDigest === null) {
          throw new AppError({
            code: "VALIDATION_FAILED",
            message: "Tournament setup is not ready to publish.",
            statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
            details: [...preview.issues]
          });
        }
        if (preview.previewDigest !== validated.previewDigest) {
          throw conflict(
            "Schedule preview no longer matches the tournament setup.",
            "PREVIEW_DIGEST_MISMATCH"
          );
        }
        const publishedAt = now();
        try {
          const result = await this.repository.publishSetup({
            tournamentId: current.tournament.tournamentId,
            expectedRowVersion: validated.expectedRowVersion,
            expectedPreviewDigest: validated.previewDigest,
            visibility: validated.visibility,
            publishedAt,
            audit: auditCommand(
              principal.administratorId,
              "tournament_setup_published",
              publishedAt,
              {
                matchCount: preview.matchCount,
                visibility: validated.visibility,
                previewDigest: validated.previewDigest
              }
            )
          });
          return {
            tournamentId: result.tournamentId,
            lifecycle: "setup_published",
            visibility: validated.visibility,
            rowVersion: result.rowVersion,
            setupPublishedAt: result.setupPublishedAt,
            matchCount: result.matchCount
          };
        } catch (error) {
          throw mapPersistenceError(error);
        }
      }
    );
  }

  private async findRequired(value: string): Promise<AdminTournamentSetupRecord> {
    let tournamentId: TournamentId;
    try {
      tournamentId = parseStableUuid(value, "tournament");
    } catch {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Tournament ID must be a non-nil UUID.",
        statusCode: HttpStatus.BAD_REQUEST,
        details: [{ code: "INVALID_TOURNAMENT_ID", message: "Tournament ID is invalid.", path: "tournamentId" }]
      });
    }
    const record = await this.repository.findById(tournamentId);
    if (record === null) {
      throw new AppError({
        code: "NOT_FOUND",
        message: "Tournament was not found.",
        statusCode: HttpStatus.NOT_FOUND
      });
    }
    return record;
  }

  private async auditedMutation<T>(
    eventType: string,
    principal: AdministratorPrincipal,
    targetId: string | undefined,
    operation: () => Promise<T>
  ): Promise<T> {
    let result: T;
    try {
      result = await operation();
    } catch (error) {
      await this.recordSecurityAuditBestEffort({
        eventType,
        outcome: "rejected",
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        targetType: "tournament",
        targetId,
        reasonCode: errorReasonCode(error)
      });
      throw error;
    }
    await this.recordSecurityAuditBestEffort({
      eventType,
      outcome: "accepted",
      administratorId: principal.administratorId,
      sessionId: principal.sessionId,
      targetType: "tournament",
      targetId
    });
    return result;
  }

  private async recordSecurityAuditBestEffort(
    input: Parameters<AdministratorSecurityAuditService["recordEvent"]>[0]
  ): Promise<void> {
    try {
      await this.securityAudit.recordEvent(input);
    } catch {
      // The engine audit is committed atomically with the command. A secondary
      // security-audit outage must not make a committed command look rejected.
    }
  }
}

function resolvePlayer(
  input: ValidatedDraftPlayerRequest,
  current: ReadonlyMap<string, DraftPlayerInput>,
  playerIndex: number
): DraftPlayerInput {
  const existing = input.id === undefined
    ? undefined
    : current.get(parseStableUuid(input.id, "tournament_player"));
  const id = existing?.id ?? stableId("tournament_player");
  const membershipId = existing?.membershipId ?? stableId("roster_membership");
  return {
    id,
    publicKey: existing?.publicKey ?? id,
    displayName: input.displayName,
    ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
    ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
    ...(input.preferredName === undefined
      ? {}
      : { preferredName: input.preferredName }),
    membershipId,
    membershipPublicKey: existing?.membershipPublicKey ?? membershipId,
    rosterSlot: playerIndex + 1,
    metadata: existing?.metadata
  };
}

function mapSummary(
  record: AdminTournamentSetupRecord["tournament"]
): AdminTournamentSummaryResponse {
  return {
    id: record.tournamentId,
    publicKey: record.publicKey,
    gameType: record.gameType,
    year: record.year,
    name: record.name,
    lifecycle: record.lifecycle,
    visibility: record.visibility,
    rowVersion: record.rowVersion,
    setupPublishedAt: record.setupPublishedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapDetail(record: AdminTournamentSetupRecord): AdminTournamentDetailResponse {
  const preview = createTournamentSetupPreview(
    record.configuration,
    toSetup(record),
    record.tournament.rowVersion
  );
  const capacityIssues = canonicalWorkbookCapacityIssues(record.configuration);
  return {
    tournament: mapSummary(record.tournament),
    configuration: record.configuration,
    pods: record.pods.map((pod) => ({
      id: pod.id,
      name: pod.name,
      sequence: pod.sequence
    })),
    teams: record.teams.map((team) => ({
      id: team.id,
      name: team.name,
      sequence: team.sequence,
      podId: team.podId,
      initialSeed: team.initialSeed,
      players: team.players.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        ...(player.firstName === undefined ? {} : { firstName: player.firstName }),
        ...(player.lastName === undefined ? {} : { lastName: player.lastName }),
        ...(player.preferredName === undefined
          ? {}
          : { preferredName: player.preferredName })
      }))
    })),
    validation: {
      publishable: preview.valid && capacityIssues.length === 0,
      issues: [...preview.issues, ...capacityIssues]
    }
  };
}

function mapPreview(
  record: AdminTournamentSetupRecord
): AdminTournamentSetupPreviewResponse {
  const preview = createTournamentSetupPreview(
    record.configuration,
    toSetup(record),
    record.tournament.rowVersion
  );
  const capacityIssues = canonicalWorkbookCapacityIssues(record.configuration);
  return {
    tournamentId: record.tournament.tournamentId,
    rowVersion: record.tournament.rowVersion,
    publishable: preview.valid && capacityIssues.length === 0,
    issues: [...preview.issues, ...capacityIssues],
    previewDigest: capacityIssues.length === 0 ? preview.digest : null,
    matchCount: preview.matches.length,
    matches: preview.matches
  };
}

function toSetup(record: AdminTournamentSetupRecord): TournamentSetup {
  return {
    tournamentId: record.tournament.tournamentId,
    teams: record.teams.map((team) => ({
      id: team.id,
      name: team.name,
      playerIds: team.players.map((player) => player.id)
    })),
    pods: record.pods.map((pod) => ({
      id: pod.id,
      name: pod.name,
      sequence: pod.sequence,
      teamAssignments: record.teams
        .filter((team) => team.podId === pod.id)
        .sort((first, second) => first.initialSeed - second.initialSeed)
        .map((team) => ({ teamId: team.id, initialSeed: team.initialSeed }))
    }))
  };
}

function requireDraft(record: AdminTournamentSetupRecord): void {
  if (record.tournament.lifecycle !== "draft_setup") {
    throw conflict(
      "Published tournament setup cannot be edited.",
      "TOURNAMENT_SETUP_LOCKED"
    );
  }
}

function requireExpectedVersion(
  record: AdminTournamentSetupRecord,
  expectedRowVersion: number
): void {
  if (record.tournament.rowVersion !== expectedRowVersion) {
    throw conflict(
      "Tournament setup changed after this request was prepared.",
      "STALE_TOURNAMENT_VERSION"
    );
  }
}

function mapPersistenceError(error: unknown): unknown {
  if (error instanceof EnginePersistenceConflictError) {
    return conflict(error.message, "TOURNAMENT_SETUP_CONFLICT");
  }
  if (error instanceof EnginePersistenceInvariantError) {
    return new AppError({
      code: "VALIDATION_FAILED",
      message: error.message,
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY
    });
  }
  return error;
}

function invalidDraftIdentity(message: string): AppError {
  return new AppError({
    code: "BAD_REQUEST",
    message,
    statusCode: HttpStatus.BAD_REQUEST
  });
}

function conflict(message: string, detailCode: string): AppError {
  return new AppError({
    code: "CONFLICT",
    message,
    statusCode: HttpStatus.CONFLICT,
    details: [{ code: detailCode, message }]
  });
}

function auditCommand(
  administratorId: string,
  commandType: string,
  occurredAt: string,
  details: Record<string, unknown>
): EngineAuditCommand {
  return {
    eventId: randomUUID(),
    commandType,
    actor: { kind: "administrator", id: administratorId },
    occurredAt,
    details
  };
}

function stableId<Kind extends StableUuidKind>(kind: Kind) {
  return parseStableUuid(randomUUID(), kind);
}

function normalizeName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}

function errorReasonCode(error: unknown): string {
  if (error instanceof AppError) {
    return error.details[0]?.code ?? error.code;
  }
  return "INTERNAL_ERROR";
}

function now(): string {
  return new Date().toISOString();
}
