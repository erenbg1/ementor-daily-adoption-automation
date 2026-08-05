#!/usr/bin/env node
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

loadLocalEnv(path.join(repoRoot, ".env"));
loadLocalEnv(path.join(repoRoot, ".env.local"));

const DEFAULT_REPORTING_TIME_ZONE = process.env.REPORTING_TIME_ZONE || "Europe/Berlin";
process.env.TZ = DEFAULT_REPORTING_TIME_ZONE;
const FINAL_SNAPSHOT_TYPE = "final";
const OPERATIONAL_SNAPSHOT_TYPE = "operational";

require.extensions[".ts"] = function compileTypescript(module, filename) {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  module._compile(output, filename);
};

export async function runMentorAdoptionWorker({
  now = new Date(),
  force = false,
  runMode = "manual",
  fetchImpl = fetch,
  mentorClient,
} = {}) {
  validateRunMode(runMode);
  const schedule = reportingScheduleConfig();
  const current = reportingDateTime(now, schedule.timeZone);
  const reportSchedule = selectReportSchedule(current, schedule, force);
  if (!force && schedule.skipWeekdays.has(current.weekday)) {
    const skipped = {
      action: "SKIPPED_CONFIGURED_WEEKDAY",
      reportingTime: current.timestamp,
    };
    console.log(JSON.stringify(skipped, null, 2));
    return skipped;
  }
  if (!reportSchedule) {
    const skipped = {
      action: "SKIPPED_OUTSIDE_CONFIGURED_RUN_TIME",
      reportingTime: current.timestamp,
    };
    console.log(JSON.stringify(skipped, null, 2));
    return skipped;
  }

  const webAppUrl = requiredEnv("ADOPTION_WEB_APP_URL", "EMENTOR_ADOPTION_WEB_APP_URL");
  const sharedSecret = requiredEnv("ADOPTION_SHARED_SECRET", "EMENTOR_ADOPTION_SHARED_SECRET");
  const client = mentorClient ?? createMentorClient();
  const bounds = serviceDayBoundsMs(current.serviceDate);

  const shiftResponse = await client.fetchDailyShiftReport({
    decorate: "yes",
    endTime: bounds.endTime,
    localDate: current.serviceDate,
    startTime: bounds.startTime,
  });
  const shiftRows = getRows(shiftResponse);
  if (!shiftRows.length) {
    throw new Error(`Report provider returned no Shift Report rows for ${current.serviceDate}.`);
  }

  const rows = mapShiftRowsToAdoptionImport(shiftRows);
  const signedBody = buildAppsScriptSignedBody({ serviceDate: current.serviceDate, runMode, rows, snapshotType: reportSchedule.snapshotType });
  const requestBody = {
    serviceDate: current.serviceDate,
    runMode,
    rows,
    snapshotType: reportSchedule.snapshotType,
    signature: signAdoptionPayload(signedBody, sharedSecret),
  };

  const response = await fetchImpl(webAppUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
    redirect: "follow",
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Apps Script returned HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  let summary;
  try {
    summary = JSON.parse(responseText);
  } catch {
    throw new Error(`Apps Script returned non-JSON content: ${responseText.slice(0, 500)}`);
  }
  if (summary?.error) {
    throw new Error(`Apps Script adoption flow failed: ${summary.error}`);
  }
  if (
    summary?.serviceDate !== current.serviceDate
    || summary?.runMode !== runMode
    || !summary?.generatedAt
    || summary?.snapshotType !== reportSchedule.snapshotType
    || summary?.snapshotTime !== snapshotTimeLabel(reportSchedule, schedule.timeZone)
    || summaryLocationEntries(summary).length < 2
  ) {
    throw new Error("Apps Script returned an invalid adoption summary.");
  }

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

export function mapShiftRowsToAdoptionImport(rows) {
  return rows.map((row) => [
    toSheetCell(row.firstName),
    toSheetCell(row.lastName),
    toSheetCell(row.vehicleIdentifier),
    toSheetCell(row.shiftStartTime),
    toSheetCell(row.shiftEndTime),
    toSheetCell(row.duration),
    toSheetCell(row.distanceKms ?? row.distance),
    toSheetCell(row.trip ?? row.tripCount),
    toSheetCell(row.shortTrip),
    toSheetCell(row.device),
    toSheetCell(row.vrmStatus),
    toSheetCell(row.location1 ?? row.site),
  ]);
}

export function buildAdoptionEmail(summary) {
  const [[siteAName, siteA], [siteBName, siteB]] = requiredLocationEntries(summary);
  const overallExpected = siteA.expectedDrivers + siteB.expectedDrivers;
  const overallChecked = siteA.driversWithCheck + siteB.driversWithCheck;
  const overallMissing = overallExpected - overallChecked;
  const overallRate = overallExpected ? overallChecked / overallExpected : 0;

  return [
    "eMentor Daily Adoption Report",
    `Service Date: ${summary.serviceDate}`,
    `Snapshot: ${snapshotLabel(summary.snapshotType)}`,
    "",
    "OVERALL",
    `- Expected Drivers: ${overallExpected}`,
    `- Drivers with eMentor Check: ${overallChecked}`,
    `- Missing Drivers: ${overallMissing}`,
    `- Overall Adoption Rate: ${formatPercentage(overallRate)}`,
    "",
    "--------------------------------",
    "",
    formatSiteEmail(siteAName, siteA),
    "",
    "--------------------------------",
    "",
    formatSiteEmail(siteBName, siteB),
    "",
    "--------------------------------",
    "",
    "Note:",
    "This report compares today's Resource Planning expected drivers with today's eMentor Shift Report.",
    operationalSnapshotNote(summary.snapshotType),
    "",
    "Drivers who were planned but did not actually receive a route (for example due to sick leave, no-show or last-minute operational changes) may appear in the missing list and should be verified by the dispatcher before taking action.",
  ].filter((line) => line !== null).join("\n");
}

export function buildAdoptionEmailHtml(summary) {
  const [[siteAName, siteA], [siteBName, siteB]] = requiredLocationEntries(summary);
  const overallExpected = siteA.expectedDrivers + siteB.expectedDrivers;
  const overallChecked = siteA.driversWithCheck + siteB.driversWithCheck;
  const overallRate = overallExpected ? overallChecked / overallExpected : 0;
  const executiveSummary = `${overallChecked} of ${overallExpected} expected drivers completed their eMentor Check today (${formatPercentage(overallRate)} overall adoption).`;

  return `<!doctype html>
<html>
<body style="margin:0;background:#f4f6f8;color:#17212b;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:0 auto;padding:24px 12px;">
    <div style="background:#ffffff;border:1px solid #e3e8ee;border-radius:10px;padding:30px;">
      <h1 style="font-size:26px;line-height:1.25;margin:0 0 6px;">eMentor Daily Adoption Report</h1>
      <div style="font-size:14px;color:#5c6773;margin-bottom:10px;">Service Date: <strong>${escapeHtml(summary.serviceDate)}</strong></div>
      <div style="font-size:13px;color:#5c6773;margin-bottom:10px;">Snapshot: <strong>${escapeHtml(snapshotLabel(summary.snapshotType))}</strong></div>
      <div style="font-size:15px;line-height:1.5;color:#374151;margin-bottom:28px;">${escapeHtml(executiveSummary)}</div>
      ${formatSiteEmailHtml("OVERALL", {
        expectedDrivers: overallExpected,
        driversWithCheck: overallChecked,
        missingDrivers: [],
        adoptionRate: overallRate,
      }, false, "#6b7280", "#f3f4f6")}
      <hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0;">
      ${formatSiteEmailHtml(siteAName, siteA, true, "#2474c6", "#f2f7fc")}
      <hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0;">
      ${formatSiteEmailHtml(siteBName, siteB, true, "#2e7d32", "#f2f8f2")}
      <hr style="border:0;border-top:1px solid #dfe4ea;margin:30px 0 24px;">
      <h2 style="font-size:18px;margin:0 0 10px;">Notes</h2>
      <p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 10px;">This report compares today's Resource Planning expected drivers with today's eMentor Shift Report.</p>
      ${operationalSnapshotNote(summary.snapshotType) ? `<p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 10px;">${escapeHtml(operationalSnapshotNote(summary.snapshotType))}</p>` : ""}
      <p style="font-size:13px;line-height:1.55;color:#5c6773;margin:0 0 20px;">Drivers who were planned but did not actually receive a route (for example due to sick leave, no-show or last-minute operational changes) may appear in the missing list and should be verified by the dispatcher before taking action.</p>
      <div style="font-size:12px;line-height:1.5;color:#7b8490;border-top:1px solid #eef1f4;padding-top:16px;">Generated automatically on<br><strong>${escapeHtml(formatGeneratedAt(summary.generatedAt))} ${escapeHtml(process.env.REPORTING_TIME_ZONE || DEFAULT_REPORTING_TIME_ZONE)}</strong></div>
    </div>
  </div>
</body>
</html>`;
}

export function signAdoptionPayload(signedBody, sharedSecret) {
  const encodedBody = Buffer.from(signedBody, "utf8").toString("base64");
  return createHmac("sha256", sharedSecret).update(encodedBody).digest("hex");
}

export function buildAppsScriptSignedBody(payload) {
  if (payload.action === "adoption.snapshot.get") {
    return JSON.stringify({
      action: payload.action,
      serviceDate: payload.serviceDate,
    });
  }
  if (payload.action === "email.test.sendPerRecipient") {
    return JSON.stringify({
      action: payload.action,
      serviceDate: payload.serviceDate,
    });
  }
  return JSON.stringify({
    serviceDate: payload.serviceDate,
    runMode: payload.runMode,
    snapshotType: payload.snapshotType,
    rows: payload.rows,
  });
}

export function parseRunModeArg(args = []) {
  const prefix = "--run-mode=";
  const value = args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "manual";
  validateRunMode(value);
  return value;
}

export function reportingDateTime(date, timeZone = DEFAULT_REPORTING_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const serviceDate = `${values.year}-${values.month}-${values.day}`;
  const weekday = new Date(`${serviceDate}T12:00:00Z`).getUTCDay();
  return {
    hour: Number(values.hour),
    minute: Number(values.minute),
    serviceDate,
    timestamp: `${serviceDate}T${values.hour}:${values.minute}:${values.second}[${timeZone}]`,
    weekday,
  };
}

export function serviceDayBoundsMs(serviceDate) {
  const [year, month, day] = serviceDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid service date: ${serviceDate}`);

  return {
    endTime: new Date(year, month - 1, day, 23, 59, 59).getTime(),
    startTime: new Date(year, month - 1, day, 0, 0, 0).getTime(),
  };
}

export function reportingScheduleConfig() {
  const skipWeekdays = String(process.env.REPORTING_SKIP_WEEKDAYS || "0")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

  return {
    runs: [
      configuredReportTime(OPERATIONAL_SNAPSHOT_TYPE, "REPORTING_OPERATIONAL_RUN_HOUR", "REPORTING_OPERATIONAL_RUN_MINUTE", 18, 15),
      configuredReportTime(FINAL_SNAPSHOT_TYPE, "REPORTING_FINAL_RUN_HOUR", "REPORTING_FINAL_RUN_MINUTE", 22, 30),
    ],
    runGraceMinutes: configuredRunGraceMinutes(),
    skipWeekdays: new Set(skipWeekdays),
    timeZone: process.env.REPORTING_TIME_ZONE || DEFAULT_REPORTING_TIME_ZONE,
  };
}

function configuredRunGraceMinutes() {
  const runGraceMinutes = Number(process.env.REPORTING_RUN_GRACE_MINUTES || 5);
  return Number.isInteger(runGraceMinutes) && runGraceMinutes >= 0 ? runGraceMinutes : 5;
}

function configuredReportTime(snapshotType, hourEnvName, minuteEnvName, defaultHour, defaultMinute) {
  const legacyHour = snapshotType === FINAL_SNAPSHOT_TYPE ? process.env.REPORTING_RUN_HOUR : undefined;
  const legacyMinute = snapshotType === FINAL_SNAPSHOT_TYPE ? process.env.REPORTING_RUN_MINUTE : undefined;
  const runHour = Number(process.env[hourEnvName] || legacyHour || defaultHour);
  const runMinute = Number(process.env[minuteEnvName] || legacyMinute || defaultMinute);
  return {
    snapshotType,
    runHour: Number.isInteger(runHour) ? runHour : defaultHour,
    runMinute: Number.isInteger(runMinute) ? runMinute : defaultMinute,
  };
}

function selectReportSchedule(current, schedule, force) {
  const currentMinuteOfDay = current.hour * 60 + current.minute;
  const matched = schedule.runs.find((run) => {
    const runMinuteOfDay = run.runHour * 60 + run.runMinute;
    const minutesAfterScheduledRun = currentMinuteOfDay - runMinuteOfDay;
    return minutesAfterScheduledRun >= 0 && minutesAfterScheduledRun <= schedule.runGraceMinutes;
  });
  if (matched) return matched;
  if (force) return schedule.runs.find((run) => run.snapshotType === FINAL_SNAPSHOT_TYPE);
  return null;
}

function snapshotTimeLabel(reportSchedule, timeZone) {
  return `${String(reportSchedule.runHour).padStart(2, "0")}:${String(reportSchedule.runMinute).padStart(2, "0")} ${timeZone}`;
}

function createMentorClient() {
  const { loadMentorConfig, MentorClient } = require(path.join(repoRoot, "src/lib/mentor/index.ts"));
  return new MentorClient(loadMentorConfig(process.env));
}

function getRows(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.rows)) return response.rows;
  if (Array.isArray(response?.result)) return response.result;
  if (Array.isArray(response?.items)) return response.items;
  if (Array.isArray(response?.data?.rows)) return response.data.rows;
  if (Array.isArray(response?.data?.items)) return response.data.items;
  return [];
}

