export const ADMIN_CONFIG = Symbol("ADMIN_CONFIG");

export interface AdminConfig {
  apiToken?: string;
  operatorId: string;
}

export function loadAdminConfig(
  environment: NodeJS.ProcessEnv = process.env
): AdminConfig {
  return {
    apiToken: nonemptyOptional(
      environment.ADMIN_API_TOKEN ?? environment.ADMIN_UPLOAD_TOKEN
    ),
    operatorId:
      nonemptyOptional(environment.MODERATION_OPERATOR_ID) ??
      "tournament-operator"
  };
}

function nonemptyOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}
