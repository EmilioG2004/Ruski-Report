import { parseStableUuid } from "../../tournament-engine/domain";
import {
  AdminTournamentSetupRecord,
  PostgresTournamentSetupRepository
} from "../../tournament-engine/persistence";
import {
  completeMainTournamentFixture,
  completeSmallTournamentFixture
} from "../../tournament-engine/setup";
import {
  AdministratorPrincipal,
  AdministratorSecurityAuditService
} from "../security";
import { AdminTournamentSetupService } from "./admin-tournament-setup.service";
import { AdminTournamentSetupValidator } from "./admin-tournament-setup.validator";

describe("AdminTournamentSetupService", () => {
  const principal: AdministratorPrincipal = {
    administratorId: "00000000-0000-4000-8000-000000009001",
    loginName: "operator",
    displayName: "Tournament Operator",
    sessionId: "00000000-0000-4000-8000-000000009002",
    authenticatedAt: "2027-01-01T00:00:00.000Z",
    expiresAt: "2027-01-02T00:00:00.000Z"
  };
  let repository: jest.Mocked<PostgresTournamentSetupRepository>;
  let securityAudit: { recordEvent: jest.Mock };
  let service: AdminTournamentSetupService;

  beforeEach(() => {
    repository = {
      list: jest.fn(),
      findById: jest.fn(),
      createDraft: jest.fn(),
      replaceDraft: jest.fn(),
      publishSetup: jest.fn()
    } as unknown as jest.Mocked<PostgresTournamentSetupRepository>;
    securityAudit = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    service = new AdminTournamentSetupService(
      repository,
      new AdminTournamentSetupValidator(),
      securityAudit as unknown as AdministratorSecurityAuditService
    );
  });

  it("lists multiple same-year tournaments independently", async () => {
    const first = setupRecord(false).tournament;
    const second = {
      ...first,
      tournamentId: parseStableUuid(
        "00000000-0000-4000-8000-000000000099",
        "tournament"
      ),
      publicKey: "00000000-0000-4000-8000-000000000099",
      name: "Second Tournament"
    };
    repository.list.mockResolvedValue([first, second]);

    const result = await service.list();

    expect(result).toHaveLength(2);
    expect(result.map((tournament) => tournament.year)).toEqual([2027, 2027]);
    expect(new Set(result.map((tournament) => tournament.id)).size).toBe(2);
  });

  it("creates a private main-preset draft with a fixed pod skeleton", async () => {
    let stored: AdminTournamentSetupRecord | undefined;
    repository.createDraft.mockImplementation(async (input) => {
      stored = recordFromInput(input);
      return {
        tournamentId: input.tournament.id,
        lifecycle: "draft_setup",
        rowVersion: 1
      };
    });
    repository.findById.mockImplementation(async () => stored ?? null);

    const result = await service.create({
      name: "  2027   Main  ",
      year: 2027,
      configuration: {
        kind: "preset",
        presetId: "ruski-main-32-team"
      }
    }, principal);

    const command = repository.createDraft.mock.calls[0][0];
    expect(command.tournament).toMatchObject({
      name: "2027 Main",
      visibility: "private",
      gameType: "ruski"
    });
    expect(command.pods).toHaveLength(8);
    expect(command.teams).toEqual([]);
    expect(result.validation.publishable).toBe(false);
    expect(securityAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "accepted" })
    );
  });

  it("saves a structurally safe partial draft and preserves supplied IDs", async () => {
    const current = setupRecord(false);
    repository.findById.mockResolvedValue(current);
    repository.replaceDraft.mockResolvedValue({
      tournamentId: current.tournament.tournamentId,
      lifecycle: "draft_setup",
      rowVersion: 2
    });
    const firstTeam = current.teams[0];

    await service.replaceDraft(current.tournament.tournamentId, {
      expectedRowVersion: 1,
      pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
      teams: [{
        id: firstTeam.id,
        name: "Updated Team",
        podId: firstTeam.podId,
        initialSeed: 1,
        players: firstTeam.players.map((player) => ({
          id: player.id,
          displayName: player.displayName
        }))
      }]
    }, principal);

    const command = repository.replaceDraft.mock.calls[0][0];
    expect(command.teams).toHaveLength(1);
    expect(command.teams[0]).toMatchObject({
      id: firstTeam.id,
      publicKey: firstTeam.publicKey,
      name: "Updated Team",
      sequence: 1
    });
    expect(command.teams[0].players.map((player) => player.id)).toEqual(
      firstTeam.players.map((player) => player.id)
    );
    expect(command.audit.actor.id).toBe(principal.administratorId);
  });

  it("preserves a current player identity when draft team assignments change", async () => {
    const current = setupRecord(false);
    repository.findById.mockResolvedValue(current);
    repository.replaceDraft.mockResolvedValue({
      tournamentId: current.tournament.tournamentId,
      lifecycle: "draft_setup",
      rowVersion: 2
    });
    const firstTeam = current.teams[0];
    const secondTeam = current.teams[1];
    const movedPlayer = firstTeam.players[0];

    await service.replaceDraft(current.tournament.tournamentId, {
      expectedRowVersion: 1,
      pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
      teams: [{
        id: secondTeam.id,
        name: secondTeam.name,
        podId: secondTeam.podId,
        initialSeed: secondTeam.initialSeed,
        players: [{ id: movedPlayer.id, displayName: movedPlayer.displayName }]
      }]
    }, principal);

    const player = repository.replaceDraft.mock.calls[0][0].teams[0].players[0];
    expect(player).toMatchObject({
      id: movedPlayer.id,
      publicKey: movedPlayer.publicKey,
      membershipId: movedPlayer.membershipId,
      membershipPublicKey: movedPlayer.membershipPublicKey
    });
  });

  it("previews the complete main setup with 48 matches and no client schedule", async () => {
    const current = setupRecord(true);
    repository.findById.mockResolvedValue(current);

    const preview = await service.preview(current.tournament.tournamentId, {
      expectedRowVersion: 1
    });

    expect(preview.publishable).toBe(true);
    expect(preview.matchCount).toBe(48);
    expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("publishes only the confirmed digest and administrator visibility", async () => {
    const current = setupRecord(false);
    repository.findById.mockResolvedValue(current);
    const preview = await service.preview(current.tournament.tournamentId, {
      expectedRowVersion: 1
    });
    repository.publishSetup.mockResolvedValue({
      tournamentId: current.tournament.tournamentId,
      lifecycle: "setup_published",
      rowVersion: 2,
      matchCount: 2,
      setupPublishedAt: "2027-01-02T00:00:00.000Z"
    });

    await service.publish(current.tournament.tournamentId, {
      expectedRowVersion: 1,
      previewDigest: preview.previewDigest,
      visibility: "public"
    }, principal);

    expect(repository.publishSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedPreviewDigest: preview.previewDigest,
        visibility: "public",
        audit: expect.objectContaining({
          actor: { kind: "administrator", id: principal.administratorId }
        })
      })
    );
    expect(repository.publishSetup.mock.calls[0][0]).not.toHaveProperty("schedule");
  });

  it("rejects incomplete publication and audits the rejection", async () => {
    const current = { ...setupRecord(false), teams: [] };
    repository.findById.mockResolvedValue(current);

    await expect(service.publish(current.tournament.tournamentId, {
      expectedRowVersion: 1,
      previewDigest: "a".repeat(64),
      visibility: "private"
    }, principal)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      statusCode: 422
    });
    expect(repository.publishSetup).not.toHaveBeenCalled();
    expect(securityAudit.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "rejected" })
    );
  });

  it("rejects stale edits before persistence", async () => {
    const base = setupRecord(false);
    const current = {
      ...base,
      tournament: { ...base.tournament, rowVersion: 3 }
    };
    repository.findById.mockResolvedValue(current);

    await expect(service.replaceDraft(current.tournament.tournamentId, {
      expectedRowVersion: 2,
      pods: current.pods.map((pod) => ({ id: pod.id, name: pod.name })),
      teams: current.teams.map((team) => ({
        id: team.id,
        name: team.name,
        podId: team.podId,
        initialSeed: team.initialSeed,
        players: team.players.map((player) => ({
          id: player.id,
          displayName: player.displayName
        }))
      }))
    }, principal)).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
    expect(repository.replaceDraft).not.toHaveBeenCalled();
  });

  it("does not report a committed command as failed when security audit is unavailable", async () => {
    let stored: AdminTournamentSetupRecord | undefined;
    repository.createDraft.mockImplementation(async (input) => {
      stored = recordFromInput(input);
      return {
        tournamentId: input.tournament.id,
        lifecycle: "draft_setup",
        rowVersion: 1
      };
    });
    repository.findById.mockImplementation(async () => stored ?? null);
    securityAudit.recordEvent.mockRejectedValue(new Error("audit unavailable"));

    await expect(service.create({
      name: "Resilient Tournament",
      year: 2027,
      configuration: {
        kind: "preset",
        presetId: "ruski-main-32-team"
      }
    }, principal)).resolves.toMatchObject({
      tournament: { name: "Resilient Tournament" }
    });
    expect(repository.createDraft).toHaveBeenCalledTimes(1);
  });
});

