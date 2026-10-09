import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards
} from "@nestjs/common";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig
} from "../../config/admin-auth.config";
import {
  AdministratorAuthenticatedRequest,
  CurrentAdministratorPrincipal,
  administratorRequestContext
} from "./administrator-authenticated-request";
import {
  AdministratorCookieResponse,
  clearAdministratorCookies,
  setAdministratorSessionCookies,
  setPreAuthCsrfCookie
} from "./administrator-cookies";
import { AdministratorCsrfGuard } from "./administrator-csrf.guard";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import {
  AdministratorInvitationAcceptanceRequest,
  AdministratorLoginRequest,
  AdministratorSecurityService
} from "./administrator-security.service";
import {
  AdministratorIdentityInput,
  AdministratorPrincipal
} from "./administrator-security.types";
import { AdministratorSessionGuard } from "./administrator-session.guard";

@Controller("admin/auth")
export class AdministratorAuthenticationController {
  constructor(
    private readonly security: AdministratorSecurityService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  @Get("csrf")
  @Header("Cache-Control", "no-store")
  async csrf(
    @Req() request: AdministratorAuthenticatedRequest,
    @Res({ passthrough: true }) response: AdministratorCookieResponse
  ): Promise<{ csrfToken: string; expiresAt: string }> {
    const issued = await this.security.issuePreAuthCsrf(
      administratorRequestContext(request)
    );
    setPreAuthCsrfCookie(
      response,
      this.config,
      issued.token,
      issued.expiresAt
    );
    return { csrfToken: issued.token, expiresAt: issued.expiresAt };
  }

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @UseGuards(AdministratorCsrfGuard)
  async login(
    @Body() body: AdministratorLoginRequest | null | undefined,
    @Req() request: AdministratorAuthenticatedRequest,
    @Res({ passthrough: true }) response: AdministratorCookieResponse
  ): Promise<{ administrator: AdministratorPrincipal; expiresAt: string }> {
    const issued = await this.security.login(
      body,
      administratorRequestContext(request)
    );
    setAdministratorSessionCookies(
      response,
      this.config,
      issued.rawSessionToken,
      issued.rawCsrfToken,
      issued.principal.expiresAt
    );
    return {
      administrator: issued.principal,
      expiresAt: issued.principal.expiresAt
    };
  }

  @Get("session")
  @Header("Cache-Control", "no-store")
  @UseGuards(AdministratorSessionGuard)
  session(
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal
  ): { administrator: AdministratorPrincipal; expiresAt: string } {
    return { administrator: principal, expiresAt: principal.expiresAt };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  @UseGuards(AdministratorSessionGuard, AdministratorCsrfGuard)
  async logout(
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest,
    @Res({ passthrough: true }) response: AdministratorCookieResponse
  ): Promise<void> {
    await this.security.logout(principal, administratorRequestContext(request));
    clearAdministratorCookies(response, this.config);
  }

  @Post("invitations/accept")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @UseGuards(AdministratorCsrfGuard)
  async acceptInvitation(
    @Body() body: AdministratorInvitationAcceptanceRequest | null | undefined,
    @Req() request: AdministratorAuthenticatedRequest,
    @Res({ passthrough: true }) response: AdministratorCookieResponse
  ): Promise<{ administrator: AdministratorPrincipal; expiresAt: string }> {
    const issued = await this.security.acceptInvitation(
      body,
      administratorRequestContext(request)
    );
    setAdministratorSessionCookies(
      response,
      this.config,
      issued.rawSessionToken,
      issued.rawCsrfToken,
      issued.principal.expiresAt
    );
    return {
      administrator: issued.principal,
      expiresAt: issued.principal.expiresAt
    };
  }

  @Post("recovery/complete")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  @UseGuards(AdministratorCsrfGuard)
  completeRecovery(
    @Body() body: AdministratorInvitationAcceptanceRequest | null | undefined,
    @Req() request: AdministratorAuthenticatedRequest
  ): Promise<void> {
    return this.security.completeRecovery(
      body,
      administratorRequestContext(request)
    );
  }
}

@Controller("admin/administrators")
@UseGuards(AdministratorSessionGuard, AdministratorCsrfGuard)
export class AdministratorManagementController {
  constructor(private readonly security: AdministratorSecurityService) {}

  @Post("invitations")
  @Header("Cache-Control", "no-store")
  async invite(
    @Body() body: AdministratorIdentityInput | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    const issued = await this.security.createInvitation(
      body,
      principal,
      administratorRequestContext(request)
    );
    return { id: issued.id, token: issued.rawToken, expiresAt: issued.expiresAt };
  }

  @Delete("invitations/:invitationId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header("Cache-Control", "no-store")
  revokeInvitation(
    @Param("invitationId") invitationId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ): Promise<void> {
    return this.security.revokeInvitation(
      invitationId,
      principal,
      administratorRequestContext(request)
    );
  }

  @Post(":administratorId/recovery")
  @Header("Cache-Control", "no-store")
  async recover(
    @Param("administratorId") administratorId: string,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ): Promise<{ id: string; token: string; expiresAt: string }> {
    const issued = await this.security.createRecoveryToken(
      administratorId,
      principal,
      administratorRequestContext(request)
    );
    return { id: issued.id, token: issued.rawToken, expiresAt: issued.expiresAt };
  }
}

@Controller("admin/security-audit")
@UseGuards(AdministratorSessionGuard)
export class AdministratorSecurityAuditController {
  constructor(private readonly audit: AdministratorSecurityAuditService) {}

  @Get()
  @Header("Cache-Control", "no-store")
  list(
    @Query("limit") limit?: string,
    @Query("before") before?: string
  ) {
    return this.audit.listEvents(limit === undefined ? 50 : Number(limit), before);
  }
}
