import { MatchId } from "../domain";

export const ACCOUNT_DELETION_EVENT_PUBLISHER = Symbol(
  "ACCOUNT_DELETION_EVENT_PUBLISHER"
);

export interface AccountDeletedEvent {
  affectedMatchIds: readonly MatchId[];
}

export interface AccountDeletionEventPublisher {
  publish(event: AccountDeletedEvent): void;
}