function setupRecord(main: boolean): AdminTournamentSetupRecord {
  const fixture = main
    ? completeMainTournamentFixture
    : completeSmallTournamentFixture;
  return {
    tournament: {
      tournamentId: fixture.setup.tournamentId,
      publicKey: fixture.setup.tournamentId,
      gameType: "ruski",
      year: 2027,
      name: "Sanitized Tournament",
      lifecycle: "draft_setup",
      visibility: "private",
      rowVersion: 1,
      setupPublishedAt: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z"
    },
    configuration: fixture.configuration,
    pods: fixture.setup.pods.map((pod) => ({
      id: pod.id,
      publicKey: pod.id,
      name: pod.name,
      normalizedName: pod.name.toLowerCase(),
      sequence: pod.sequence
    })),
    teams: fixture.setup.teams.map((team, teamIndex) => {
      const assignment = fixture.setup.pods
        .flatMap((pod) => pod.teamAssignments.map((item) => ({ pod, item })))
        .find(({ item }) => item.teamId === team.id);
      if (assignment === undefined) {
        throw new Error("Fixture team assignment is missing.");
      }
      return {
        id: team.id,
        publicKey: team.id,
        name: team.name,
        normalizedName: team.name.toLowerCase(),
        sequence: teamIndex + 1,
        podId: assignment.pod.id,
        initialSeed: assignment.item.initialSeed,
        players: team.playerIds.map((playerId, playerIndex) => ({
          id: playerId,
          publicKey: playerId,
          displayName: `Player ${teamIndex + 1}-${playerIndex + 1}`,
          membershipId: parseStableUuid(playerId, "roster_membership"),
          membershipPublicKey: playerId,
          rosterSlot: playerIndex + 1
        }))
      };
    })
  };
}

function recordFromInput(
  input: Parameters<PostgresTournamentSetupRepository["createDraft"]>[0]
): AdminTournamentSetupRecord {
  return {
    tournament: {
      tournamentId: input.tournament.id,
      publicKey: input.tournament.publicKey,
      gameType: input.tournament.gameType,
      year: input.tournament.year,
      name: input.tournament.name,
      lifecycle: "draft_setup",
      visibility: input.tournament.visibility,
      rowVersion: 1,
      setupPublishedAt: null,
      createdAt: input.createdAt,
      updatedAt: input.createdAt
    },
    configuration: input.configuration,
    pods: input.pods,
    teams: input.teams
  };
}
