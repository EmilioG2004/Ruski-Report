import { Module } from "@nestjs/common";

import { AdminAuthModule } from "../admin";
import { AuthModule } from "../auth";
import {
  COMMENT_REPORTING_CONFIG,
  CommentReportingConfig,
  loadCommentReportingConfig
} from "../config/comment-reporting.config";
import { PersistenceModule } from "../repositories";
import { RealtimeModule } from "../realtime";
import { AdminCommentReportsController } from "./admin-comment-reports.controller";
import { AdminCommentReportsService } from "./admin-comment-reports.service";
import {
  COMMENT_REPORT_CLOCK,
  SystemCommentReportClock
} from "./comment-report-clock";
import {
  COMMENT_REPORT_POLICY,
  DefaultCommentReportPolicy
} from "./comment-report.policy";
import { CommentReportsController } from "./comment-reports.controller";
import { CommentReportsService } from "./comment-reports.service";

@Module({
  imports: [
    AdminAuthModule,
    AuthModule,
    PersistenceModule,
    RealtimeModule
  ],
  controllers: [CommentReportsController, AdminCommentReportsController],
  providers: [
    {
      provide: COMMENT_REPORTING_CONFIG,
      useFactory: loadCommentReportingConfig
    },
    {
      provide: COMMENT_REPORT_CLOCK,
      useClass: SystemCommentReportClock
    },
    {
      provide: COMMENT_REPORT_POLICY,
      useFactory: (config: CommentReportingConfig) =>
        new DefaultCommentReportPolicy(config),
      inject: [COMMENT_REPORTING_CONFIG]
    },
    CommentReportsService,
    AdminCommentReportsService
  ]
})
export class CommentReportingModule {}
