import { describe, expect, it } from "vitest";

import { matchMentorDailyRecords, type MentorComparisonRawRecord, type MentorShiftRawRecord } from "../../src/lib/mentor";
import {
  buildMentorIdentityLearningObservations,
  simulateMentorIdentityLearning,
  type MentorIdentityLearningObservation,
} from "../../src/lib/mentor/identity-dictionary";

function observation(overrides: Partial<MentorIdentityLearningObservation> = {}): MentorIdentityLearningObservation {
  return {
    comparisonRecordRef: "comparison-1",
    distanceKm: 42.5,
    firstHash: "first-hash-1",
    lastHash: "last-hash-1",
    matchConfidence: 1,
    matchReason: "EXACT_DISTANCE_AND_STATION",
    operationalDate: "2026-07-20",
    resolvedFirstName: "Ada",
    resolvedLastName: "Lovelace",
    shiftRecordRef: "shift-1",
    site: "SITE_B",
    ...overrides,
  };
}

describe("Mentor identity dictionary learning", () => {
  it("inserts a new dictionary mapping and LEARNED event", async () => {
    const result = await simulateMentorIdentityLearning([observation()]);

    expect(result.summary).toMatchObject({
      confirmed: 0,
      conflicts: 0,
      finalDictionarySize: 1,
      learned: 1,
      totalObservations: 1,
    });
    expect(result.results[0]).toMatchObject({
      action: "learned",
      dictionaryEntry: {
        confirmationCount: 1,
        firstHash: "first-hash-1",
        lastHash: "last-hash-1",
        resolvedFirstName: "Ada",
        resolvedLastName: "Lovelace",
      },
      event: {
        eventType: "LEARNED",
        reviewStatus: "NONE",
      },
    });
  });

  it("confirms the same mapping and increments confirmation count", async () => {
    const result = await simulateMentorIdentityLearning([
      observation({ operationalDate: "2026-07-20" }),
      observation({ operationalDate: "2026-07-21" }),
    ]);

    expect(result.summary).toMatchObject({
      confirmed: 1,
      conflicts: 0,
      finalDictionarySize: 1,
      learned: 1,
    });
    expect(result.results[1]).toMatchObject({
      action: "confirmed",
      dictionaryEntry: {
        confirmationCount: 2,
        resolvedFirstName: "Ada",
        resolvedLastName: "Lovelace",
      },
      event: {
        eventType: "CONFIRMED",
        existingFirstName: "Ada",
        existingLastName: "Lovelace",
        reviewStatus: "NONE",
      },
    });
  });

  it("quarantines a conflicting mapping without overwriting the dictionary", async () => {
    const result = await simulateMentorIdentityLearning([
      observation({ resolvedFirstName: "Ada", resolvedLastName: "Lovelace" }),
      observation({ resolvedFirstName: "Grace", resolvedLastName: "Hopper" }),
    ]);

    expect(result.summary).toMatchObject({
      confirmed: 0,
      conflicts: 1,
      finalDictionarySize: 1,
      learned: 1,
    });
    expect(result.results[1]).toMatchObject({
      action: "conflict",
      dictionaryEntry: {
        confirmationCount: 1,
        resolvedFirstName: "Ada",
        resolvedLastName: "Lovelace",
      },
      event: {
        eventType: "CONFLICT",
        existingFirstName: "Ada",
        existingLastName: "Lovelace",
        observedFirstName: "Grace",
        observedLastName: "Hopper",
        reviewStatus: "PENDING_REVIEW",
      },
    });
  });

  it("extracts learning observations from deterministic Mentor daily matching output", () => {
    const comparisonRecords: MentorComparisonRawRecord[] = [
      {
        distanceKms: "42.50",
        firstName: "first-hash-1",
        lastName: "last-hash-1",
        operationalDay: "2026-07-20",
        recordRef: "comparison-1",
        site: "SITE_B",
      },
    ];
    const shiftRecords: MentorShiftRawRecord[] = [
      {
        distanceKms: "42.50",
        firstName: "Ada",
        lastName: "Lovelace",
        localDate: "2026-07-20",
        location1: "SITE_B",
        recordRef: "shift-1",
      },
    ];
    const matchingResult = matchMentorDailyRecords(comparisonRecords, shiftRecords);

    expect(
      buildMentorIdentityLearningObservations({
        comparisonRecords,
        matchingResult,
        operationalDate: "2026-07-20",
        shiftRecords,
      }),
    ).toEqual([
      {
        comparisonRecordRef: "comparison-1",
        distanceKm: 42.5,
        firstHash: "first-hash-1",
        lastHash: "last-hash-1",
        matchConfidence: 1,
        matchReason: "EXACT_DISTANCE_AND_STATION",
        operationalDate: "2026-07-20",
        resolvedFirstName: "Ada",
        resolvedLastName: "Lovelace",
        shiftRecordRef: "shift-1",
        site: "SITE_B",
      },
    ]);
  });

  it("dry-runs the existing sanitized 60-day validation profile without live writes", async () => {
    const observations = buildSixtyDayLearningProfile();
    const result = await simulateMentorIdentityLearning(observations);

    expect(result.summary).toEqual({
      confirmed: 3290,
      conflicts: 1,
      finalDictionarySize: 180,
      learned: 180,
      totalObservations: 3471,
    });
  });
});

