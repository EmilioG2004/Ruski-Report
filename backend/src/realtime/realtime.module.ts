import { Module } from "@nestjs/common";

import { LoggingModule } from "../logging";
import {
  REALTIME_EVENT_BROADCASTER
} from "./realtime-event-broadcaster";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeUpdatePublisher } from "./realtime-update.publisher";

@Module({
  imports: [LoggingModule],
  providers: [
    RealtimeGateway,
    RealtimeUpdatePublisher,
    {
      provide: REALTIME_EVENT_BROADCASTER,
      useExisting: RealtimeGateway
    }
  ],
  exports: [LoggingModule, RealtimeUpdatePublisher]
})
export class RealtimeModule {}