function toSheetCell(value) {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  return JSON.stringify(value);
}

function summaryLocationEntries(summary) {
  const locations = summary?.sites || summary?.stations || {};
  return Object.entries(locations).filter(([, value]) => value && typeof value === "object");
}

function requiredLocationEntries(summary) {
  const entries = summaryLocationEntries(summary);
  if (!summary?.serviceDate || entries.length < 2) {
    throw new Error("Invalid adoption summary: missing adoption location summaries or serviceDate.");
  }
  return entries.slice(0, 2);
}

function snapshotLabel(snapshotType) {
  return snapshotType === OPERATIONAL_SNAPSHOT_TYPE
    ? "Operational Snapshot (18:15)"
    : "Final Daily Report (22:30)";
}

function operationalSnapshotNote(snapshotType) {
  return snapshotType === OPERATIONAL_SNAPSHOT_TYPE
    ? "Operational snapshot: later waves, especially SD-C, may still be in progress. The 22:30 Final Daily Report is the official end-of-day snapshot."
    : null;
}

function formatSiteEmail(site, summary) {
  const missingDrivers = sortedDriverNames(summary.missingDrivers);
  const missingList = missingDrivers.length
    ? missingDrivers.map((name) => `- ${String(name).trim()}`).join("\n")
    : "- None";

  return [
    site,
    `- Expected Drivers: ${summary.expectedDrivers}`,
    `- Drivers with eMentor Check: ${summary.driversWithCheck}`,
    `- Missing Drivers: ${summary.expectedDrivers - summary.driversWithCheck}`,
    `- Adoption Rate: ${formatPercentage(summary.adoptionRate)}`,
    "",
    "Drivers without eMentor Check:",
    missingList,
  ].join("\n");
}

