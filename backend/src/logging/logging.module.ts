import { Module } from "@nestjs/common";

import { APP_LOGGER } from "./app-logger";
import { ConsoleAppLogger } from "./console-app-logger";

@Module({
  providers: [
    {
      provide: APP_LOGGER,
      useClass: ConsoleAppLogger
    }
  ],
  exports: [APP_LOGGER]
})
export class LoggingModule {}
