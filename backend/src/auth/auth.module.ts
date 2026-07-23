import { Module } from "@nestjs/common";

import { AUTH_CONFIG, loadAuthConfig } from "../config/auth.config";
import { PersistenceModule } from "../repositories";
import { RealtimeModule } from "../realtime";
import { ACCOUNT_DELETION_EVENT_PUBLISHER } from "./account-deletion-event.publisher";
import { AuthController } from "./auth.controller";
import { AuthCredentialsValidator } from "./auth-credentials.validator";
import { AuthService } from "./auth.service";
import { AuthSessionGuard } from "./auth-session.guard";
import { PASSWORD_HASHER, ScryptPasswordHasher } from "./password-hasher";
import { RealtimeAccountDeletionEventPublisher } from "./realtime-account-deletion-event.publisher";
import { SessionTokenService } from "./session-token.service";

@Module({
  imports: [PersistenceModule, RealtimeModule],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
    ScryptPasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: ScryptPasswordHasher },
    SessionTokenService,
    AuthCredentialsValidator,
    AuthService,
    AuthSessionGuard,
    RealtimeAccountDeletionEventPublisher,
    {
      provide: ACCOUNT_DELETION_EVENT_PUBLISHER,
      useExisting: RealtimeAccountDeletionEventPublisher
    }
  ],
  exports: [AuthService, AuthSessionGuard, SessionTokenService]
})
export class AuthModule {}
