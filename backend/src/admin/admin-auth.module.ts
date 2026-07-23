import { Module } from "@nestjs/common";

import { ADMIN_CONFIG, loadAdminConfig } from "../config/admin.config";
import { AdminAuthGuard } from "./admin-auth.guard";

@Module({
  providers: [
    {
      provide: ADMIN_CONFIG,
      useFactory: loadAdminConfig
    },
    AdminAuthGuard
  ],
  exports: [ADMIN_CONFIG, AdminAuthGuard]
})
export class AdminAuthModule {}
