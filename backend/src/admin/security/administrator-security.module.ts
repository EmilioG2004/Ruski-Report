import { Module } from "@nestjs/common";

import {
  ADMIN_AUTH_CONFIG,
  loadAdministratorAuthConfig
} from "../../config/admin-auth.config";
import { PersistenceModule } from "../../repositories";
import { AdministratorPasswordHasher } from "./administrator-password.hasher";
import {
  AdministratorAuthenticationController,
  AdministratorManagementController,
  AdministratorSecurityAuditController
} from "./administrator-security.controller";
import { AdministratorCsrfGuard } from "./administrator-csrf.guard";
import { AdministratorSecurityAuditService } from "./administrator-security-audit.service";
import { AdministratorSecurityRepository } from "./administrator-security.repository";
import { AdministratorSecurityService } from "./administrator-security.service";
import { AdministratorSecurityTokens } from "./administrator-security.tokens";
import { AdministratorSessionGuard } from "./administrator-session.guard";

@Module({
  imports: [PersistenceModule],
  controllers: [
    AdministratorAuthenticationController,
    AdministratorManagementController,
    AdministratorSecurityAuditController
  ],
  providers: [
    { provide: ADMIN_AUTH_CONFIG, useFactory: loadAdministratorAuthConfig },
    AdministratorSecurityRepository,
    AdministratorPasswordHasher,
    AdministratorSecurityTokens,
    AdministratorSecurityAuditService,
    AdministratorSecurityService,
    AdministratorSessionGuard,
    AdministratorCsrfGuard
  ],
  exports: [
    ADMIN_AUTH_CONFIG,
    AdministratorSecurityService,
    AdministratorSecurityAuditService,
    AdministratorSecurityTokens,
    AdministratorSessionGuard,
    AdministratorCsrfGuard
  ]
})
export class AdministratorSecurityModule {}
