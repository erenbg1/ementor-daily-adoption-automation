import type { MentorConfig } from "./config";
import { MentorAuthenticationError, MentorHttpError } from "./errors";

export type MentorFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

type MentorLoginResponse = {
  tokenTtl?: number;
  [key: string]: unknown;
};

type MentorRefreshResponse = {
  message?: string;
  tokenTtl?: number;
};

type MentorCookie = {
  expiresAtMs: number | null;
  name: string;
  value: string;
};

export type MentorSessionSnapshot = {
  authenticated: boolean;
  expiresAt: Date | null;
};

export type MentorSessionManagerOptions = {
  fetchImpl?: MentorFetch;
  now?: () => number;
};

export class MentorSessionManager {
  private readonly fetchImpl: MentorFetch;
  private readonly now: () => number;
  private tokenCookie: MentorCookie | null = null;

  constructor(
    private readonly config: MentorConfig,
    options: MentorSessionManagerOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  snapshot(): MentorSessionSnapshot {
    return {
      authenticated: Boolean(this.tokenCookie),
      expiresAt: this.tokenCookie?.expiresAtMs ? new Date(this.tokenCookie.expiresAtMs) : null,
    };
  }

  async login() {
    const loginEndpoint = "/auth/login";
    const response = await this.fetchWithTimeout(this.url(loginEndpoint), {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        company: this.config.company,
        languageCode: this.config.languageCode,
      }),
    });

    const body = await parseJsonSafely<MentorLoginResponse>(response);
    if (!response.ok) {
      throw new MentorAuthenticationError("Mentor login failed.", {
        endpoint: loginEndpoint,
        method: "POST",
        status: response.status,
      });
    }

    const token = extractTokenCookie(response.headers, body.tokenTtl);
    if (!token) {
      throw new MentorAuthenticationError("Mentor login did not return the required token cookie.", {
        endpoint: loginEndpoint,
        method: "POST",
        status: response.status,
      });
    }

    this.tokenCookie = token;
    return this.snapshot();
  }

  async refresh() {
    if (!this.tokenCookie) {
      return this.login();
    }

    const refreshEndpoint = "/auth/refresh";
    const response = await this.fetchWithTimeout(this.url(refreshEndpoint), {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        cookie: this.cookieHeader(),
        vrmCustom_hideProgress: "true",
        vrmCustom_requestType: "tokenRefresh",
      },
      body: "{}",
    });

    const body = await parseJsonSafely<MentorRefreshResponse>(response);
    if (!response.ok) {
      throw new MentorAuthenticationError("Mentor token refresh failed.", {
        endpoint: refreshEndpoint,
        method: "POST",
        status: response.status,
      });
    }

    const token = extractTokenCookie(response.headers, body.tokenTtl);
    if (!token) {
      throw new MentorAuthenticationError("Mentor token refresh did not return a replacement token cookie.", {
        endpoint: refreshEndpoint,
        method: "POST",
        status: response.status,
      });
    }

    this.tokenCookie = token;
    return this.snapshot();
  }

  async ensureAuthenticated() {
    if (!this.tokenCookie) {
      return this.login();
    }

    if (this.shouldRefresh()) {
      try {
        return await this.refresh();
      } catch {
        this.clearSession();
        return this.login();
      }
    }

    return this.snapshot();
  }

  async logout() {
    if (!this.tokenCookie) {
      return;
    }

    try {
      await this.fetchWithTimeout(this.url("/auth/logout"), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: this.cookieHeader(),
        },
        body: "{}",
      });
    } finally {
      this.clearSession();
    }
  }

  clearSession() {
    this.tokenCookie = null;
  }

  getCookieHeaderForRequest() {
    if (!this.tokenCookie) {
      throw new MentorAuthenticationError("Mentor session is not authenticated.");
    }

    return this.cookieHeader();
  }

  private cookieHeader() {
    if (!this.tokenCookie) {
      throw new MentorAuthenticationError("Mentor session is not authenticated.");
    }

    return `${this.tokenCookie.name}=${this.tokenCookie.value}`;
  }

  private shouldRefresh() {
    if (!this.tokenCookie?.expiresAtMs) {
      return true;
    }

    return this.now() + this.config.refreshSafetyWindowMs >= this.tokenCookie.expiresAtMs;
  }

  private url(path: string) {
    return `${this.config.baseUrl}${path}`;
  }

  private async fetchWithTimeout(input: string, init: RequestInit) {
    const endpoint = new URL(input).pathname;
    const method = init.method;
    const maxAttempts = this.config.requestRetryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await this.fetchImpl(input, { ...init, signal: controller.signal });
        if (!response.ok && !isRetryableResponse(response)) {
          return response;
        }
        if (response.ok || attempt >= maxAttempts) {
          return response;
        }

        const delayMs = this.config.requestRetryDelaysMs[attempt - 1] ?? 60_000;
        logMentorRetry({
          attempt,
          delayMs,
          endpoint,
          maxAttempts,
          method,
          reason: `HTTP ${response.status}`,
        });
        await sleep(delayMs);
      } catch (error) {
        const retryable = error instanceof Error && (error.name === "AbortError" || error instanceof TypeError);
        if (!retryable) {
          throw error;
        }

        const reason = error.name === "AbortError" ? "Mentor request timed out." : error.message;
        if (attempt >= maxAttempts) {
          throw new MentorHttpError(reason, { endpoint, method });
        }

        const delayMs = this.config.requestRetryDelaysMs[attempt - 1] ?? 60_000;
        logMentorRetry({
          attempt,
          delayMs,
          endpoint,
          maxAttempts,
          method,
          reason,
        });
        await sleep(delayMs);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new MentorHttpError("Mentor request failed after retry attempts.", { endpoint, method });
  }
}

