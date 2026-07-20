import { AccountProvider, AuthenticatedPrincipal } from "../domain";

export interface AuthenticatedUserResponse {
  id: string;
  displayName: string;
  provider: AccountProvider;
}

export interface CurrentSessionResponse {
  user: AuthenticatedUserResponse;
  expiresAt: string;
}

export interface CreatedSessionResponse extends CurrentSessionResponse {
  token: string;
}

export function currentSessionResponse(
  principal: AuthenticatedPrincipal
): CurrentSessionResponse {
  return {
    user: {
      id: principal.userId,
      displayName: principal.displayName,
      provider: principal.provider
    },
    expiresAt: principal.expiresAt
  };
}
