import { lstat, open, unlink } from "node:fs/promises";
import { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { AdministratorPasswordHasher } from "../admin/security/administrator-password.hasher";
import { AdministratorSecurityAuditService } from "../admin/security/administrator-security-audit.service";
import { AdministratorSecurityRepository } from "../admin/security/administrator-security.repository";
import { AdministratorSecurityService } from "../admin/security/administrator-security.service";
import { AdministratorSecurityTokens } from "../admin/security/administrator-security.tokens";
import { loadAdministratorAuthConfig } from "../config/admin-auth.config";
import { loadDatabaseConfig } from "../config/database.config";
import { PostgresDatabase } from "./postgres-database";

export interface CommandOptions {
  command: "bootstrap" | "recover";
  tokenOutputPath: string;
  loginName?: string;
  displayName?: string;
  administratorId?: string;
  protectedOutputRoot?: string;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const outputPath = await validateSecretOutputPath(
    options.tokenOutputPath,
    options.protectedOutputRoot
  );
  const authConfig = loadAdministratorAuthConfig();
  const database = new PostgresDatabase(loadDatabaseConfig());
  const output = await open(outputPath, "wx", 0o600);

  try {
    await output.chmod(0o600);
    const outputMetadata = await output.stat();
    if ((outputMetadata.mode & 0o777) !== 0o600) {
      throw new Error("Unable to enforce mode 0600 on the secret output file.");
    }
    const repository = new AdministratorSecurityRepository(database);
    const tokens = new AdministratorSecurityTokens(authConfig);
    const audit = new AdministratorSecurityAuditService(repository, tokens);
    const service = new AdministratorSecurityService(
      repository,
      new AdministratorPasswordHasher(authConfig),
      tokens,
      audit,
      authConfig
    );
    const issued = options.command === "bootstrap"
      ? await service.createBootstrapInvitation({
          loginName: requireValue(options.loginName, "--login-name"),
          displayName: requireValue(options.displayName, "--display-name")
        })
      : await service.createLocalRecoveryToken(
          requireValue(options.administratorId, "--administrator-id")
        );
    const secretDocument = createSecretDocument(
      options.command,
      issued.rawToken,
      issued.expiresAt,
      authConfig.origin
    );
    await output.writeFile(`${secretDocument}\n`, { encoding: "utf8" });
    await output.sync();
    await output.close();
    process.stdout.write(
      `Administrator ${options.command} credential created.\n` +
      `Credential id: ${issued.id}\n` +
      `Expires at: ${issued.expiresAt}\n` +
      `Secret file: ${outputPath}\n`
    );
  } catch (error) {
    await output.close().catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    await database.onApplicationShutdown();
  }
}

export function parseArguments(args: string[]): CommandOptions {
  const command = args[0];
  if (command !== "bootstrap" && command !== "recover") {
    throw new Error("First argument must be 'bootstrap' or 'recover'.");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (name === undefined || !name.startsWith("--") || value === undefined ||
        value.startsWith("--")) {
      throw new Error("Administrator command arguments must be --name value pairs.");
    }
    if (values.has(name)) {
      throw new Error(`Duplicate administrator command argument '${name}'.`);
    }
    values.set(name, value);
  }
  const allowed = command === "bootstrap"
    ? new Set([
        "--login-name",
        "--display-name",
        "--token-output",
        "--protected-output-root"
      ])
    : new Set([
        "--administrator-id",
        "--token-output",
        "--protected-output-root"
      ]);
  const unknown = [...values.keys()].find((name) => !allowed.has(name));
  if (unknown !== undefined) {
    throw new Error(`Unknown administrator command argument '${unknown}'.`);
  }
  return {
    command,
    tokenOutputPath: requireValue(values.get("--token-output"), "--token-output"),
    ...(values.get("--protected-output-root") === undefined
      ? {}
      : {
          protectedOutputRoot: requireValue(
            values.get("--protected-output-root"),
            "--protected-output-root"
          )
        }),
    ...(command === "bootstrap"
      ? {
          loginName: requireValue(values.get("--login-name"), "--login-name"),
          displayName: requireValue(values.get("--display-name"), "--display-name")
        }
      : {
          administratorId: requireValue(
            values.get("--administrator-id"),
            "--administrator-id"
          )
        })
  };
}

export async function validateSecretOutputPath(
  value: string,
  protectedOutputRoot?: string,
  repositoryRootOverride?: string | null
): Promise<string> {
  if (!isAbsolute(value)) {
    throw new Error("--token-output must be an absolute path outside the repository.");
  }
  const outputPath = resolve(value);
  const repositoryRoot = repositoryRootOverride === undefined
    ? await findRepositoryRoot(process.cwd())
    : repositoryRootOverride;
  if (repositoryRoot !== null && isPathContained(repositoryRoot, outputPath)) {
    throw new Error("--token-output must be outside the repository working tree.");
  }
  if (repositoryRoot === null && protectedOutputRoot === undefined) {
    throw new Error(
      "--protected-output-root is required when no repository root is available."
    );
  }
  if (protectedOutputRoot !== undefined) {
    await validateProtectedOutputRoot(protectedOutputRoot, outputPath);
  }
  return outputPath;
}

async function findRepositoryRoot(start: string): Promise<string | null> {
  let candidate = resolve(start);
  while (true) {
    try {
      const marker = await lstat(join(candidate, ".git"));
      if (!marker.isSymbolicLink() &&
          (marker.isDirectory() || marker.isFile())) {
        return candidate;
      }
    } catch {
      // Continue toward the filesystem root.
    }
    const parent = dirname(candidate);
    if (parent === candidate) {
      return null;
    }
    candidate = parent;
  }
}

async function validateProtectedOutputRoot(
  value: string,
  outputPath: string
): Promise<void> {
  if (!isAbsolute(value)) {
    throw new Error("--protected-output-root must be an absolute path.");
  }
  const protectedRoot = resolve(value);
  if (!isPathContained(protectedRoot, outputPath) || outputPath === protectedRoot) {
    throw new Error("--token-output must be contained within --protected-output-root.");
  }
  await requirePrivateDirectory(protectedRoot, "--protected-output-root");

  const relativeParent = relative(protectedRoot, dirname(outputPath));
  const components = relativeParent.length === 0
    ? []
    : relativeParent.split(sep);
  let candidate = protectedRoot;
  for (const component of components) {
    candidate = join(candidate, component);
    await requirePrivateDirectory(candidate, "--token-output parent");
  }
}

async function requirePrivateDirectory(path: string, label: string): Promise<void> {
  let metadata: Stats;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(`${label} must be an existing private directory.`);
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a non-symlink directory.`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must not grant group or other permissions.`);
  }
  const currentUserId = process.getuid?.();
  if (currentUserId !== undefined && metadata.uid !== currentUserId) {
    throw new Error(`${label} must be owned by the current process user.`);
  }
}

function isPathContained(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child));
  return relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) &&
      relativePath !== ".." && !isAbsolute(relativePath));
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

export function createSecretDocument(
  command: CommandOptions["command"],
  rawToken: string,
  expiresAt: string,
  origin: string
): string {
  const browserPath = command === "bootstrap"
    ? "/api/admin/app/invitations/accept"
    : "/api/admin/app/recovery/complete";
  return JSON.stringify({
    token: rawToken,
    browserUrl: `${origin}${browserPath}`,
    expiresAt
  }, null, 2);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`Administrator credential command failed: ${message}\n`);
    process.exitCode = 1;
  });
}
