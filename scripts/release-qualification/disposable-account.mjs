/**
 * Encapsulates a synthetic qualification account and its cleanup lifecycle.
 * Credentials remain in memory and are never written or included in output.
 */

import { requireCondition } from "./http-client.mjs";

export class DisposableAccount {
  constructor(client, displayName, password) {
    this.client = client;
    this.displayName = displayName;
    this.password = password;
  }

  async register() {
    this.captureSession(
      await this.client.post("auth/register", this.credentials())
    );
  }

  async verifySession() {
    const session = await this.client.get("auth/session", {
      token: this.token
    });
    requireCondition(
      session?.user?.id === this.userId,
      "The persisted session returned a different account."
    );
  }

  async signOutAndLogin() {
    const revokedToken = this.token;
    await this.client.delete("auth/session", { token: revokedToken });
    const revokedStatus = await this.client.status("auth/session", {
      method: "GET",
      token: revokedToken
    });
    requireCondition(revokedStatus === 401, "Sign out did not revoke the session.");
    this.captureSession(
      await this.client.post("auth/login", this.credentials())
    );
  }

  async deleteIfCreated() {
    if (this.token === undefined) return;
    const token = this.token;
    const status = await this.client.status("auth/account", {
      method: "DELETE",
      token
    });
    requireCondition(
      status === 204 || status === 401,
      `Synthetic account cleanup returned ${status}.`
    );
    this.token = undefined;
  }

  credentials() {
    return { displayName: this.displayName, password: this.password };
  }

  captureSession(session) {
    requireCondition(
      typeof session?.token === "string" &&
        typeof session?.user?.id === "string",
      "Authentication did not return a complete session."
    );
    this.token = session.token;
    this.userId = session.user.id;
  }
}
