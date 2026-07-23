import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";

import { AuthSessionGuard, CurrentPrincipal } from "../auth";
import { AuthenticatedPrincipal } from "../domain";
import {
  SubmitCommentReportRequest
} from "./comment-report.policy";
import {
  CommentReportReceipt,
  CommentReportsService
} from "./comment-reports.service";

@Controller("comments/:commentId/reports")
export class CommentReportsController {
  constructor(private readonly reports: CommentReportsService) {}

  @Post()
  @UseGuards(AuthSessionGuard)
  submit(
    @Param("commentId") commentId: string,
    @Body() request: SubmitCommentReportRequest | null | undefined,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<CommentReportReceipt> {
    return this.reports.submit(commentId, request, principal);
  }
}
