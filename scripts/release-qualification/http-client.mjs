/**
 * Provides the qualification scripts with one timeout-aware HTTP boundary.
 * Error messages intentionally omit response bodies so test data stays private.
 */

export class QualificationHttpClient {
  constructor(baseUrl, timeoutMilliseconds) {
    this.baseUrl = baseUrl;
    this.timeoutMilliseconds = timeoutMilliseconds;
  }

  get(path, options) {
    return this.request(path, { ...options, method: "GET" });
  }

  post(path, body, options) {
    return this.request(path, { ...options, method: "POST", body });
  }

  put(path, body, options) {
    return this.request(path, { ...options, method: "PUT", body });
  }

  patch(path, body, options) {
    return this.request(path, { ...options, method: "PATCH", body });
  }

  delete(path, options) {
    return this.request(path, { ...options, method: "DELETE" });
  }

  async status(path, options = {}) {
    const response = await this.send(path, options);
    await response.body?.cancel();
    return response.status;
  }

  async request(path, options = {}) {
    const response = await this.send(path, options);
    if (!response.ok) {
      throw new Error(`${options.method} ${path} returned ${response.status}.`);
    }
    if (response.status === 204) {
      return undefined;
    }
    return response.json();
  }

  async send(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.timeoutMilliseconds
    );
    const headers = new Headers(options.headers);
    if (options.token !== undefined) {
      headers.set("authorization", `Bearer ${options.token}`);
    }
    if (options.adminToken !== undefined) {
      headers.set("x-admin-token", options.adminToken);
    }
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set("content-type", "application/json");
    }

    try {
      return await fetch(new URL(path, this.baseUrl), {
        method: options.method,
        headers,
        body: serializeBody(options.body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`${options.method} ${path} timed out.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function requireCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function serializeBody(body) {
  if (body === undefined || body instanceof FormData) {
    return body;
  }
  return JSON.stringify(body);
}
