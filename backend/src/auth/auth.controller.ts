import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards
} from "@nestjs/common";

import { AuthenticatedPrincipal } from "../domain";
import { AuthCredentialsRequest } from "./auth-credentials.validator";
import { AuthService } from "./auth.service";
import { CreatedSessionResponse, CurrentSessionResponse, currentSessionResponse } from "./auth-response";
import { AuthSessionGuard } from "./auth-session.guard";
import { CurrentPrincipal, CurrentSessionTokenHash } from "./authenticated-request";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(
    @Body() request: AuthCredentialsRequest | null | undefined
  ): Promise<CreatedSessionResponse> {
    return this.auth.register(request);
  }

  @Post("login")
  login(
    @Body() request: AuthCredentialsRequest | null | undefined
  ): Promise<CreatedSessionResponse> {
    return this.auth.login(request);
  }

  @Get("session")
  @UseGuards(AuthSessionGuard)
  currentSession(
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): CurrentSessionResponse {
    return currentSessionResponse(principal);
  }

  @Delete("session")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthSessionGuard)
  async signOut(@CurrentSessionTokenHash() tokenHash: string): Promise<void> {
    await this.auth.signOut(tokenHash);
  }

  @Delete("account")
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthSessionGuard)
  async deleteAccount(
    @CurrentPrincipal() principal: AuthenticatedPrincipal
  ): Promise<void> {
    await this.auth.deleteAccount(principal.userId);
  }
}
