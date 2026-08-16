import { LiveUpdateEvent } from "../domain";

export const REALTIME_EVENT_BROADCASTER = Symbol(
  "REALTIME_EVENT_BROADCASTER"
);

export interface RealtimeEventBroadcaster {
  broadcast(event: LiveUpdateEvent): void;
}
