import { describe, expect, it } from "vitest";

import {
  buildAdoptionEmail,
  buildAdoptionEmailHtml,
  mapShiftRowsToAdoptionImport,
  parseRunModeArg,
  reportingDateTime,
  runMentorAdoptionWorker,
  serviceDayBoundsMs,
  signAdoptionPayload,
} from "../../scripts/mentor-adoption-worker.mjs";

describe("Mentor D0 adoption worker", () => {
  it("defaults CLI runs to manual and accepts explicit test or production modes", () => {
    expect(parseRunModeArg([])).toBe("manual");
    expect(parseRunModeArg(["--run-mode=test"])).toBe("test");
    expect(parseRunModeArg(["--run-mode=production"])).toBe("production");
    expect(() => parseRunModeArg(["--run-mode=invalid"])).toThrow("runMode must be test, manual or production");
  });

  it("uses the configured reporting timezone date in summer and winter", () => {
    expect(reportingDateTime(new Date("2026-07-31T16:15:00.000Z"), "Europe/Berlin")).toMatchObject({
      hour: 18,
      minute: 15,
      serviceDate: "2026-07-31",
    });
    expect(reportingDateTime(new Date("2026-07-31T20:30:00.000Z"), "Europe/Berlin")).toMatchObject({
      hour: 22,
      minute: 30,
      serviceDate: "2026-07-31",
    });
    expect(reportingDateTime(new Date("2026-01-15T21:30:00.000Z"), "Europe/Berlin")).toMatchObject({
      hour: 22,
      minute: 30,
      serviceDate: "2026-01-15",
    });
  });

  it("creates Berlin-local day bounds for the Mentor Shift Report request", () => {
    const bounds = serviceDayBoundsMs("2026-07-31");
    expect(new Date(bounds.startTime).toISOString()).toBe("2026-07-30T22:00:00.000Z");
    expect(new Date(bounds.endTime).toISOString()).toBe("2026-07-31T21:59:59.000Z");
  });

  it("skips scheduled production execution on configured weekdays", async () => {
    await expect(
      runMentorAdoptionWorker({
        now: new Date("2026-08-02T18:00:00.000Z"),
        runMode: "production",
      }),
    ).resolves.toMatchObject({
      action: "SKIPPED_CONFIGURED_WEEKDAY",
      reportingTime: "2026-08-02T20:00:00[Europe/Berlin]",
    });
  });

  it("maps the live Shift Report fields into Adoption_Check A:L", () => {
    expect(
      mapShiftRowsToAdoptionImport([
        {
          device: "Phone",
          distanceKms: "42.5",
          duration: "08:10",
          firstName: "Ada",
          lastName: "Lovelace",
          location1: "SITE_B",
          shiftEndTime: "18:00",
          shiftStartTime: 12345,
          shortTrip: false,
          trip: "7",
          vehicleIdentifier: "VIN-1",
          vrmStatus: "Supported",
        },
      ]),
    ).toEqual([
      ["Ada", "Lovelace", "VIN-1", 12345, "18:00", "08:10", "42.5", "7", false, "Phone", "Supported", "SITE_B"],
    ]);
  });

  it("formats the adoption email with a weighted overall summary", () => {
    const email = buildAdoptionEmail({
      serviceDate: "2026-07-31",
      sites: {
        SITE_A: {
          expectedDrivers: 32,
          driversWithCheck: 27,
          missingDrivers: ["Driver One"],
          adoptionRate: 0.84375,
        },
        SITE_B: {
          expectedDrivers: 45,
          driversWithCheck: 29,
          missingDrivers: ["Zeta Driver", "Alpha Driver"],
          adoptionRate: 0.644444,
        },
      },
    });

    expect(email).toContain("OVERALL\n- Expected Drivers: 77");
    expect(email).toContain("- Drivers with eMentor Check: 56");
    expect(email).toContain("- Missing Drivers: 21");
    expect(email).toContain("- Overall Adoption Rate: 72.7%");
    expect(email).toContain("SITE_A\n- Expected Drivers: 32");
    expect(email).toContain("- Adoption Rate: 84.4%");
    expect(email).toContain("Drivers without eMentor Check:\n- Driver One");
    expect(email).toContain("SITE_B\n- Expected Drivers: 45");
    expect(email).toContain("- Adoption Rate: 64.4%");
    expect(email).toContain("- Alpha Driver\n- Zeta Driver");
    expect(email).toContain("should be verified by the dispatcher before taking action.");
  });

  it("shows an explicit empty missing-driver list", () => {
    const email = buildAdoptionEmail({
      serviceDate: "2026-07-31",
      sites: {
        SITE_A: { expectedDrivers: 0, driversWithCheck: 0, missingDrivers: [], adoptionRate: 0 },
        SITE_B: { expectedDrivers: 1, driversWithCheck: 1, missingDrivers: [], adoptionRate: 1 },
      },
    });

    expect(email.match(/Drivers without eMentor Check:\n- None/g)).toHaveLength(2);
    expect(email).toContain("- Overall Adoption Rate: 100.0%");
  });

  it("formats a professional HTML email with overall, site, and notes sections", () => {
    const html = buildAdoptionEmailHtml({
      generatedAt: "2026-07-31T20:30:00.000Z",
      serviceDate: "2026-07-31",
      sites: {
        SITE_A: {
          expectedDrivers: 32,
          driversWithCheck: 27,
          missingDrivers: ["Zeta Driver", "Driver <One>", "Alpha Driver"],
          adoptionRate: 0.84375,
        },
        SITE_B: {
          expectedDrivers: 45,
          driversWithCheck: 29,
          missingDrivers: [],
          adoptionRate: 0.644444,
        },
      },
    });

    expect(html).toContain("<h1");
    expect(html.indexOf(">OVERALL</h2>")).toBeLessThan(html.indexOf(">SITE_A</h2>"));
    expect(html.indexOf(">SITE_A</h2>")).toBeLessThan(html.indexOf(">SITE_B</h2>"));
    expect(html).toContain("<strong>2026-07-31</strong>");
    expect(html).toContain("56 of 77 expected drivers completed their eMentor Check today (72.7% overall adoption).");
    expect(html).toContain(">77</div>");
    expect(html).toContain(">56</div>");
    expect(html).toContain(">21</div>");
    expect(html).toContain(">72.7%</div>");
    expect(html).toContain("Driver &lt;One&gt;");
    expect(html.indexOf("Alpha Driver")).toBeLessThan(html.indexOf("Driver &lt;One&gt;"));
    expect(html.indexOf("Driver &lt;One&gt;")).toBeLessThan(html.indexOf("Zeta Driver"));
    expect(html).toContain("color:#6b7280");
    expect(html).toContain("color:#2474c6");
    expect(html).toContain("color:#2e7d32");
    expect(html).toContain("31 Jul 2026, 22:30 Europe/Berlin");
    expect(html).toContain(">Notes</h2>");
    expect(html.match(/<hr /g)).toHaveLength(3);
  });

  it("downloads D0, signs the payload, and prints the Apps Script summary", async () => {
    const previousUrl = process.env.ADOPTION_WEB_APP_URL;
    const previousSecret = process.env.ADOPTION_SHARED_SECRET;
    process.env.ADOPTION_WEB_APP_URL = "https://example.test/adoption";
    process.env.ADOPTION_SHARED_SECRET = "test-shared-secret";

    let mentorRequest: unknown;
    let postedBody: { serviceDate: string; runMode: string; snapshotType: string; rows: unknown[]; signature: string };
    const summary = {
      generatedAt: "2026-07-31T20:30:05.000Z",
      runMode: "manual",
      serviceDate: "2026-07-31",
      snapshotType: "final",
      snapshotTime: "22:30 Europe/Berlin",
      sites: {
        SITE_A: { expectedDrivers: 1, driversWithCheck: 1 },
        SITE_B: { expectedDrivers: 1, driversWithCheck: 0 },
      },
    };

    try {
      const result = await runMentorAdoptionWorker({
        now: new Date("2026-07-31T20:30:00.000Z"),
        mentorClient: {
          async fetchDailyShiftReport(request: unknown) {
            mentorRequest = request;
            return {
              data: [
                { firstName: "Ada", lastName: "Lovelace", location1: "SITE_A" },
                { firstName: "Ada", lastName: "Lovelace", location1: "SITE_A" },
              ],
            };
          },
        },
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          postedBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify(summary), {
            headers: { "content-type": "application/json" },
            status: 200,
          });
        },
      });

      expect(mentorRequest).toMatchObject({
        decorate: "yes",
        localDate: "2026-07-31",
      });
      expect(postedBody.rows).toHaveLength(2);
      expect(postedBody.runMode).toBe("manual");
      expect(postedBody.snapshotType).toBe("final");
      expect(postedBody.signature).toBe(
        signAdoptionPayload(
          JSON.stringify({ serviceDate: postedBody.serviceDate, runMode: "manual", snapshotType: "final", rows: postedBody.rows }),
          "test-shared-secret",
        ),
      );
      expect(result).toEqual(summary);
    } finally {
      if (previousUrl === undefined) delete process.env.ADOPTION_WEB_APP_URL;
      else process.env.ADOPTION_WEB_APP_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.ADOPTION_SHARED_SECRET;
      else process.env.ADOPTION_SHARED_SECRET = previousSecret;
    }
  });

  it("accepts legacy production env names and station-shaped Apps Script summaries", async () => {
    const previousUrl = process.env.ADOPTION_WEB_APP_URL;
    const previousSecret = process.env.ADOPTION_SHARED_SECRET;
    const previousLegacyUrl = process.env.EMENTOR_ADOPTION_WEB_APP_URL;
    const previousLegacySecret = process.env.EMENTOR_ADOPTION_SHARED_SECRET;
    delete process.env.ADOPTION_WEB_APP_URL;
    delete process.env.ADOPTION_SHARED_SECRET;
    process.env.EMENTOR_ADOPTION_WEB_APP_URL = "https://example.test/adoption";
    process.env.EMENTOR_ADOPTION_SHARED_SECRET = "legacy-test-shared-secret";

    const summary = {
      generatedAt: "2026-07-31T20:30:05.000Z",
      runMode: "manual",
      serviceDate: "2026-07-31",
      snapshotType: "final",
      snapshotTime: "22:30 Europe/Berlin",
      stations: {
        STATION_A: { expectedDrivers: 1, driversWithCheck: 1 },
        STATION_B: { expectedDrivers: 1, driversWithCheck: 0 },
      },
    };

    try {
      const result = await runMentorAdoptionWorker({
        now: new Date("2026-07-31T20:30:00.000Z"),
        mentorClient: {
          async fetchDailyShiftReport() {
            return { data: [{ firstName: "Ada", lastName: "Lovelace", location1: "STATION_A" }] };
          },
        },
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          const postedBody = JSON.parse(String(init?.body));
          expect(postedBody.signature).toBe(
            signAdoptionPayload(
              JSON.stringify({ serviceDate: postedBody.serviceDate, runMode: "manual", snapshotType: "final", rows: postedBody.rows }),
              "legacy-test-shared-secret",
            ),
          );
          return new Response(JSON.stringify(summary), { status: 200 });
        },
      });

      expect(result).toEqual(summary);
    } finally {
      if (previousUrl === undefined) delete process.env.ADOPTION_WEB_APP_URL;
      else process.env.ADOPTION_WEB_APP_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.ADOPTION_SHARED_SECRET;
      else process.env.ADOPTION_SHARED_SECRET = previousSecret;
      if (previousLegacyUrl === undefined) delete process.env.EMENTOR_ADOPTION_WEB_APP_URL;
      else process.env.EMENTOR_ADOPTION_WEB_APP_URL = previousLegacyUrl;
      if (previousLegacySecret === undefined) delete process.env.EMENTOR_ADOPTION_SHARED_SECRET;
      else process.env.EMENTOR_ADOPTION_SHARED_SECRET = previousLegacySecret;
    }
  });

  it("runs the operational snapshot at 18:15 Berlin without treating it as the final history snapshot", async () => {
    const previousUrl = process.env.ADOPTION_WEB_APP_URL;
    const previousSecret = process.env.ADOPTION_SHARED_SECRET;
    process.env.ADOPTION_WEB_APP_URL = "https://example.test/adoption";
    process.env.ADOPTION_SHARED_SECRET = "test-shared-secret";

    let postedBody: { serviceDate: string; runMode: string; snapshotType: string; rows: unknown[]; signature: string };
    const summary = {
      emailSubmission: {
        action: "EMAIL_PER_RECIPIENT_SUBMISSION_COMPLETE",
        failures: [],
        recipients: [],
      },
      generatedAt: "2026-07-31T16:15:05.000Z",
      history: { snapshotCreated: false },
      runMode: "production",
      serviceDate: "2026-07-31",
      snapshotType: "operational",
      snapshotTime: "18:15 Europe/Berlin",
      sites: {
        SITE_A: { expectedDrivers: 1, driversWithCheck: 1 },
        SITE_B: { expectedDrivers: 1, driversWithCheck: 0 },
      },
    };

    try {
      const result = await runMentorAdoptionWorker({
        now: new Date("2026-07-31T16:15:00.000Z"),
        runMode: "production",
        mentorClient: {
          async fetchDailyShiftReport() {
            return { data: [{ firstName: "Ada", lastName: "Lovelace", location1: "SITE_A" }] };
          },
        },
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          postedBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify(summary), { status: 200 });
        },
      });

      expect(postedBody.runMode).toBe("production");
      expect(postedBody.snapshotType).toBe("operational");
      expect(result).toEqual(summary);
      expect(result.history.snapshotCreated).toBe(false);
    } finally {
      if (previousUrl === undefined) delete process.env.ADOPTION_WEB_APP_URL;
      else process.env.ADOPTION_WEB_APP_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.ADOPTION_SHARED_SECRET;
      else process.env.ADOPTION_SHARED_SECRET = previousSecret;
    }
  });

  it("does not add a separate Railway email provider step to production results", async () => {
    const previousUrl = process.env.ADOPTION_WEB_APP_URL;
    const previousSecret = process.env.ADOPTION_SHARED_SECRET;
    process.env.ADOPTION_WEB_APP_URL = "https://example.test/adoption";
    process.env.ADOPTION_SHARED_SECRET = "test-shared-secret";

    const summary = {
      emailSubmission: {
        action: "EMAIL_SKIPPED_DISABLED",
        recipients: [],
      },
      email: {
        htmlBody: "<p>html</p>",
        recipients: [{ name: "Operations Lead", email: "ops-lead@example.com" }],
        subject: "eMentor Final Daily Report — 2026-07-31 — 22:30",
        textBody: "text",
      },
      generatedAt: "2026-07-31T20:30:05.000Z",
      history: { snapshotCreated: true },
      runMode: "production",
      serviceDate: "2026-07-31",
      snapshotType: "final",
      snapshotTime: "22:30 Europe/Berlin",
      sites: {
        SITE_A: { expectedDrivers: 1, driversWithCheck: 1 },
        SITE_B: { expectedDrivers: 1, driversWithCheck: 0 },
      },
    };

    try {
      const result = await runMentorAdoptionWorker({
        now: new Date("2026-07-31T20:30:00.000Z"),
        runMode: "production",
        mentorClient: {
          async fetchDailyShiftReport() {
            return { data: [{ firstName: "Ada", lastName: "Lovelace", location1: "SITE_A" }] };
          },
        },
        fetchImpl: async (_url: string | URL | Request, init?: RequestInit) => {
          const postedBody = JSON.parse(String(init?.body));
          expect(postedBody.runMode).toBe("production");
          expect(postedBody.snapshotType).toBe("final");
          return new Response(JSON.stringify(summary), { status: 200 });
        },
      });

      expect(result).toEqual(summary);
      expect(result.emailDeliveryResult).toBeUndefined();
    } finally {
      if (previousUrl === undefined) delete process.env.ADOPTION_WEB_APP_URL;
      else process.env.ADOPTION_WEB_APP_URL = previousUrl;
      if (previousSecret === undefined) delete process.env.ADOPTION_SHARED_SECRET;
      else process.env.ADOPTION_SHARED_SECRET = previousSecret;
    }
  });
});
