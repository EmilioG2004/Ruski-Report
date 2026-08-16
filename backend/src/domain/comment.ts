import {
  CommentId,
  ISODateTimeString,
  MatchId,
  Metadata,
  UserId
} from "./common";

export type CommentAuthorKind = "guest" | "account" | "admin" | "system";

export interface CommentAuthor {
  kind: CommentAuthorKind;
  displayName: string;
  userId?: UserId;
}

export interface Comment {
  id: CommentId;
  matchId: MatchId;
  author: CommentAuthor;
  body: string;
  createdAt: ISODateTimeString;
  updatedAt?: ISODateTimeString;
  deletedAt?: ISODateTimeString;
  metadata?: Metadata;
}

export interface CommentsSummary {
  matchId: MatchId;
  count: number;
  latestCommentAt?: ISODateTimeString;
}
