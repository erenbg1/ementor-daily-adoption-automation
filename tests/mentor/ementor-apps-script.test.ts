import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const matcherSource = readFileSync(path.join(repoRoot, "apps-script/ementor.gs"), "utf8");
const adoptionSource = readFileSync(path.join(repoRoot, "apps-script/adoption.gs"), "utf8");

type AppsScriptRuntimeContext = vm.Context & {
  buildAdoptionEmailHtml_: (summary: unknown) => string;
  checkSiteA: () => void;
  checkSiteB: () => void;
  doPost: (event: { postData: { contents: string } }) => { text: string };
  isSkippedServiceDate_: (serviceDate: string) => boolean;
};

class MockSheet {
  data: unknown[][];
  selection = "";

  constructor(data: unknown[][] = []) {
    this.data = data.map((row) => [...row]);
  }

  getDataRange() {
    return { getValues: () => this.data.map((row) => [...row]) };
  }

  getLastRow() {
    return this.data.length;
  }

  getMaxRows() {
    return Math.max(this.data.length, 100);
  }

  insertRowsAfter(_after: number, count: number) {
    for (let i = 0; i < count; i += 1) this.data.push([]);
  }

  getRange(row: number, column: number, rowCount: number, columnCount: number) {
    return {
      clearContent: () => {
        for (let r = row - 1; r < row - 1 + rowCount; r += 1) {
          this.ensureRow(r);
          for (let c = column - 1; c < column - 1 + columnCount; c += 1) this.data[r][c] = "";
        }
      },
      getValues: () => {
        const values: unknown[][] = [];
        for (let r = row - 1; r < row - 1 + rowCount; r += 1) {
          values.push(Array.from({ length: columnCount }, (_value, offset) => this.data[r]?.[column - 1 + offset] ?? ""));
        }
        return values;
      },
      setValues: (values: unknown[][]) => {
        values.forEach((inputRow, rowOffset) => {
          const targetRow = row - 1 + rowOffset;
          this.ensureRow(targetRow);
          inputRow.forEach((value, columnOffset) => {
            this.data[targetRow][column - 1 + columnOffset] = value;
          });
        });
      },
    };
  }

  appendRow(row: unknown[]) {
    this.data.push([...row]);
  }

  clearContents() {
    this.data = [];
  }

  setActiveSelection(selection: string) {
    this.selection = selection;
  }

  private ensureRow(index: number) {
    while (this.data.length <= index) this.data.push([]);
  }
}

function buildRuntime({ emailEnabled = false, expectedDate = berlinToday() } = {}) {
  const gmailAppCalls: Array<Record<string, unknown>> = [];
  const sheets: Record<string, MockSheet> = {
    ALIAS_TABLE: new MockSheet([["AdoptionNAME", "RP"]]),
    EXPECTED_DRIVERS: new MockSheet([
      ["Date", "Personnel Nr", "Name", "Site", "Shift", "Key"],
      [expectedDate, "1", "Ada Lovelace", "SITE_A", "1", ""],
      [expectedDate, "2", "Bob Missing", "SITE_A", "1", ""],
      [expectedDate, "3", "Alan Turing", "SITE_B", "1", ""],
    ]),
    Adoption_Check: new MockSheet([
      ["old", "header", "", "", "", "", "", "", "", "", "", ""],
      ["stale", "driver", "", "", "", "", "", "", "", "", "", "SITE_A"],
    ]),
  };
  const alerts: unknown[][] = [];
  const ui = {
    Button: { NO: "NO", YES: "YES" },
    ButtonSet: { YES_NO: "YES_NO" },
    alert: (...args: unknown[]) => {
      alerts.push(args);
      return "NO";
    },
  };
  const ss = {
    getSheetByName: (name: string) => sheets[name] ?? null,
    insertSheet: (name: string) => (sheets[name] = new MockSheet()),
  };
  let released = false;
  const secret = "test-shared-secret";
  const context = vm.createContext({
    console,
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: (text: string) => ({
        text,
        setMimeType() { return this; },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        releaseLock: () => { released = true; },
        tryLock: () => true,
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (name: string) => {
          if (name === "ADOPTION_SHARED_SECRET") return secret;
          if (name === "ADOPTION_SPREADSHEET_ID") return "example-spreadsheet-id";
          if (name === "ADOPTION_PER_RECIPIENT_EMAIL_ENABLED") return emailEnabled ? "true" : null;
          return null;
        },
      }),
    },
    GmailApp: {
      getAliases: () => ["reports@example.com"],
      sendEmail: (to: string, subject: string, body: string, options: Record<string, unknown>) => {
        gmailAppCalls.push({ to, subject, body, options: { ...options } });
      },
    },
    SpreadsheetApp: {
      getActive: () => ss,
      getUi: () => ui,
      openById: () => ss,
    },
    Utilities: {
      Charset: { UTF_8: "UTF_8" },
      base64Encode: (body: string) => Buffer.from(body, "utf8").toString("base64"),
      computeHmacSha256Signature: (body: string, key: string) =>
        Array.from(createHmac("sha256", key).update(body).digest()).map((value) => value > 127 ? value - 256 : value),
      formatDate: (date: Date, timeZone: string, pattern: string) => {
        if (pattern === "dd MMM yyyy, HH:mm") {
          const parts = new Intl.DateTimeFormat("en-GB", {
            day: "2-digit", hour: "2-digit", hourCycle: "h23", minute: "2-digit",
            month: "short", timeZone, year: "numeric",
          }).formatToParts(date);
          const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
          return `${values.day} ${values.month} ${values.year}, ${values.hour}:${values.minute}`;
        }
        return new Intl.DateTimeFormat("en-CA", {
          day: "2-digit", month: "2-digit", timeZone, year: "numeric",
        }).format(date);
      },
    },
  });
  vm.runInContext(matcherSource, context);
  vm.runInContext(adoptionSource, context);

  return { alerts, context: context as AppsScriptRuntimeContext, gmailAppCalls, released: () => released, secret, sheets };
}