function formatSiteEmailHtml(site, summary, includeMissingDrivers, accent, background) {
  const missingDrivers = sortedDriverNames(summary.missingDrivers);
  const missingCount = Number(summary.expectedDrivers) - Number(summary.driversWithCheck);
  const missingList = missingDrivers.length
    ? `<ul style="margin:8px 0 0;padding-left:20px;font-size:14px;line-height:1.7;">${missingDrivers
      .map((name) => `<li>${escapeHtml(String(name).trim())}</li>`)
      .join("")}</ul>`
    : '<div style="font-size:14px;color:#5c6773;margin-top:8px;">None</div>';

  return `<section>
        <h2 style="font-size:21px;line-height:1.3;margin:0 0 16px;color:${accent};">${site}</h2>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
          <tr>
            ${formatKpiCell("Expected Drivers", summary.expectedDrivers, accent, background)}
            ${formatKpiCell("With Check", summary.driversWithCheck, accent, background)}
            ${formatKpiCell("Missing", missingCount, accent, background)}
            ${formatKpiCell("Adoption", formatPercentage(summary.adoptionRate), accent, background)}
          </tr>
        </table>
        ${includeMissingDrivers ? `<div style="font-size:14px;font-weight:bold;margin-top:20px;">Drivers without eMentor Check</div>${missingList}` : ""}
      </section>`;
}

