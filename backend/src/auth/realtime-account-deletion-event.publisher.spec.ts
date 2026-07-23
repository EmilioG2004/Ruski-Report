import { RealtimeUpdatePublisher } from "../realtime";
import { RealtimeAccountDeletionEventPublisher } from "./realtime-account-deletion-event.publisher";

describe("RealtimeAccountDeletionEventPublisher", () => {
  it("publishes one comment update per distinct affected match", () => {
    const realtimeUpdates = {
      publishCommentsUpdated: jest.fn()
    } as unknown as jest.Mocked<RealtimeUpdatePublisher>;
    const publisher = new RealtimeAccountDeletionEventPublisher(
      realtimeUpdates
    );

    publisher.publish({
      affectedMatchIds: ["match-1", "match-2"]
    });

    expect(realtimeUpdates.publishCommentsUpdated).toHaveBeenCalledTimes(2);
    expect(realtimeUpdates.publishCommentsUpdated).toHaveBeenNthCalledWith(1, {
      matchId: "match-1",
      metadata: {
        reason: "account_deleted"
      }
    });
    expect(realtimeUpdates.publishCommentsUpdated).toHaveBeenNthCalledWith(2, {
      matchId: "match-2",
      metadata: {
        reason: "account_deleted"
      }
    });
  });
});
