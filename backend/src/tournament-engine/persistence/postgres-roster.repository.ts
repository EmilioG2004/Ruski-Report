import { PostgresDatabase } from "../../database";
import { TransactionContext } from "../../repositories/transaction";
import {
  ReplaceRosterPlayerInput,
  RosterRepositoryContract,
  RosterReplacementResult
} from "./contracts";
import { TournamentEngineTransactionManager } from "./engine-transaction.manager";
import {
  EnginePersistenceConflictError,
  EnginePersistenceInvariantError
} from "./errors";
import {
  engineExecutor,
  EnginePostgresExecutor,
  lockEngineTournament,
  writeEngineAuditEvent,
  writeEngineJson
} from "./postgres-engine-executor";
import {
  CanonicalProjectionActivationResult,
  PostgresProjectionRepository
} from "./postgres-projection.repository";
import {
  CanonicalProjectionActivationListener,
  notifyCanonicalProjectionActivation,
  refreshCanonicalProjectionInTransaction
} from "./projection-refresh";

interface LockedTournamentRow {
  lifecycle: string;
  row_version: string | number;
}

interface LockedMembershipRow {
  roster_slot: number;
  closed_at: Date | string | null;
}

export class PostgresRosterRepository implements RosterRepositoryContract {
  private readonly transactions: TournamentEngineTransactionManager;

  constructor(
    private readonly database: PostgresDatabase,
    transactions?: TournamentEngineTransactionManager,
    private readonly projections?: PostgresProjectionRepository,
    private readonly projectionListener?: CanonicalProjectionActivationListener
  ) {
    this.transactions = transactions ?? new TournamentEngineTransactionManager(database);
  }

  async replacePlayer(
    input: ReplaceRosterPlayerInput
  ): Promise<RosterReplacementResult> {
    let projection: CanonicalProjectionActivationResult | undefined;
    const result = await this.transactions.run(async (transaction) => {
      const replacement = await this.replacePlayerInTransaction(
        input,
        transaction
      );
      projection = await refreshCanonicalProjectionInTransaction(
        this.projections,
        {
          tournamentId: input.tournamentId,
          expectedTournamentRowVersion: replacement.rowVersion,
          occurredAt: input.effectiveAt,
          sourceCommandType: input.audit.commandType,
          actor: input.audit.actor,
          sourceEventId: input.audit.eventId,
          correlationId: input.audit.correlationId
        },
        transaction
      );
      return replacement;
    });
    notifyCanonicalProjectionActivation(this.projectionListener, projection);
    return result;
  }

  async replacePlayerInTransaction(
    input: ReplaceRosterPlayerInput,
    transaction: TransactionContext
  ): Promise<RosterReplacementResult> {
    const executor = engineExecutor(this.database, transaction);
    await lockEngineTournament(executor, input.tournamentId);
    const tournament = await this.lockTournament(executor, input.tournamentId);

    if (
      !["setup_published", "pod_play", "seeding_review", "playoffs"].includes(
        tournament.lifecycle
      )
    ) {
      throw new EnginePersistenceConflictError(
        "Roster replacement is available only for a published active tournament."
      );
    }
    if (Number(tournament.row_version) !== input.expectedTournamentRowVersion) {
      throw new EnginePersistenceConflictError(
        "Tournament roster changed after the replacement command was prepared."
      );
    }

    const membership = await this.lockMembership(executor, input);
    if (membership.closed_at !== null) {
      throw new EnginePersistenceConflictError(
        "The selected roster membership has already been closed."
      );
    }
    if (membership.roster_slot !== input.replacement.rosterSlot) {
      throw new EnginePersistenceInvariantError(
        "A replacement must preserve the closed membership's roster slot."
      );
    }

    const closed = await executor.query(
      `
        UPDATE engine_roster_memberships
        SET closed_at = $2,
            closed_by = $3,
            replacement_reason = $4
        WHERE id = $1::uuid AND closed_at IS NULL
      `,
      [
        input.replacedMembershipId,
        input.effectiveAt,
        input.actorId,
        input.reason
      ]
    );
    if (closed.rowCount !== 1) {
      throw new EnginePersistenceConflictError(
        "The selected roster membership could not be closed."
      );
    }

    const replacement = input.replacement;
    await executor.query(
      `
        INSERT INTO engine_players (
          id, tournament_id, public_key, display_name, first_name,
          last_name, preferred_name, created_at, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9::jsonb
        )
      `,
      [
        replacement.id,
        input.tournamentId,
        replacement.publicKey,
        replacement.displayName,
        replacement.firstName ?? null,
        replacement.lastName ?? null,
        replacement.preferredName ?? null,
        input.effectiveAt,
        writeEngineJson(replacement.metadata ?? {})
      ]
    );
    await executor.query(
      `
        INSERT INTO engine_roster_memberships (
          id, tournament_id, public_key, team_id, player_id, roster_slot,
          opened_at, opened_by, metadata
        ) VALUES (
          $1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6,
          $7, $8, $9::jsonb
        )
      `,
      [
        replacement.membershipId,
        input.tournamentId,
        replacement.membershipPublicKey,
        input.teamId,
        replacement.id,
        replacement.rosterSlot,
        input.effectiveAt,
        input.actorId,
        writeEngineJson({})
      ]
    );

    const versionResult = await executor.query<{ row_version: string | number }>(
      `
        UPDATE engine_tournaments
        SET row_version = row_version + 1,
            updated_at = $3
        WHERE id = $1::uuid AND row_version = $2
        RETURNING row_version
      `,
      [
        input.tournamentId,
        input.expectedTournamentRowVersion,
        input.effectiveAt
      ]
    );
    const rowVersion = versionResult.rows[0]?.row_version;
    if (rowVersion === undefined) {
      throw new EnginePersistenceConflictError(
        "Tournament roster could not be advanced at the expected version."
      );
    }

    await writeEngineAuditEvent(executor, input.tournamentId, input.audit);
    return {
      tournamentId: input.tournamentId,
      lifecycle: tournament.lifecycle as RosterReplacementResult["lifecycle"],
      rowVersion: Number(rowVersion),
      closedMembershipId: input.replacedMembershipId,
      openedMembershipId: replacement.membershipId,
      playerId: replacement.id
    };
  }

  private async lockTournament(
    executor: EnginePostgresExecutor,
    tournamentId: string
  ): Promise<LockedTournamentRow> {
    const result = await executor.query<LockedTournamentRow>(
      `
        SELECT lifecycle, row_version
        FROM engine_tournaments
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [tournamentId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError("Tournament was not found.");
    }
    return row;
  }

  private async lockMembership(
    executor: EnginePostgresExecutor,
    input: ReplaceRosterPlayerInput
  ): Promise<LockedMembershipRow> {
    const result = await executor.query<LockedMembershipRow>(
      `
        SELECT roster_slot, closed_at
        FROM engine_roster_memberships
        WHERE id = $1::uuid
          AND tournament_id = $2::uuid
          AND team_id = $3::uuid
        FOR UPDATE
      `,
      [input.replacedMembershipId, input.tournamentId, input.teamId]
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new EnginePersistenceInvariantError(
        "Roster membership was not found for the selected team."
      );
    }
    return row;
  }
}
