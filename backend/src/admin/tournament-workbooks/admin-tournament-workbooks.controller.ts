import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";

import { AppError } from "../../errors";
import { isStableUuid } from "../../tournament-engine/domain";
import {
  AdministratorAuthenticatedRequest,
  AdministratorCsrfGuard,
  AdministratorPrincipal,
  AdministratorSecurityAuditService,
  AdministratorSecurityService,
  AdministratorSessionGuard,
  CurrentAdministratorPrincipal,
  administratorRequestContext
} from "../security";
import {
  ApplyAdminWorkbookImportRequest,
  AssignAdminWorkbookSheetsRequest,
  GenerateAdminTournamentWorkbookRequest,
  UploadedCanonicalWorkbookFile
} from "./admin-tournament-workbook.contracts";
import { AdminTournamentWorkbookService } from "./admin-tournament-workbook.service";
import { AdministratorMultipartCsrfVerifier } from "./administrator-multipart-csrf.verifier";
import { AdministratorMultipartOriginGuard } from "./administrator-multipart-csrf.verifier";

interface WorkbookBinaryResponse {
  setHeader(name: string, value: string): unknown;
  status(statusCode: number): WorkbookBinaryResponse;
  send(body: Buffer): unknown;
}

@Controller("admin/tournaments/:tournamentId/workbooks")
@UseGuards(AdministratorSessionGuard)
export class AdminTournamentWorkbooksController {
  constructor(
    private readonly workbooks: AdminTournamentWorkbookService,
    private readonly security: AdministratorSecurityService,
    private readonly securityAudit: AdministratorSecurityAuditService,
    private readonly multipartCsrf: AdministratorMultipartCsrfVerifier
  ) {}

  @Get()
  list(@Param("tournamentId") tournamentId: string) {
    return this.workbooks.listGenerations(tournamentId);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  async generate(
    @Param("tournamentId") tournamentId: string,
    @Body() body: GenerateAdminTournamentWorkbookRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    try {
      await this.enforceSensitive(
        "canonical_workbook_generate",
        tournamentId,
        principal,
        request
      );
      return await this.workbooks.generate(tournamentId, body, principal);
    } catch (error) {
      await this.recordRejected("workbook_generate", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Get(":workbookId/download")
  async download(
    @Param("tournamentId") tournamentId: string,
    @Param("workbookId") workbookId: string,
    @Res() response: WorkbookBinaryResponse
  ): Promise<void> {
    const artifact = await this.workbooks.download(tournamentId, workbookId);
    response.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.filename}"`
    );
    response.setHeader("Content-Length", String(artifact.artifactSizeBytes));
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.status(HttpStatus.OK).send(artifact.artifact);
  }

  @Post("imports/preview")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorMultipartOriginGuard)
  @UseInterceptors(FileInterceptor("file"))
  async preview(
    @Param("tournamentId") tournamentId: string,
    @UploadedFile() file: UploadedCanonicalWorkbookFile | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    try {
      await this.multipartCsrf.verify(request);
      await this.enforceSensitive(
        "canonical_workbook_preview",
        tournamentId,
        principal,
        request
      );
      return await this.workbooks.preview(tournamentId, file, principal);
    } catch (error) {
      await this.recordRejected("workbook_preview", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Get("imports/:batchId")
  findPreview(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string
  ) {
    return this.workbooks.findPreview(tournamentId, batchId);
  }

  @Post("imports/:batchId/assignments")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  async assign(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string,
    @Body() body: AssignAdminWorkbookSheetsRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    try {
      await this.enforceSensitive(
        "canonical_workbook_assignment",
        tournamentId,
        principal,
        request
      );
      return await this.workbooks.assign(tournamentId, batchId, body, principal);
    } catch (error) {
      await this.recordRejected("workbook_assignment", tournamentId, principal, request, error);
      throw error;
    }
  }

  @Post("imports/:batchId/apply")
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdministratorCsrfGuard)
  async apply(
    @Param("tournamentId") tournamentId: string,
    @Param("batchId") batchId: string,
    @Body() body: ApplyAdminWorkbookImportRequest | null | undefined,
    @CurrentAdministratorPrincipal() principal: AdministratorPrincipal,
    @Req() request: AdministratorAuthenticatedRequest
  ) {
    try {
      await this.enforceSensitive(
        "canonical_workbook_apply",
        tournamentId,
        principal,
        request
      );
      return await this.workbooks.apply(tournamentId, batchId, body, principal);
    } catch (error) {
      await this.recordRejected("workbook_apply", tournamentId, principal, request, error);
      throw error;
    }
  }

  private enforceSensitive(
    action: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AdministratorAuthenticatedRequest
  ): Promise<void> {
    return this.security.enforceSensitiveOperatorAction(
      {
        action,
        targetType: "tournament",
        ...(isStableUuid(tournamentId) ? { targetId: tournamentId } : {})
      },
      principal,
      administratorRequestContext(request)
    );
  }

  private async recordRejected(
    command: string,
    tournamentId: string,
    principal: AdministratorPrincipal,
    request: AdministratorAuthenticatedRequest,
    error: unknown
  ): Promise<void> {
    try {
      await this.securityAudit.recordEvent({
        eventType: "administrator_workbook_command",
        outcome: "rejected",
        reasonCode: rejectionReason(error),
        administratorId: principal.administratorId,
        sessionId: principal.sessionId,
        ...(isStableUuid(tournamentId)
          ? { targetType: "tournament", targetId: tournamentId }
          : {}),
        ...administratorRequestContext(request),
        details: { command }
      });
    } catch {
      // The original workbook command remains rejected if audit storage fails.
    }
  }
}

function rejectionReason(error: unknown): string {
  if (!(error instanceof AppError)) {
    return "INTERNAL_ERROR";
  }
  const value = error.details[0]?.code ?? error.code;
  return /^[A-Za-z0-9_.:-]{1,100}$/u.test(value)
    ? value
    : "WORKBOOK_COMMAND_REJECTED";
}
