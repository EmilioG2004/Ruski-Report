import { Injectable } from "@nestjs/common";

import { RealtimeUpdatePublisher } from "../realtime";
import {
  AccountDeletedEvent,
  AccountDeletionEventPublisher
} from "./account-deletion-event.publisher";

@Injectable()
export class RealtimeAccountDeletionEventPublisher
  implements AccountDeletionEventPublisher
{
  constructor(private readonly realtimeUpdates: RealtimeUpdatePublisher) {}

  publish(event: AccountDeletedEvent): void {
    for (const matchId of event.affectedMatchIds) {
      this.realtimeUpdates.publishCommentsUpdated({
        matchId,
        metadata: {
          reason: "account_deleted"
        }
      });
    }
  }
}
