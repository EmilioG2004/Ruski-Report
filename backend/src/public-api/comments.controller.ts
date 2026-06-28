import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import { Comment } from "../domain";
import {
  CommentsService,
  CreateCommentRequest
} from "./comments.service";

@Controller("matches/:matchId/comments")
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  getMatchComments(@Param("matchId") matchId: string): Promise<Comment[]> {
    return this.commentsService.getMatchComments(matchId);
  }

  @Post()
  createMatchComment(
    @Param("matchId") matchId: string,
    @Body() request: CreateCommentRequest | null | undefined
  ): Promise<Comment> {
    return this.commentsService.createMatchComment(matchId, request);
  }
}
