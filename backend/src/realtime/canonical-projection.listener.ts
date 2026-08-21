import type {
  CanonicalProjectionActivationListener
} from "../tournament-engine/persistence";
import { RealtimeUpdatePublisher } from "./realtime-update.publisher";

export function createCanonicalProjectionActivationListener(
  realtime: RealtimeUpdatePublisher
): CanonicalProjectionActivationListener {
  return (projection) => {
    realtime.publishTournamentUpdated({
      tournamentId: projection.publicTournamentId,
      projectionVersion: projection.projectionVersion
    });
    for (const matchId of projection.changedMatchIds) {
      realtime.publishMatchUpdated({
        tournamentId: projection.publicTournamentId,
        matchId,
        projectionVersion: projection.projectionVersion
      });
    }
  };
}
