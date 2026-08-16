import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export interface AdminPrincipal {
  operatorId: string;
}

export interface AdminAuthenticatedRequest {
  headers?: Record<string, string | string[] | undefined>;
  adminPrincipal?: AdminPrincipal;
}

export const CurrentAdminPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request =
      context.switchToHttp().getRequest<AdminAuthenticatedRequest>();
    if (request.adminPrincipal === undefined) {
      throw new Error("Admin principal is missing from the request.");
    }
    return request.adminPrincipal;
  }
);
