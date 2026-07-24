import { ISODateTimeString, UserId } from "./common";

export interface UserBlock {
  blockerUserId: UserId;
  blockedUserId: UserId;
  createdAt: ISODateTimeString;
}

export interface BlockedUser {
  userId: UserId;
  displayName: string;
  blockedAt: ISODateTimeString;
}
