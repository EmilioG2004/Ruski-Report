import { Module } from "@nestjs/common";

import { APP_LOGGER, ConsoleAppLogger } from "../logging";
import {
  REALTIME_EVENT_BROADCASTER
} from "./realtime-event-broadcaster";
import { RealtimeGateway } from "./realtime.gateway";
import { RealtimeUpdatePublisher } from "./realtime-update.publisher";

@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useClass: ConsoleAppLogger
    },
    RealtimeGateway,
    RealtimeUpdatePublisher,
    {
      provide: REALTIME_EVENT_BROADCASTER,
      useExisting: RealtimeGateway
    }
  ],
  exports: [APP_LOGGER, RealtimeUpdatePublisher]
})
export class RealtimeModule {}
