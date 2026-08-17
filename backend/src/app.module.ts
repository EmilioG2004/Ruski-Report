import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { AdminModule } from "./admin";
import { HealthController } from "./controllers/health.controller";
import { AppExceptionFilter } from "./errors";
import { LoggingModule } from "./logging";
import { CommentReportingModule } from "./moderation";
import { PublicApiModule } from "./public-api";
import { PersistenceModule } from "./repositories";
import { HealthService } from "./services/health.service";
import { UserBlockingModule } from "./user-blocking";

@Module({
  imports: [
    AdminModule,
    CommentReportingModule,
    LoggingModule,
    PersistenceModule,
    PublicApiModule,
    UserBlockingModule
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
    {
      provide: APP_FILTER,
      useClass: AppExceptionFilter
    }
  ]
})
export class AppModule {}