function berlinToday() {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Etc/UTC",
    year: "numeric",
  }).format(new Date());
}

function postAdoption(runtime: ReturnType<typeof buildRuntime>, rows: unknown[][], runMode: "test" | "manual" | "production") {
  const serviceDate = berlinToday();
  const signedBody = JSON.stringify({ serviceDate, runMode, rows });
  const signature = createHmac("sha256", runtime.secret)
    .update(Buffer.from(signedBody, "utf8").toString("base64"))
    .digest("hex");
  return runtime.context.doPost({
    postData: { contents: JSON.stringify({ serviceDate, runMode, rows, signature }) },
  });
}

function postAction(runtime: ReturnType<typeof buildRuntime>, payload: Record<string, unknown>) {
  let signedBody: string;
  if (payload.action === "adoption.snapshot.get") {
    signedBody = JSON.stringify({ action: payload.action, serviceDate: payload.serviceDate });
  } else if (payload.action === "email.test.sendPerRecipient") {
    signedBody = JSON.stringify({ action: payload.action, serviceDate: payload.serviceDate });
  } else {
    throw new Error(`Unsupported test action: ${payload.action}`);
  }
  const signature = createHmac("sha256", runtime.secret)
    .update(Buffer.from(signedBody, "utf8").toString("base64"))
    .digest("hex");
  return runtime.context.doPost({
    postData: { contents: JSON.stringify({ ...payload, signature }) },
  });
}

