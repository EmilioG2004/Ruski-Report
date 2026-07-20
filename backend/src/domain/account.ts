import { ISODateTimeString } from "./common";

export type AccountProvider = "local_account" | "game_center" | "tau_id";
export type AccountStatus = "active" | "disabled";

export interface UserAccount {
  id: string;
  displayName: string;
  normalizedDisplayName: string;
  provider: AccountProvider;
  status: AccountStatus;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
}

export interface LocalAccountRecord {
  account: UserAccount;
  passwordHash: string;
}

export interface AuthenticatedPrincipal {
  userId: string;
  displayName: string;
  provider: AccountProvider;
  sessionId: string;
  expiresAt: ISODateTimeString;
}
