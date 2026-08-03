import type { MentorConfig } from "./config";
import { MentorHttpError } from "./errors";
import { MentorSessionManager, type MentorFetch } from "./session-manager";

type MentorRequestOptions = {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
};

export type MentorClientOptions = {
  fetchImpl?: MentorFetch;
  sessionManager?: MentorSessionManager;
};

export class MentorClient {
  readonly session: MentorSessionManager;
  private readonly fetchImpl: MentorFetch;

  constructor(
    private readonly config: MentorConfig,
    options: MentorClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.session = options.sessionManager ?? new MentorSessionManager(config, { fetchImpl: this.fetchImpl });
  }

  async get<T = unknown>(path: string, options: MentorRequestOptions = {}) {
    return this.authenticatedRequest<T>("GET", path, options);
  }

  async post<T = unknown>(path: string, body?: unknown, options: Omit<MentorRequestOptions, "body"> = {}) {
    return this.authenticatedRequest<T>("POST", path, { ...options, body });
  }

  async fetchComparisonReport(body: Partial<MentorComparisonReportRequest> = {}) {
    return this.post<MentorReportResponse>("/reports/comparison", {
      filter: {},
      periodFilter: null,
      course: "",
      gridParams: null,
      search: "",
      decorate: "yes",
      selectedLanguage: this.config.languageCode,
      timeZone: this.config.timeZone,
      ...body,
    });
  }

  async fetchDailyShiftMetadata() {
    return this.get<MentorReportResponse>("/reports/daily-shifts/meta");
  }

  async fetchDailyShiftReport(params: MentorShiftReportParams) {
    return this.get<MentorReportResponse>("/reports/daily-shifts", {
      query: {
        decorate: params.decorate ?? "yes",
        startTime: params.startTime,
        endTime: params.endTime,
        localDate: params.localDate,
        fpId: params.fpId,
      },
    });
  }

  async fetchDailyShiftDeviceDetails(devices: string[]) {
    return this.post<MentorReportResponse>("/reports/daily-shifts/devices", { devices });
  }

  private async authenticatedRequest<T>(method: "GET" | "POST", path: string, options: MentorRequestOptions) {
    await this.session.ensureAuthenticated();

    try {
      return await this.request<T>(method, path, options);
    } catch (error) {
      if (!isRecoverableAuthError(error)) {
        throw error;
      }

      this.session.clearSession();
      await this.session.ensureAuthenticated();
      return this.request<T>(method, path, options);
    }
  }

  private async request<T>(method: "GET" | "POST", path: string, options: MentorRequestOptions) {
    const url = this.buildUrl(path, options.query);

    return this.withRetries(`Mentor API ${method} ${path}`, path, method, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers: {
            accept: "application/json",
            cookie: this.session.getCookieHeaderForRequest(),
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
          },
          body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new MentorHttpError("Mentor API request failed.", {
            endpoint: path,
            method,
            status: response.status,
          });
        }

        return (await response.json()) as T;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new MentorHttpError("Mentor API request timed out.", { endpoint: path, method });
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private buildUrl(path: string, query?: MentorRequestOptions["query"]) {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private async withRetries<T>(
    label: string,
    endpoint: string,
    method: "GET" | "POST",
    operation: () => Promise<T>,
  ) {
    const maxAttempts = this.config.requestRetryDelaysMs.length + 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!isRetryablAdoptionError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = this.config.requestRetryDelaysMs[attempt - 1] ?? 60_000;
        console.warn(
          JSON.stringify({
            attempt,
            delayMs,
            endpoint,
            event: "MENTOR_REQUEST_RETRY",
            label,
            maxAttempts,
            method,
            reason: error instanceof Error ? error.message : String(error),
            timestamp: new Date().toISOString(),
          }),
        );
        await sleep(delayMs);
      }
    }

    throw new MentorHttpError("Mentor API request failed after retry attempts.", { endpoint, method });
  }
}

function isRecoverableAuthError(error: unknown) {
  return error instanceof MentorHttpError && (error.context.status === 401 || error.context.status === 403);
}

function isRetryablAdoptionError(error: unknown) {
  if (!(error instanceof MentorHttpError)) {
    return error instanceof TypeError;
  }

  return (
    error.message.toLowerCase().includes("timed out") ||
    error.context.status === 408 ||
    error.context.status === 429 ||
    (typeof error.context.status === "number" && error.context.status >= 500)
  );
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type MentorComparisonReportRequest = {
  course: string;
  decorate: "yes" | "no";
  filter: Record<string, unknown>;
  gridParams: unknown;
  periodFilter: unknown;
  search: string;
  selectedLanguage: string;
  timeZone: string;
};

export type MentorShiftReportParams = {
  decorate?: "yes" | "no";
  endTime: number;
  fpId: string | number;
  localDate: string;
  startTime: number;
};

export type MentorReportResponse = {
  data?: unknown[];
  [key: string]: unknown;
};