function buildSixtyDayLearningProfile() {
  const dailyProfile = [
    ["2026-05-12", 53, 53],
    ["2026-05-13", 56, 17],
    ["2026-05-14", 0, 0],
    ["2026-05-15", 54, 5],
    ["2026-05-16", 53, 3],
    ["2026-05-18", 62, 10],
    ["2026-05-19", 56, 2],
    ["2026-05-20", 50, 4],
    ["2026-05-21", 53, 0],
    ["2026-05-22", 43, 3],
    ["2026-05-23", 46, 0],
    ["2026-05-25", 0, 0],
    ["2026-05-26", 58, 4],
    ["2026-05-27", 61, 1],
    ["2026-05-28", 59, 0],
    ["2026-05-29", 57, 1],
    ["2026-05-30", 56, 2],
    ["2026-06-01", 63, 3],
    ["2026-06-02", 59, 4],
    ["2026-06-03", 58, 0],
    ["2026-06-04", 58, 2],
    ["2026-06-05", 48, 0],
    ["2026-06-06", 50, 4],
    ["2026-06-08", 68, 3],
    ["2026-06-09", 66, 1],
    ["2026-06-10", 57, 1],
    ["2026-06-11", 58, 1],
    ["2026-06-12", 53, 1],
    ["2026-06-13", 52, 1],
    ["2026-06-15", 64, 2],
    ["2026-06-16", 52, 2],
    ["2026-06-17", 60, 1],
    ["2026-06-18", 53, 2],
    ["2026-06-19", 48, 1],
    ["2026-06-20", 55, 4],
    ["2026-06-22", 68, 5],
    ["2026-06-23", 71, 3],
    ["2026-06-24", 74, 1],
    ["2026-06-25", 68, 3],
    ["2026-06-26", 57, 0],
    ["2026-06-27", 57, 2],
    ["2026-06-29", 71, 1],
    ["2026-06-30", 65, 1],
    ["2026-07-01", 66, 0],
    ["2026-07-02", 59, 0],
    ["2026-07-03", 81, 5],
    ["2026-07-04", 59, 2],
    ["2026-07-06", 70, 0],
    ["2026-07-07", 61, 2],
    ["2026-07-08", 65, 1],
    ["2026-07-09", 60, 3],
    ["2026-07-10", 58, 1],
    ["2026-07-11", 54, 3],
    ["2026-07-13", 75, 3],
    ["2026-07-14", 67, 4],
    ["2026-07-15", 71, 1],
    ["2026-07-16", 63, 1],
    ["2026-07-17", 65, 0],
    ["2026-07-18", 53, 0],
    ["2026-07-20", 74, 0],
  ] as const;
  const observations: MentorIdentityLearningObservation[] = [];
  const knownIdentities: MentorIdentityLearningObservation[] = [];

  for (const [date, deterministicMatches, newIdentityCount] of dailyProfile) {
    for (let i = 0; i < newIdentityCount; i += 1) {
      const identityNumber = knownIdentities.length + 1;
      const learned = observation({
        firstHash: `first-hash-${identityNumber}`,
        lastHash: `last-hash-${identityNumber}`,
        operationalDate: date,
        resolvedFirstName: `First${identityNumber}`,
        resolvedLastName: `Last${identityNumber}`,
      });
      observations.push(learned);
      knownIdentities.push(learned);
    }

    const confirmations = deterministicMatches - newIdentityCount;
    for (let i = 0; i < confirmations; i += 1) {
      const identity = knownIdentities[i % knownIdentities.length];
      observations.push({ ...identity, operationalDate: date });
    }
  }

  const lastConfirmation = observations.pop();
  if (!lastConfirmation) {
    throw new Error("Expected generated observations.");
  }
  observations.push({
    ...lastConfirmation,
    resolvedFirstName: "Conflicting",
    resolvedLastName: "Identity",
  });

  return observations;
}
