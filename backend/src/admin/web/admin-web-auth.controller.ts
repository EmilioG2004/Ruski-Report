import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards
} from "@nestjs/common";

import {
  ADMIN_AUTH_CONFIG,
  AdministratorAuthConfig,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext,
  clearAdministratorCookies,
  setAdministratorSessionCookies,
  setPreAuthCsrfCookie
} from "../security";
import {
  parseInvitationForm,
  parseRecoveryForm,
  parseSignInForm
} from "./admin-web.form";
import {
  renderInvitationAcceptancePage,
  renderRecoveryCompletionPage,
  renderSignInPage
} from "./admin-web-auth.pages";
import {
  AdministratorWebExceptionFilter,
  adminWebPageError,
  isExpectedWebError
} from "./admin-web.errors";
import {
  ADMIN_WEB_ROOT,
  AdminWebRequest,
  AdminWebResponse,
  redirectAdmin,
  sendAdminErrorHtml,
  sendAdminHtml
} from "./admin-web.types";

@Controller("admin/app")
@UseFilters(AdministratorWebExceptionFilter)
export class AdminWebAuthenticationController {
  constructor(
    private readonly security: AdministratorSecurityService,
    @Inject(ADMIN_AUTH_CONFIG)
    private readonly config: AdministratorAuthConfig
  ) {}

  @Get()
  home(@Res() response: AdminWebResponse): void {
    redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments`);
  }

  @Get("sign-in")
  async signInPage(
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse,
    @Query("recovered") recovered?: string
  ): Promise<void> {
    const csrf = await this.issuePreAuthCsrf(request, response);
    sendAdminHtml(response, renderSignInPage({
      csrfToken: csrf,
      recoveryCompleted: recovered === "1"
    }));
  }

  @Post("sign-in")
  @UseGuards(AdministratorCsrfGuard)
  async signIn(
    @Body() body: unknown,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    let csrfToken = typeof (body as Record<string, unknown> | null)?._csrf === "string"
      ? String((body as Record<string, unknown>)._csrf)
      : "";
    let loginName = "";
    try {
      const form = parseSignInForm(body);
      csrfToken = form.csrf;
      loginName = form.loginName;
      const issued = await this.security.login(
        { loginName: form.loginName, password: form.password },
        administratorRequestContext(request)
      );
      setAdministratorSessionCookies(
        response,
        this.config,
        issued.rawSessionToken,
        issued.rawCsrfToken,
        issued.principal.expiresAt
      );
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments`);
    } catch (error) {
      if (!isExpectedWebError(error)) {
        throw error;
      }
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderSignInPage({
        csrfToken,
        loginName,
        error: pageError
      }), pageError);
    }
  }

  @Get("invitations/accept")
  async invitationPage(
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrf = await this.issuePreAuthCsrf(request, response);
    sendAdminHtml(response, renderInvitationAcceptancePage({ csrfToken: csrf }));
  }

  @Post("invitations/accept")
  @UseGuards(AdministratorCsrfGuard)
  async acceptInvitation(
    @Body() body: unknown,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrfToken = typeof (body as Record<string, unknown> | null)?._csrf === "string"
      ? String((body as Record<string, unknown>)._csrf)
      : "";
    try {
      const form = parseInvitationForm(body);
      const issued = await this.security.acceptInvitation(
        { token: form.token, password: form.password },
        administratorRequestContext(request)
      );
      setAdministratorSessionCookies(
        response,
        this.config,
        issued.rawSessionToken,
        issued.rawCsrfToken,
        issued.principal.expiresAt
      );
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/tournaments`);
    } catch (error) {
      if (!isExpectedWebError(error)) {
        throw error;
      }
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderInvitationAcceptancePage({
        csrfToken,
        error: pageError
      }), pageError);
    }
  }

  @Get("recovery/complete")
  async recoveryPage(
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrf = await this.issuePreAuthCsrf(request, response);
    sendAdminHtml(response, renderRecoveryCompletionPage({ csrfToken: csrf }));
  }

  @Post("recovery/complete")
  @UseGuards(AdministratorCsrfGuard)
  async completeRecovery(
    @Body() body: unknown,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    const csrfToken = typeof (body as Record<string, unknown> | null)?._csrf === "string"
      ? String((body as Record<string, unknown>)._csrf)
      : "";
    try {
      const form = parseRecoveryForm(body);
      await this.security.completeRecovery(
        { token: form.token, password: form.password },
        administratorRequestContext(request)
      );
      redirectAdmin(response, `${ADMIN_WEB_ROOT}/sign-in?recovered=1`);
    } catch (error) {
      if (!isExpectedWebError(error)) {
        throw error;
      }
      const pageError = adminWebPageError(error);
      sendAdminErrorHtml(response, renderRecoveryCompletionPage({
        csrfToken,
        error: pageError
      }), pageError);
    }
  }

  @Post("sign-out")
  @UseGuards(AdministratorSessionGuard, AdministratorCsrfGuard)
  async signOut(
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdminWebRequest,
    @Res() response: AdminWebResponse
  ): Promise<void> {
    await this.security.logout(principal, administratorRequestContext(request));
    clearAdministratorCookies(response, this.config);
    redirectAdmin(response, `${ADMIN_WEB_ROOT}/sign-in`);
  }

  private async issuePreAuthCsrf(
    request: AdminWebRequest,
    response: AdminWebResponse
  ): Promise<string> {
    const issued = await this.security.issuePreAuthCsrf(
      administratorRequestContext(request)
    );
    setPreAuthCsrfCookie(response, this.config, issued.token, issued.expiresAt);
    return issued.token;
  }
}
