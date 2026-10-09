import { randomUUID } from "node:crypto";

import { TransactionContext } from "../../repositories/transaction";
import { TournamentId } from "../domain";
import { EngineAuditActor, EngineAuditCommand } from "./contracts";
import {
  CanonicalProjectionActivationResult,
  PostgresProjectionRepository
} from "./postgres-projection.repository";

export type CanonicalProjectionActivationListener = (
  result: CanonicalProjectionActivationResult
) => void;

export const CANONICAL_PROJECTION_ACTIVATION_LISTENER = Symbol(
  "CANONICAL_PROJECTION_ACTIVATION_LISTENER"
);

export interface RefreshCanonicalProjectionInput {
  tournamentId: TournamentId;
  expectedTournamentRowVersion: number;
  occurredAt: string;
  sourceCommandType: string;
  actor: EngineAuditActor;
  sourceEventId?: string;
  correlationId?: string;
}

export async function refreshCanonicalProjectionInTransaction(
  projections: PostgresProjectionRepository | undefined,
  input: RefreshCanonicalProjectionInput,
  transaction: TransactionContext
): Promise<CanonicalProjectionActivationResult | undefined> {
  if (projections === undefined) {
    return undefined;
  }

  return projections.buildAndActivateCanonicalInTransaction({
    tournamentId: input.tournamentId,
    expectedTournamentRowVersion: input.expectedTournamentRowVersion,
    createdAt: input.occurredAt,
    activatedAt: input.occurredAt,
    audit: projectionAudit(input)
  }, transaction);
}

export function notifyCanonicalProjectionActivation(
  listener: CanonicalProjectionActivationListener | undefined,
  result: CanonicalProjectionActivationResult | undefined
): void {
  if (listener === undefined || result === undefined) {
    return;
  }

  try {
    listener(result);
  } catch {
    // The canonical transaction has already committed. Clients recover by
    // reading the active projection, so delivery failure must not turn a
    // successful command into an error response.
  }
}

function projectionAudit(
  input: RefreshCanonicalProjectionInput
): EngineAuditCommand {
  return {
    eventId: randomUUID(),
    commandType: "canonical_public_projection_activated",
    actor: input.actor,
    occurredAt: input.occurredAt,
    ...(input.correlationId === undefined
      ? {}
      : { correlationId: input.correlationId }),
    ...(input.sourceEventId === undefined
      ? {}
      : { causationId: input.sourceEventId }),
    details: {
      sourceCommandType: input.sourceCommandType
    }
  };
}
