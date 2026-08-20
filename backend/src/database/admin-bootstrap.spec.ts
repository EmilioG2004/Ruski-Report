import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createSecretDocument,
  parseArguments,
  validateSecretOutputPath
} from "./admin-bootstrap";

describe("administrator bootstrap secret document", () => {
  it.each([
    ["bootstrap", "https://admin.example/api/admin/app/invitations/accept"],
    ["recover", "https://admin.example/api/admin/app/recovery/complete"]
  ] as const)("keeps the %s token out of URLs", (command, browserUrl) => {
    const rawToken = "raw-secret-token-value";
    const document = createSecretDocument(
      command,
      rawToken,
      "2026-08-21T12:00:00.000Z",
      "https://admin.example"
    );
    const parsed = JSON.parse(document) as Record<string, string>;

    expect(parsed).toEqual({
      token: rawToken,
      browserUrl,
      expiresAt: "2026-08-21T12:00:00.000Z"
    });
    expect(parsed.browserUrl).not.toContain(rawToken);
    expect(document).not.toContain("#token=");
    expect(document).not.toContain("?token=");
  });
});

describe("administrator bootstrap command safety", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), "ruski-admin-cli-"));
    await chmod(temporaryDirectory, 0o700);
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("parses an explicit protected output root for runtime images", () => {
    expect(parseArguments([
      "bootstrap",
      "--login-name", "owner",
      "--display-name", "Owner",
      "--protected-output-root", "/run/ruski-admin",
      "--token-output", "/run/ruski-admin/bootstrap.json"
    ])).toMatchObject({
      command: "bootstrap",
      protectedOutputRoot: "/run/ruski-admin",
      tokenOutputPath: "/run/ruski-admin/bootstrap.json"
    });
  });

  it("requires a protected root when a runtime image has no checkout", async () => {
    await expect(validateSecretOutputPath(
      join(temporaryDirectory, "bootstrap.json"),
      undefined,
      null
    )).rejects.toThrow("--protected-output-root is required");
  });

  it("accepts only contained output below private non-symlink directories", async () => {
    const nested = join(temporaryDirectory, "credentials");
    await mkdir(nested, { mode: 0o700 });
    const output = join(nested, "bootstrap.json");

    await expect(validateSecretOutputPath(
      output,
      temporaryDirectory,
      null
    )).resolves.toBe(output);
    await expect(validateSecretOutputPath(
      join(tmpdir(), "outside-bootstrap.json"),
      temporaryDirectory,
      null
    )).rejects.toThrow("contained within");
  });

  it("rejects permissive and symlinked protected directories", async () => {
    const permissive = join(temporaryDirectory, "permissive");
    await mkdir(permissive, { mode: 0o755 });
    await expect(validateSecretOutputPath(
      join(permissive, "bootstrap.json"),
      permissive,
      null
    )).rejects.toThrow("group or other permissions");

    const privateTarget = join(temporaryDirectory, "private-target");
    const linked = join(temporaryDirectory, "linked");
    await mkdir(privateTarget, { mode: 0o700 });
    await symlink(privateTarget, linked);
    await expect(validateSecretOutputPath(
      join(linked, "bootstrap.json"),
      linked,
      null
    )).rejects.toThrow("non-symlink");
  });

  it("retains the outside-repository rule in a checkout", async () => {
    const checkout = join(temporaryDirectory, "checkout");
    await mkdir(checkout, { mode: 0o700 });
    await expect(validateSecretOutputPath(
      join(checkout, "credential.json"),
      undefined,
      checkout
    )).rejects.toThrow("outside the repository");
    await expect(validateSecretOutputPath(
      join(temporaryDirectory, "credential.json"),
      undefined,
      checkout
    )).resolves.toBe(join(temporaryDirectory, "credential.json"));
  });
});
