import { Module } from "@nestjs/common";

import { AuthModule } from "../auth";
import { LoggingModule } from "../logging";
import { PersistenceModule } from "../repositories";
import {
  SystemUserBlockClock,
  USER_BLOCK_CLOCK
} from "./user-block-clock";
import { UserBlockingController } from "./user-blocking.controller";
import { UserBlockingService } from "./user-blocking.service";

@Module({
  imports: [AuthModule, LoggingModule, PersistenceModule],
  controllers: [UserBlockingController],
  providers: [
    SystemUserBlockClock,
    {
      provide: USER_BLOCK_CLOCK,
      useExisting: SystemUserBlockClock
    },
    UserBlockingService
  ],
  exports: [UserBlockingService]
})
export class UserBlockingModule {}
