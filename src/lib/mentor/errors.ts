export type MentorErrorContext = {
  endpoint?: string;
  method?: string;
  status?: number;
};

export class MentorError extends Error {
  readonly context: MentorErrorContext;

  constructor(message: string, context: MentorErrorContext = {}) {
    super(message);
    this.name = "MentorError";
    this.context = context;
  }
}

export class MentorConfigurationError extends MentorError {
  constructor(message: string) {
    super(message);
    this.name = "MentorConfigurationError";
  }
}

export class MentorAuthenticationError extends MentorError {
  constructor(message: string, context: MentorErrorContext = {}) {
    super(message, context);
    this.name = "MentorAuthenticationError";
  }
}

export class MentorHttpError extends MentorError {
  constructor(message: string, context: MentorErrorContext = {}) {
    super(message, context);
    this.name = "MentorHttpError";
  }
}

export function redactMentorSecret(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .replace(/token=([^;\s]+)/gi, "token=<redacted>")
    .replace(/("?(?:password|username|company|cookie|authorization|token)"?\s*[:=]\s*)"[^"]+"/gi, "$1\"<redacted>\"")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1<redacted>");
}