function isRetryableResponse(response: Response) {
  return response.status === 408 || response.status === 429 || response.status >= 500;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function logMentorRetry(payload: {
  attempt: number;
  delayMs: number;
  endpoint: string;
  maxAttempts: number;
  method?: string;
  reason: string;
}) {
  console.warn(
    JSON.stringify({
      event: "MENTOR_REQUEST_RETRY",
      timestamp: new Date().toISOString(),
      ...payload,
    }),
  );
}

async function parseJsonSafely<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

export function extractTokenCookie(headers: Headers, tokenTtl?: number): MentorCookie | null {
  const setCookieHeaders = getSetCookieHeaders(headers);
  const tokenSetCookie = setCookieHeaders.find((cookie) => cookie.toLowerCase().startsWith("token="));
  if (!tokenSetCookie) {
    return null;
  }

  return parseTokenSetCookie(tokenSetCookie, tokenTtl);
}

export function getSetCookieHeaders(headers: Headers) {
  const headersWithSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headersWithSetCookie.getSetCookie === "function") {
    return headersWithSetCookie.getSetCookie();
  }

  const raw = headers.get("set-cookie");
  return raw ? splitSetCookieHeader(raw) : [];
}

function splitSetCookieHeader(value: string) {
  return value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim());
}

function parseTokenSetCookie(setCookie: string, tokenTtl?: number): MentorCookie {
  const parts = setCookie.split(";").map((part) => part.trim());
  const [name, ...valueParts] = parts[0].split("=");
  const value = valueParts.join("=");
  let expiresAtMs = tokenTtl ? tokenTtl * 1000 : null;

  for (const part of parts.slice(1)) {
    const [rawKey, ...rawValue] = part.split("=");
    const key = rawKey.toLowerCase();
    const attrValue = rawValue.join("=");

    if (key === "max-age") {
      const seconds = Number(attrValue);
      if (Number.isFinite(seconds)) {
        expiresAtMs = Date.now() + seconds * 1000;
      }
    }

    if (key === "expires") {
      const parsed = Date.parse(attrValue);
      if (Number.isFinite(parsed)) {
        expiresAtMs = parsed;
      }
    }
  }

  return { name, value, expiresAtMs };
}
