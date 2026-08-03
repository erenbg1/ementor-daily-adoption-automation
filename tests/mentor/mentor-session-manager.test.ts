import { describe, expect, it, vi } from "vitest";

import type { MentorConfig } from "../../src/lib/mentor/config";
import { loadMentorConfig } from "../../src/lib/mentor/config";
import { MentorClient } from "../../src/lib/mentor/client";
import { redactMentorSecret } from "../../src/lib/mentor/errors";
import { extractTokenCookie, MentorSessionManager, type MentorFetch } from "../../src/lib/mentor/session-manager";

function makeConfig(overrides: Partial<MentorConfig> = {}): MentorConfig {
  return {
    baseUrl: "https://mentor-api.example.com",
    company: "EXAMPLE",
    languageCode: "en",
    password: "password-secret",
    refreshSafetyWindowMs: 5 * 60 * 1000,
    requestRetryDelaysMs: [],
    requestTimeoutMs: 30_000,
    username: "mentor-user",
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

describe("MentorSessionManager", () => {
  it("logs in with the browser-equivalent Mentor payload and stores only an in-memory token cookie", async () => {
    const fetchImpl = vi.fn<MentorFetch>().mockResolvedValue(
      jsonResponse(
        { tokenTtl: 1_800 },
        { headers: { "set-cookie": "token=login-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
      ),
    );
    const session = new MentorSessionManager(makeConfig(), { fetchImpl });

    await session.login();

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://mentor-api.example.com/users/login_with_username_password",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          accept: "application/json, text/plain, */*",
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          username: "mentor-user",
          password: "password-secret",
          company: "EXAMPLE",
          languageCode: "en",
        }),
      }),
    );
    expect(session.snapshot().authenticated).toBe(true);
    expect(session.getCookieHeaderForRequest()).toBe("token=login-cookie");
  });

  it("extracts the token cookie from Set-Cookie without requiring readable browser storage", () => {
    const headers = new Headers({
      "set-cookie": "token=abc123; Max-Age=1800; Path=/; HttpOnly; Secure; SameSite=None",
    });

    expect(extractTokenCookie(headers, 1234)).toMatchObject({
      name: "token",
      value: "abc123",
    });
  });

  it("refreshes with the existing cookie and replaces it with the response cookie", async () => {
    const fetchImpl = vi
      .fn<MentorFetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: 1_800 },
          { headers: { "set-cookie": "token=login-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "ok", tokenTtl: 1_900 },
          { headers: { "set-cookie": "token=refresh-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      );
    const session = new MentorSessionManager(makeConfig(), { fetchImpl });

    await session.login();
    await session.refresh();

    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://mentor-api.example.com/users/token/refresh",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          cookie: "token=login-cookie",
          vrmCustom_requestType: "tokenRefresh",
        }),
      }),
    );
    expect(session.getCookieHeaderForRequest()).toBe("token=refresh-cookie");
  });

  it("falls back to a fresh login when refresh fails near expiry", async () => {
    let now = 1_700_000_000_000;
    const fetchImpl = vi
      .fn<MentorFetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: Math.floor((now + 60_000) / 1000) },
          { headers: { "set-cookie": "token=login-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ message: "expired" }, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: Math.floor((now + 1_800_000) / 1000) },
          { headers: { "set-cookie": "token=new-login-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      );
    const session = new MentorSessionManager(makeConfig(), { fetchImpl, now: () => now });

    await session.login();
    now += 10_000;
    await session.ensureAuthenticated();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(session.getCookieHeaderForRequest()).toBe("token=new-login-cookie");
  });
});

describe("MentorClient", () => {
  it("recovers authentication once and retries an authenticated request", async () => {
    const fetchImpl = vi
      .fn<MentorFetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: 1_800 },
          { headers: { "set-cookie": "token=first-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "unauthorized" }, { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: 1_800 },
          { headers: { "set-cookie": "token=second-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }] }));
    const client = new MentorClient(makeConfig(), { fetchImpl });

    await expect(client.getShiftMetadata()).resolves.toEqual({ data: [{ id: 1 }] });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "https://mentor-api.example.com/reports/driver/shifts/meta",
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: "token=second-cookie" }),
      }),
    );
  });

  it("retries transient Mentor API timeouts before failing the authenticated request", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi
      .fn<MentorFetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          { tokenTtl: 1_800 },
          { headers: { "set-cookie": "token=first-cookie; Path=/; HttpOnly; Secure; SameSite=None" } },
        ),
      )
      .mockRejectedValueOnce(new DOMException("The operation was aborted.", "AbortError"))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 1 }] }));
    const client = new MentorClient(makeConfig({ requestRetryDelaysMs: [10] }), { fetchImpl });

    const request = client.getShiftMetadata();
    await vi.advanceTimersByTimeAsync(10);

    await expect(request).resolves.toEqual({ data: [{ id: 1 }] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("redacts Mentor secrets from operational messages", () => {
    expect(
      redactMentorSecret(
        'Authorization: Bearer abc.def token=secret "password":"hunter2" "username":"person@example.com"',
      ),
    ).toBe('Authorization: Bearer <redacted> token=<redacted> "password":"<redacted>" "username":"<redacted>"');
  });

  it("reports missing Mentor environment variables by name only", () => {
    expect(() => loadMentorConfig({})).toThrow("MENTOR_COMPANY is required for Mentor integration.");
    expect(() =>
      loadMentorConfig({
        MENTOR_COMPANY: "EXAMPLE",
        MENTOR_PASSWORD: "secret",
      }),
    ).toThrow("MENTOR_USERNAME is required for Mentor integration.");
  });
});
