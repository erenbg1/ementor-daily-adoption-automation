import { describe, expect, it } from "vitest";

import {
  generateMentorDailyMatchingReport,
  matchMentorDailyRecords,
  normalizeMentorDistanceKm,
  normalizeMentorSite,
  parseMentorNumber,
  type MentorComparisonRawRecord,
  type MentorShiftRawRecord,
} from "../../src/lib/mentor/daily-matching";

function comparison(overrides: Partial<MentorComparisonRawRecord> = {}): MentorComparisonRawRecord {
  return {
    cdbId: "cdb-1",
    distanceKms: "42.50",
    operationalDay: "2026-07-20",
    recordRef: "comparison-1",
    site: "SITE_B",
    totalTripCount: "7",
    ...overrides,
  };
}

function shift(overrides: Partial<MentorShiftRawRecord> = {}): MentorShiftRawRecord {
  return {
    distanceKms: "42.50",
    driverId: 1001,
    localDate: "2026-07-20",
    location1: "SITE_B",
    recordRef: "shift-1",
    trip: "7",
    ...overrides,
  };
}

describe("Mentor Daily Matching Engine", () => {
  it("matches one Comparison record to one Shift record by operational day, KM, and site", () => {
    const result = matchMentorDailyRecords([comparison()], [shift()]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      category: "MATCHED",
      comparisonRecordRef: "comparison-1",
      confidenceScore: 1,
      matchedDistanceKm: 42.5,
      matchReason: "EXACT_DISTANCE_AND_STATION",
      shiftRecordRef: "shift-1",
      siteValidationResult: "MATCH",
    });
    expect(result.statistics).toMatchObject({
      comparisonRows: 1,
      matchedPairs: 1,
      shiftRows: 1,
      unmatchedComparisonRows: 0,
      unmatchedShiftRows: 0,
      zeroGuessedMatches: true,
    });
  });

  it("matches KM rounding differences within tolerance", () => {
    const result = matchMentorDailyRecords(
      [comparison({ distanceKms: "42.500" })],
      [shift({ distanceKms: "42.504" })],
      { distanceToleranceKm: 0.01 },
    );

    expect(result.matches[0]).toMatchObject({
      category: "MATCHED",
      confidenceScore: 0.95,
      matchReason: "TOLERANCE_DISTANCE_AND_STATION",
    });
    expect(result.matches[0].distanceDifferenceKm).toBeCloseTo(0.004);
  });

  it("marks a unique distance match with site mismatch as ambiguous instead of guessing", () => {
    const result = matchMentorDailyRecords([comparison({ site: "SITE_A" })], [shift({ location1: "SITE_B" })]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      category: "AMBIGUOUS",
      comparisonRecordRefs: ["comparison-1"],
      matchReason: "STATION_MISMATCH",
      shiftRecordRefs: ["shift-1"],
      siteValidationResult: "MISMATCH",
    });
    expect(result.statistics).toMatchObject({
      ambiguousComparisonRows: 1,
      ambiguousGroups: 1,
      ambiguousShiftRows: 1,
      matchedPairs: 0,
    });
  });

  it("uses site as secondary validation to resolve duplicate KM candidates across sites", () => {
    const result = matchMentorDailyRecords(
      [
        comparison({ recordRef: "comparison-siteA", site: "SITE_A" }),
        comparison({ cdbId: "cdb-2", recordRef: "comparison-siteB", site: "SITE_B" }),
      ],
      [
        shift({ driverId: 2002, location1: "SITE_B", recordRef: "shift-siteB" }),
        shift({ driverId: 2001, location1: "SITE_A", recordRef: "shift-siteA" }),
      ],
    );

    expect(result.matches).toHaveLength(2);
    expect(result.matches.every((match) => match.category === "MATCHED")).toBe(true);
    expect(result.matches.map((match) => [match.comparisonRecordRef, match.shiftRecordRef])).toEqual([
      ["comparison-siteA", "shift-siteA"],
      ["comparison-siteB", "shift-siteB"],
    ]);
  });

  it("marks unresolved duplicate KM candidates as ambiguous", () => {
    const result = matchMentorDailyRecords(
      [
        comparison({ recordRef: "comparison-a", site: "SITE_B" }),
        comparison({ cdbId: "cdb-2", recordRef: "comparison-b", site: "SITE_B" }),
      ],
      [shift({ recordRef: "shift-a", location1: "SITE_B" })],
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      category: "AMBIGUOUS",
      comparisonRecordRefs: ["comparison-a", "comparison-b"],
      matchReason: "DUPLICATE_DISTANCE_CANDIDATES",
      shiftRecordRefs: ["shift-a"],
    });
  });

  it("reports a missing shift as UNMATCHED_COMPARISON", () => {
    const result = matchMentorDailyRecords([comparison()], []);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      category: "UNMATCHED_COMPARISON",
      comparisonRecordRef: "comparison-1",
      matchReason: "NO_SHIFT_FOR_COMPARISON",
    });
    expect(result.statistics.unmatchedComparisonRows).toBe(1);
  });

  it("reports a missing comparison as UNMATCHED_SHIFT", () => {
    const result = matchMentorDailyRecords([], [shift()]);

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]).toMatchObject({
      category: "UNMATCHED_SHIFT",
      matchReason: "NO_COMPARISON_FOR_SHIFT",
      shiftRecordRef: "shift-1",
    });
    expect(result.statistics.unmatchedShiftRows).toBe(1);
  });

  it("handles normalization edge cases deterministically", () => {
    expect(normalizeMentorSite("  site-b / metro  ")).toBe("SITE B METRO");
    expect(parseMentorNumber("1.234,56 km")).toBe(1234.56);
    expect(parseMentorNumber("1,234.56 km")).toBe(1234.56);
    expect(normalizeMentorDistanceKm(" 42,500 km ")).toBe(42.5);
  });

  it("uses the supplied operational day when records do not carry one", () => {
    const result = matchMentorDailyRecords(
      [comparison({ operationalDay: undefined })],
      [shift({ localDate: undefined, shiftStartTime: undefined })],
      { operationalDay: "2026-07-20" },
    );

    expect(result.matches[0].category).toBe("MATCHED");
    expect(result.matches[0].operationalDay).toBe("2026-07-20");
  });

  it("generates a human-readable dry-run report", () => {
    const result = matchMentorDailyRecords(
      [comparison({ recordRef: "comparison-1" }), comparison({ cdbId: "cdb-2", distanceKms: "99", recordRef: "comparison-2" })],
      [shift({ recordRef: "shift-1" })],
    );

    expect(generateMentorDailyMatchingReport(result)).toContain("Comparison rows: 2");
    expect(generateMentorDailyMatchingReport(result)).toContain("Shift rows: 1");
    expect(generateMentorDailyMatchingReport(result)).toContain("Matched: 1");
    expect(generateMentorDailyMatchingReport(result)).toContain("Comparison unmatched: 1");
    expect(generateMentorDailyMatchingReport(result)).toContain("Guessed matches: 0");
  });
});
