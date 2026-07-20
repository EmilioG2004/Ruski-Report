import { Module } from "@nestjs/common";

import { AUTH_CONFIG, loadAuthConfig } from "../config/auth.config";
import { PersistenceModule } from "../repositories";
import { AuthController } from "./auth.controller";
import { AuthCredentialsValidator } from "./auth-credentials.validator";
import { AuthService } from "./auth.service";
import { AuthSessionGuard } from "./auth-session.guard";
import { PASSWORD_HASHER, ScryptPasswordHasher } from "./password-hasher";
import { SessionTokenService } from "./session-token.service";

@Module({
  imports: [PersistenceModule],
  controllers: [AuthController],
  providers: [
    { provide: AUTH_CONFIG, useFactory: loadAuthConfig },
    ScryptPasswordHasher,
    { provide: PASSWORD_HASHER, useExisting: ScryptPasswordHasher },
    SessionTokenService,
    AuthCredentialsValidator,
    AuthService,
    AuthSessionGuard
  ],
  exports: [AuthService, AuthSessionGuard, SessionTokenService]
})
export class AuthModule {}
