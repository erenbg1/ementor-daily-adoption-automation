import { describe, expect, it } from "vitest";

import type { MentorComparisonRawRecord } from "../../src/lib/mentor";
import { resolveMentorComparisonRecords } from "../../src/lib/mentor/comparison-resolution";
import type {
  MentorIdentityDictionaryEntry,
  MentorIdentityLearningEvent,
  MentorIdentityRepository,
} from "../../src/lib/mentor/identity-dictionary";

function comparison(overrides: Partial<MentorComparisonRawRecord> = {}): MentorComparisonRawRecord {
  return {
    distanceKms: "31.75",
    firstName: "first-hash-1",
    lastName: "last-hash-1",
    overallScore: 800,
    station: "STATION_B",
    totalTripCount: "1",
    ...overrides,
  };
}

function dictionaryEntry(overrides: Partial<MentorIdentityDictionaryEntry> = {}): MentorIdentityDictionaryEntry {
  return {
    confirmationCount: 7,
    firstHash: "first-hash-1",
    firstSeenOperationalDate: new Date("2026-05-12T00:00:00.000Z"),
    id: "identity-1",
    lastHash: "last-hash-1",
    lastSeenOperationalDate: new Date("2026-07-20T00:00:00.000Z"),
    learnedFromOperationalDate: new Date("2026-05-12T00:00:00.000Z"),
    primaryStation: "STATION_B",
    resolvedFirstName: "Ada",
    resolvedLastName: "Lovelace",
    status: "ACTIVE",
    ...overrides,
  };
}

class FakeIdentityRepository implements MentorIdentityRepository {
  constructor(
    private readonly entries: MentorIdentityDictionaryEntry[] = [],
    private readonly conflicts: Array<[string, string]> = [],
  ) {}

  async findByHashes(firstHash: string, lastHash: string) {
    return this.entries.find((entry) => entry.firstHash === firstHash && entry.lastHash === lastHash) ?? null;
  }

  async hasPendingConflict(firstHash: string, lastHash: string) {
    return this.conflicts.some(([conflictFirstHash, conflictLastHash]) => conflictFirstHash === firstHash && conflictLastHash === lastHash);
  }

  async createDictionaryEntry() {
    throw new Error("Not used by Comparison-only resolution.");
  }

  async createLearningEvent(): Promise<MentorIdentityLearningEvent> {
    throw new Error("Not used by Comparison-only resolution.");
  }

  async incrementConfirmation() {
    throw new Error("Not used by Comparison-only resolution.");
  }
}

describe("Mentor Comparison identity resolution", () => {
  it("resolves a Comparison row from the identity dictionary without Shift", async () => {
    const result = await resolveMentorComparisonRecords([comparison()], new FakeIdentityRepository([dictionaryEntry()]));

    expect(result.summary).toEqual({
      comparisonRows: 1,
      conflictBlocked: 0,
      resolutionRate: 1,
      resolvedByDictionary: 1,
      unresolved: 0,
    });
    expect(result.rows[0]).toMatchObject({
      distanceKms: "31.75",
      dictionary_confirmation_count: 7,
      learned_date: "2026-05-12",
      primary_station: "STATION_B",
      resolution_status: "RESOLVED",
      resolved_first_name: "Ada",
      resolved_last_name: "Lovelace",
    });
  });

  it("marks unknown hashes as unresolved", async () => {
    const result = await resolveMentorComparisonRecords([comparison()], new FakeIdentityRepository());

    expect(result.summary).toMatchObject({
      comparisonRows: 1,
      resolvedByDictionary: 0,
      unresolved: 1,
    });
    expect(result.rows[0]).toMatchObject({
      resolution_status: "UNRESOLVED",
      resolved_first_name: null,
      resolved_last_name: null,
    });
  });

  it("blocks resolution when the hash pair has a pending conflict", async () => {
    const result = await resolveMentorComparisonRecords(
      [comparison()],
      new FakeIdentityRepository([dictionaryEntry()], [["first-hash-1", "last-hash-1"]]),
    );

    expect(result.summary).toEqual({
      comparisonRows: 1,
      conflictBlocked: 1,
      resolutionRate: 0,
      resolvedByDictionary: 0,
      unresolved: 0,
    });
    expect(result.rows[0]).toMatchObject({
      dictionary_confirmation_count: 7,
      resolution_status: "CONFLICT",
      resolved_first_name: null,
      resolved_last_name: null,
    });
  });
});
