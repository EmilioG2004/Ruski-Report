import { AuthConfig } from "../config/auth.config";
import { ScryptPasswordHasher } from "./password-hasher";

const testConfig: AuthConfig = {
  maximumDisplayNameLength: 40,
  minimumPasswordLength: 10,
  maximumPasswordLength: 128,
  sessionLifetimeSeconds: 3600,
  passwordHash: {
    cost: 1024,
    blockSize: 8,
    parallelization: 1,
    keyLength: 32,
    saltLength: 16
  },
  sessionTokenLength: 32
};

describe("ScryptPasswordHasher", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const hasher = new ScryptPasswordHasher(testConfig);

    const encoded = await hasher.hash("correct horse battery staple");

    expect(encoded).toMatch(/^scrypt\$1\$1024\$8\$1\$/);
    expect(encoded).not.toContain("correct horse battery staple");
    await expect(
      hasher.verify("correct horse battery staple", encoded)
    ).resolves.toBe(true);
    await expect(hasher.verify("wrong password", encoded)).resolves.toBe(false);
  });

  it("rejects unsupported encoded hashes", async () => {
    const hasher = new ScryptPasswordHasher(testConfig);

    await expect(hasher.verify("password", "plaintext")).resolves.toBe(false);
    await expect(
      hasher.verify("password", "scrypt$1$1073741824$8$1$c2FsdA$aGFzaA")
    ).resolves.toBe(false);
  });
});