function formatKpiCell(label, value, accent, background) {
  return `<td width="25%" valign="top" style="padding:12px 8px;border-left:3px solid ${accent};background:${background};">
              <div style="font-size:12px;line-height:1.3;color:#687480;">${label}</div>
              <div style="font-size:20px;line-height:1.3;font-weight:bold;margin-top:4px;">${value}</div>
            </td>`;
}

function sortedDriverNames(names) {
  return (Array.isArray(names) ? names : [])
    .map((name) => String(name).trim())
    .sort((a, b) => a.localeCompare(b));
}

function formatGeneratedAt(generatedAt) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone: process.env.REPORTING_TIME_ZONE || DEFAULT_REPORTING_TIME_ZONE,
    year: "numeric",
  }).formatToParts(new Date(generatedAt));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.day} ${values.month} ${values.year}, ${values.hour}:${values.minute}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPercentage(rate) {
  return `${(Number(rate || 0) * 100).toFixed(1)}%`;
}

function requiredEnv(name, legacyName) {
  const value = process.env[name]?.trim() || (legacyName ? process.env[legacyName]?.trim() : "");
  if (!value) {
    throw new Error(legacyName ? `${name} or ${legacyName} is required.` : `${name} is required.`);
  }
  return value;
}

function validateRunMode(runMode) {
  if (!["test", "manual", "production"].includes(runMode)) {
    throw new Error("runMode must be test, manual or production.");
  }
}

function loadLocalEnv(filePath) {
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

function redact(value) {
  let redacted = String(value);
  for (const secret of [
    process.env.MENTOR_USERNAME,
    process.env.MENTOR_PASSWORD,
    process.env.ADOPTION_SHARED_SECRET,
    process.env.EMENTOR_ADOPTION_SHARED_SECRET,
  ]) {
    if (secret) redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted;
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  const args = process.argv.slice(2);
  runMentorAdoptionWorker({
    force: args.includes("--force"),
    runMode: parseRunModeArg(args),
  }).catch((error) => {
    console.error(redact(error?.stack || error?.message || error));
    process.exitCode = 1;
  });
}