describe("Adoption Apps Script adoption endpoint", () => {
  it("keeps the SITE_A and SITE_B manual actions behaviorally identical", () => {
    const runtime = buildRuntime();
    runtime.sheets.Adoption_Check.data = [
      ["First Name", "Last Name", "", "", "", "", "", "", "", "", "", "Site"],
      ["Ada", "Lovelace", "", "", "", "", "", "", "", "", "", "SITE_A"],
    ];

    runtime.context.checkSiteA();
    expect(runtime.alerts.at(-1)?.[0]).toContain("Missing adoption checks (1)");
    expect(runtime.alerts.at(-1)?.[0]).toContain("SITE_A:\nBob Missing");
    expect(runtime.alerts.at(-1)?.[0]).not.toContain("SITE_B:");

    runtime.context.checkSiteB();
    expect(runtime.alerts.at(-1)?.[0]).toContain("Missing adoption checks (1)");
    expect(runtime.alerts.at(-1)?.[0]).toContain("SITE_B:\nAlan Turing");
    expect(runtime.alerts.at(-1)?.[0]).not.toContain("SITE_A:");
  });

  it("replaces A:L, runs the matcher headlessly, and deduplicates adoption", () => {
    const runtime = buildRuntime();
    const serviceDate = berlinToday();
    const rows = [
      ["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"],
      ["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"],
      ["Alan", "Turing", "", "", "", "", "", "", false, "", "", "SITE_B"],
      ["Éxtra", "Driver", "", "", "", "", "", "", false, "", "", "SITE_A"],
    ];
    const response = postAdoption(runtime, rows, "manual");
    const summary = JSON.parse(response.text);

    expect(summary).toMatchObject({
      serviceDate,
      runMode: "manual",
      snapshotTime: "18:00 Etc/UTC",
      sites: {
        SITE_A: {
          adoptionRate: 0.5,
          driversWithCheck: 1,
          expectedDrivers: 2,
          extraMentorDrivers: ["Éxtra Driver"],
          missingDrivers: ["Bob Missing"],
          unmatchedNames: [],
        },
        SITE_B: {
          adoptionRate: 1,
          driversWithCheck: 1,
          expectedDrivers: 1,
          extraMentorDrivers: [],
          missingDrivers: [],
          unmatchedNames: [],
        },
      },
    });
    expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(runtime.sheets.Adoption_Check.data[0].slice(0, 12)).toEqual([
      "First Name", "Last Name", "Vehicle Identifier", "Begin Route Time", "End Route Time", "Total Driver Hours",
      "Total Driver km", "Trip", "Short Trip", "Device", "Is Supported?", "Site",
    ]);
    expect(runtime.sheets.Adoption_Check.data[1].slice(0, 12)).toEqual(rows[0]);
    expect(runtime.sheets.ADOPTION_HISTORY).toBeUndefined();
    expect(runtime.released()).toBe(true);
  });

  it("writes history only for production, returns email payload, and keeps production GmailApp disabled by default", () => {
    const runtime = buildRuntime();
    const serviceDate = berlinToday();

    postAdoption(runtime, [["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"]], "test");
    postAdoption(runtime, [["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"]], "manual");
    expect(runtime.sheets.ADOPTION_HISTORY).toBeUndefined();

    const productionResponse = postAdoption(runtime, [["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"]], "production");
    const productionSummary = JSON.parse(productionResponse.text);
    const firstRecord = [...runtime.sheets.ADOPTION_HISTORY.data[1]];
    postAdoption(runtime, [["Alan", "Turing", "", "", "", "", "", "", false, "", "", "SITE_B"]], "production");
    postAdoption(runtime, [["Alan", "Turing", "", "", "", "", "", "", false, "", "", "SITE_B"]], "manual");

    expect(runtime.sheets.ADOPTION_HISTORY.data).toHaveLength(2);
    expect(runtime.sheets.ADOPTION_HISTORY.data[1]).toEqual(firstRecord);
    expect(productionSummary.history).toEqual({ snapshotCreated: true });
    expect(["EMAIL_SKIPPED_DISABLED", "EMAIL_SKIPPED_CONFIGURED_WEEKDAY"]).toContain(productionSummary.emailSubmission.action);
    expect(productionSummary.emailSubmission.recipients).toEqual([]);
    expect(runtime.gmailAppCalls).toHaveLength(0);
    expect(productionSummary.email.subject).toBe(`eMentor Daily Adoption Report — ${serviceDate}`);
    expect(productionSummary.email.recipients.map((recipient: { email: string }) => recipient.email)).toEqual([
      "ops-lead@example.com",
      "dispatcher@example.com",
      "site-manager@example.com",
    ]);
    expect(productionSummary.email.htmlBody).toContain("expected drivers completed their eMentor Check today");
    expect(productionSummary.email.htmlBody).toContain("#6b7280");
    expect(productionSummary.email.htmlBody).toContain("#2474c6");
    expect(productionSummary.email.htmlBody).toContain("#2e7d32");
    expect(productionSummary.email.htmlBody).toContain("Generated automatically on");
    expect(runtime.sheets.ADOPTION_HISTORY.data[0]).toEqual([
      "Service Date", "Generated At", "Run Mode", "Snapshot Time", "Overall Expected", "Overall Checked",
      "Overall Missing", "Overall Adoption", "SITE_A Expected", "SITE_A Checked", "SITE_A Missing", "SITE_A Adoption",
      "SITE_A Missing Drivers", "SITE_A Unmatched Names", "SITE_A Extra Mentor Drivers", "SITE_B Expected",
      "SITE_B Checked", "SITE_B Missing", "SITE_B Adoption", "SITE_B Missing Drivers", "SITE_B Unmatched Names",
      "SITE_B Extra Mentor Drivers",
    ]);
    expect(firstRecord).toMatchObject({
      0: serviceDate,
      2: "production",
      3: "18:00 Etc/UTC",
      4: 3,
      5: 1,
      6: 2,
      7: 1 / 3,
      12: JSON.stringify(["Bob Missing"]),
      14: JSON.stringify([]),
    });
  });

  it("sorts missing names in email output and applies configured skipped weekdays", () => {
    const runtime = buildRuntime();
    const html = runtime.context.buildAdoptionEmailHtml_({
      generatedAt: "2026-07-31T16:00:00.000Z",
      serviceDate: "2026-07-31",
      sites: {
        SITE_A: { expectedDrivers: 2, driversWithCheck: 0, missingDrivers: ["Zeta Driver", "Alpha Driver"], adoptionRate: 0 },
        SITE_B: { expectedDrivers: 0, driversWithCheck: 0, missingDrivers: [], adoptionRate: 0 },
      },
    });

    expect(html.indexOf("Alpha Driver")).toBeLessThan(html.indexOf("Zeta Driver"));
    expect(runtime.context.isSkippedServiceDate_("2026-08-02")).toBe(true);
    expect(runtime.context.isSkippedServiceDate_("2026-08-03")).toBe(false);

  });

  it("sends test-mode email as an independent one-recipient GmailApp submission and records the attempt", () => {
    const runtime = buildRuntime();
    const serviceDate = berlinToday();
    postAdoption(runtime, [["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"]], "production");

    const summary = JSON.parse(postAction(runtime, {
      action: "email.test.sendPerRecipient",
      serviceDate,
    }).text);

    expect(runtime.gmailAppCalls).toHaveLength(1);
    expect(runtime.gmailAppCalls.map((call) => call.to)).toEqual([
      "test-recipient@example.com",
    ]);
    expect(runtime.gmailAppCalls.every((call) => !String(call.to).includes("<"))).toBe(true);
    expect(runtime.gmailAppCalls.every((call) => !String(call.to).includes(","))).toBe(true);
    expect(summary.emailSubmission).toMatchObject({
      action: "EMAIL_PER_RECIPIENT_SUBMISSION_COMPLETE",
      failures: [],
    });
    expect(summary.emailSubmission.recipients).toHaveLength(1);
    expect(summary.emailDelivery).toHaveLength(1);
    expect(runtime.sheets.ADOPTION_EMAIL_DELIVERY.data[0]).toEqual([
      "Service Date",
      "Recipient Name",
      "Recipient Email",
      "Attempted At",
      "GmailApp Call Result",
      "Remaining Quota After Send",
      "Status",
      "Run Mode",
      "Subject",
      "Error Message",
    ]);
    expect(runtime.sheets.ADOPTION_EMAIL_DELIVERY.data.slice(1).map((row) => [row[2], row[4], row[5], row[6], row[7]])).toEqual([
      ["test-recipient@example.com", "success", "", "submitted", "test"],
    ]);
  });

  it("returns the official history snapshot and email body for retries", () => {
    const runtime = buildRuntime();
    const serviceDate = berlinToday();
    postAdoption(runtime, [["Ada", "Lovelace", "", "", "", "", "", "", false, "", "", "SITE_A"]], "production");

    const snapshot = JSON.parse(postAction(runtime, {
      action: "adoption.snapshot.get",
      serviceDate,
    }).text);

    expect(snapshot.serviceDate).toBe(serviceDate);
    expect(snapshot.history).toMatchObject({ reusedExistingSnapshot: true });
    expect(snapshot.email.subject).toBe(`eMentor Daily Adoption Report — ${serviceDate}`);
    expect(snapshot.email.htmlBody).toContain("eMentor Daily Adoption Report");
    expect(snapshot.sites.SITE_A.expectedDrivers).toBe(2);
  });

  it("fails before replacing Adoption_Check when today's EXPECTED_DRIVERS are missing", () => {
    const runtime = buildRuntime({ emailEnabled: true, expectedDate: "2000-01-01" });
    const before = runtime.sheets.Adoption_Check.data.map((row) => [...row]);
    const serviceDate = berlinToday();
    const rows = [["Ada", "Lovelace"]];
    const runMode = "production";
    const signedBody = JSON.stringify({ serviceDate, runMode, rows });
    const signature = createHmac("sha256", runtime.secret)
      .update(Buffer.from(signedBody, "utf8").toString("base64"))
      .digest("hex");

    const response = runtime.context.doPost({
      postData: { contents: JSON.stringify({ serviceDate, runMode, rows, signature }) },
    });

    expect(JSON.parse(response.text).error).toContain("EXPECTED_DRIVERS does not contain today's date");
    expect(runtime.sheets.Adoption_Check.data).toEqual(before);
    expect(runtime.sheets.ADOPTION_HISTORY).toBeUndefined();
  });
});
