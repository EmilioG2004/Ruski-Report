import { LiveUpdateEvent } from "../domain";
import { RealtimeEventBroadcaster } from "./realtime-event-broadcaster";
import { RealtimeUpdatePublisher } from "./realtime-update.publisher";

describe("RealtimeUpdatePublisher", () => {
  it("broadcasts tournament update events", () => {
    const broadcaster = new RecordingBroadcaster();
    const publisher = new RealtimeUpdatePublisher(broadcaster);

    const event = publisher.publishTournamentUpdated({
      tournamentId: "tournament-2026",
      version: 4,
      occurredAt: "2026-06-21T12:00:00.000Z",
      metadata: {
        uploadId: "upload-1"
      }
    });

    expect(event).toEqual({
      id: expect.stringMatching(/^live-/),
      type: "tournament.updated",
      occurredAt: "2026-06-21T12:00:00.000Z",
      tournamentId: "tournament-2026",
      version: 4,
      metadata: {
        uploadId: "upload-1"
      }
    });
    expect(broadcaster.events).toEqual([event]);
  });

  it("broadcasts match and comment update events", () => {
    const broadcaster = new RecordingBroadcaster();
    const publisher = new RealtimeUpdatePublisher(broadcaster);

    const matchEvent = publisher.publishMatchUpdated({
      tournamentId: "tournament-2026",
      matchId: "match-1"
    });
    const commentsEvent = publisher.publishCommentsUpdated({
      tournamentId: "tournament-2026",
      matchId: "match-1"
    });

    expect(matchEvent).toMatchObject({
      type: "match.updated",
      tournamentId: "tournament-2026",
      matchId: "match-1"
    });
    expect(commentsEvent).toMatchObject({
      type: "comments.updated",
      tournamentId: "tournament-2026",
      matchId: "match-1"
    });
    expect(broadcaster.events).toEqual([matchEvent, commentsEvent]);
  });
});

class RecordingBroadcaster implements RealtimeEventBroadcaster {
  readonly events: LiveUpdateEvent[] = [];

  broadcast(event: LiveUpdateEvent): void {
    this.events.push(event);
  }
}
