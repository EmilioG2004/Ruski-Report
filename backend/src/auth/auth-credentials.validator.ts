import { HttpStatus, Inject, Injectable } from "@nestjs/common";

import { AUTH_CONFIG, AuthConfig } from "../config/auth.config";
import { AppError } from "../errors";

export interface AuthCredentialsRequest {
  displayName?: string;
  password?: string;
}

export interface ValidatedAuthCredentials {
  displayName: string;
  normalizedDisplayName: string;
  password: string;
}

@Injectable()
export class AuthCredentialsValidator {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  validate(
    request: AuthCredentialsRequest | null | undefined
  ): ValidatedAuthCredentials {
    const displayName = request?.displayName?.trim() ?? "";
    const password = request?.password ?? "";
    const details = [];

    if (displayName.length === 0) {
      details.push({
        code: "DISPLAY_NAME_REQUIRED",
        message: "Display name is required.",
        path: "displayName"
      });
    } else if (displayName.length > this.config.maximumDisplayNameLength) {
      details.push({
        code: "DISPLAY_NAME_TOO_LONG",
        message: `Display names must be ${this.config.maximumDisplayNameLength} characters or fewer.`,
        path: "displayName"
      });
    }

    if (
      password.length < this.config.minimumPasswordLength ||
      password.length > this.config.maximumPasswordLength
    ) {
      details.push({
        code: "PASSWORD_LENGTH_INVALID",
        message: `Passwords must be between ${this.config.minimumPasswordLength} and ${this.config.maximumPasswordLength} characters.`,
        path: "password"
      });
    }

    if (details.length > 0) {
      throw new AppError({
        code: "BAD_REQUEST",
        message: "Account credentials are invalid.",
        statusCode: HttpStatus.BAD_REQUEST,
        details
      });
    }

    return {
      displayName,
      normalizedDisplayName: displayName.normalize("NFKC").toLocaleLowerCase("en-US"),
      password
    };
  }
}
