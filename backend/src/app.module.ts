import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { AdminModule } from "./admin";
import { HealthController } from "./controllers/health.controller";
import { AppExceptionFilter } from "./errors";
import { APP_LOGGER, ConsoleAppLogger } from "./logging";
import { PublicApiModule } from "./public-api";
import { HealthService } from "./services/health.service";

@Module({
  imports: [AdminModule, PublicApiModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: APP_LOGGER,
      useClass: ConsoleAppLogger
    },
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter
    }
  ]
})
export class AppModule {}
