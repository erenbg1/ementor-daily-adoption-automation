const DEFAULT_BASE_URL = "https://mentor-api.example.com";

async function loadEnvFile(path) {
  let text;
  try {
    text = await import("node:fs/promises").then((fs) => fs.readFile(path, "utf8"));
  } catch {
    return;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }

    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function splitSetCookieHeader(value) {
  return value ? value.split(/,(?=\s*[^;,=\s]+=[^;,]+)/g).map((cookie) => cookie.trim()) : [];
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  return splitSetCookieHeader(headers.get("set-cookie"));
}

function extractTokenCookie(headers) {
  const tokenCookie = getSetCookieHeaders(headers).find((cookie) => cookie.toLowerCase().startsWith("token="));
  if (!tokenCookie) {
    throw new Error("Mentor did not return a token cookie.");
  }
  return tokenCookie.split(";")[0];
}

function rowCount(payload) {
  if (Array.isArray(payload)) {
    return payload.length;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data.length;
  }
  return null;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  await loadEnvFile(".env.local");
  await loadEnvFile(".env");

  const baseUrl = (process.env.MENTOR_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const username = requireEnv("MENTOR_USERNAME");
  const company = requireEnv("MENTOR_COMPANY");
  const password = requireEnv("MENTOR_PASSWORD");

  const login = await fetch(`${baseUrl}/users/login_with_username_password`, {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username,
      password,
      company,
      languageCode: "en",
    }),
  });
  const loginBody = await readJson(login);
  let cookie = extractTokenCookie(login.headers);

  const refresh = await fetch(`${baseUrl}/users/token/refresh`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
      vrmCustom_hideProgress: "true",
      vrmCustom_requestType: "tokenRefresh",
    },
    body: "{}",
  });
  const refreshBody = await readJson(refresh);
  cookie = extractTokenCookie(refresh.headers);

  const comparison = await fetch(`${baseUrl}/reports/mentor/driver_performance_delta`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      cookie,
    },
    body: JSON.stringify({
      filter: {},
      periodFilter: null,
      course: "",
      gridParams: null,
      search: "",
      decorate: "yes",
      selectedLanguage: "en",
      timeZone: "Europe/Berlin",
    }),
  });
  const comparisonBody = await readJson(comparison);

  const shiftMetadata = await fetch(`${baseUrl}/reports/driver/shifts/meta`, {
    headers: {
      accept: "application/json",
      cookie,
    },
  });
  const shiftMetadataBody = await readJson(shiftMetadata);

  console.log(
    JSON.stringify(
      {
        authenticated: login.ok,
        loginStatus: login.status,
        loginTokenTtlPresent: typeof loginBody?.tokenTtl === "number",
        refreshSuccessful: refresh.ok,
        refreshStatus: refresh.status,
        refreshTokenTtlPresent: typeof refreshBody?.tokenTtl === "number",
        comparisonStatus: comparison.status,
        comparisonRowCount: rowCount(comparisonBody),
        shiftMetadataStatus: shiftMetadata.status,
        shiftMetadataRowCount: rowCount(shiftMetadataBody),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : "Mentor verification failed.",
    }),
  );
  process.exit(1);
});
