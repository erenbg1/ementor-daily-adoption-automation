import { describe, expect, it } from "vitest";

import { buildMentorLogHistoryRows } from "../../src/lib/mentor/log-history";
import type { ResolvedMentorComparisonRecord } from "../../src/lib/mentor";

function resolvedComparison(overrides: Partial<ResolvedMentorComparisonRecord> = {}): ResolvedMentorComparisonRecord {
  return {
    AGGridId: 7,
    dictionary_confirmation_count: 12,
    distanceKms: "31.75",
    firstName: "first-hash",
    lastName: "last-hash",
    learned_date: "2026-05-12",
    overallScore: 800,
    primary_station: "STATION_B",
    resolution_status: "RESOLVED",
    resolved_first_name: "Ada",
    resolved_last_name: "Lovelace",
    station: "STATION_B",
    totalTripCount: "4",
    ...overrides,
  };
}

describe("Mentor Log_History row builder", () => {
  it("converts resolved Comparison rows into appendable Log_History rows", () => {
    const rows = buildMentorLogHistoryRows([resolvedComparison()], { operationalDate: "2026-07-20" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      dictionaryConfirmationCount: 12,
      distanceKms: 31.75,
      safetyScore: 800,
      firstHash: "first-hash",
      lastHash: "last-hash",
      learnedDate: new Date("2026-05-12T00:00:00.000Z"),
      operationalDate: new Date("2026-07-20T00:00:00.000Z"),
      primaryStation: "STATION_B",
      resolutionStatus: "RESOLVED",
      resolvedFirstName: "Ada",
      resolvedLastName: "Lovelace",
      sourceRecordRef: "comparison:ag-grid:7",
      sourceRowIndex: 0,
      station: "STATION_B",
      totalTripCount: 4,
    });
    expect(rows[0].rawComparison).toMatchObject({
      resolved_first_name: "Ada",
      resolved_last_name: "Lovelace",
      resolution_status: "RESOLVED",
    });
  });

  it("preserves unresolved rows with null identity fields", () => {
    const rows = buildMentorLogHistoryRows(
      [
        resolvedComparison({
          dictionary_confirmation_count: null,
          learned_date: null,
          primary_station: null,
          resolution_status: "UNRESOLVED",
          resolved_first_name: null,
          resolved_last_name: null,
        }),
      ],
      { operationalDate: "2026-07-20" },
    );

    expect(rows[0]).toMatchObject({
      dictionaryConfirmationCount: null,
      learnedDate: null,
      primaryStation: null,
      resolutionStatus: "UNRESOLVED",
      resolvedFirstName: null,
      resolvedLastName: null,
    });
  });
});
