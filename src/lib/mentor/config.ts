import { env } from "../env";
import { MentorConfigurationError } from "./errors";

export const DEFAULT_MENTOR_BASE_URL = "https://mentor.example.com";
export const DEFAULT_MENTOR_LANGUAGE = "en";
export const DEFAULT_MENTOR_REFRESH_SAFETY_WINDOW_MS = 5 * 60 * 1000;
export const DEFAULT_MENTOR_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_MENTOR_RETRY_DELAYS_MS = [3_000, 15_000, 60_000];

export type MentorConfig = {
  baseUrl: string;
  company: string;
  languageCode: string;
  password: string;
  refreshSafetyWindowMs: number;
  requestRetryDelaysMs: number[];
  requestTimeoutMs: number;
  timeZone: string;
  username: string;
};

type MentorEnvironment = Partial<Record<string, string | undefined>>;

function requireMentorEnv(environment: MentorEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new MentorConfigurationError(`${name} is required for Mentor integration.`);
  }

  return value;
}

function numberFromEnv(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function retryDelaysFromEnv(value: string | undefined, fallback: number[]) {
  if (!value?.trim()) {
    return fallback;
  }

  const delays = value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((delay) => Number.isFinite(delay) && delay >= 0);

  return delays.length > 0 ? delays : fallback;
}

export function loadMentorConfig(environment: MentorEnvironment = process.env): MentorConfig {
  const baseUrl = environment.MENTOR_BASE_URL?.trim() || env.MENTOR_BASE_URL || DEFAULT_MENTOR_BASE_URL;

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    company: requireMentorEnv(environment, "MENTOR_COMPANY"),
    languageCode: environment.MENTOR_LANGUAGE_CODE?.trim() || DEFAULT_MENTOR_LANGUAGE,
    password: requireMentorEnv(environment, "MENTOR_PASSWORD"),
    refreshSafetyWindowMs: numberFromEnv(
      environment.MENTOR_REFRESH_SAFETY_WINDOW_MS,
      env.MENTOR_REFRESH_SAFETY_WINDOW_MS ?? DEFAULT_MENTOR_REFRESH_SAFETY_WINDOW_MS,
    ),
    requestRetryDelaysMs: retryDelaysFromEnv(
      environment.MENTOR_REQUEST_RETRY_DELAYS_MS,
      DEFAULT_MENTOR_RETRY_DELAYS_MS,
    ),
    requestTimeoutMs: numberFromEnv(environment.MENTOR_REQUEST_TIMEOUT_MS, DEFAULT_MENTOR_REQUEST_TIMEOUT_MS),
    timeZone: environment.REPORTING_TIME_ZONE?.trim() || env.REPORTING_TIME_ZONE || "Etc/UTC",
    username: requireMentorEnv(environment, "MENTOR_USERNAME"),
  };
}
