import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards
} from "@nestjs/common";

import {
  AdminAuthGuard,
  AdminPrincipal,
  CurrentAdminPrincipal
} from "../admin";
import { CommentReport, CommentReportQueueItem } from "../domain";
import {
  AdminCommentReportsService
} from "./admin-comment-reports.service";
import { ModerateCommentReportRequest } from "./comment-report-moderation.request";

@Controller("admin/comment-reports")
@UseGuards(AdminAuthGuard)
export class AdminCommentReportsController {
  constructor(private readonly reports: AdminCommentReportsService) {}

  @Get()
  list(
    @Query("status") status: string | undefined
  ): Promise<CommentReportQueueItem[]> {
    return this.reports.list(status);
  }

  @Patch(":reportId")
  moderate(
    @Param("reportId") reportId: string,
    @Body() request: ModerateCommentReportRequest | null | undefined,
    @CurrentAdminPrincipal() principal: AdminPrincipal
  ): Promise<CommentReport> {
    return this.reports.moderate(
      reportId,
      request,
      principal.operatorId
    );
  }
}
