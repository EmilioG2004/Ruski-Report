import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";

import {
  AuthSessionGuard,
  CurrentOptionalPrincipal,
  CurrentPrincipal,
  OptionalAuthSessionGuard
} from "../auth";
import { AuthenticatedPrincipal, Comment } from "../domain";
import {
  CommentsService,
  CreateCommentRequest
} from "./comments.service";

@Controller("matches/:matchId/comments")
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  @Get()
  @UseGuards(OptionalAuthSessionGuard)
  getMatchComments(
    @Param("matchId") matchId: string,
    @CurrentOptionalPrincipal() principal?: AuthenticatedPrincipal
  ): Promise<Comment[]> {
    return this.commentsService.getMatchComments(matchId, principal);
  }

  @Post()
  @UseGuards(AuthSessionGuard)
  createMatchComment(
    @Param("matchId") matchId: string,
    @Body() request: CreateCommentRequest | null | undefined,
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<Comment> {
    return this.commentsService.createMatchComment(matchId, request, principal);
  }
}
