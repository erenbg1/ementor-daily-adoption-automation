export type MentorDailyMatchCategory = "MATCHED" | "UNMATCHED_COMPARISON" | "UNMATCHED_SHIFT" | "AMBIGUOUS";

export type MentorStationValidationResult = "MATCH" | "MISMATCH" | "UNAVAILABLE" | "MIXED";

export type MentorDailyMatchReason =
  | "EXACT_DISTANCE_AND_STATION"
  | "TOLERANCE_DISTANCE_AND_STATION"
  | "DISTANCE_MATCH_STATION_UNAVAILABLE"
  | "DUPLICATE_DISTANCE_CANDIDATES"
  | "STATION_MISMATCH"
  | "NO_SHIFT_FOR_COMPARISON"
  | "NO_COMPARISON_FOR_SHIFT"
  | "INVALID_COMPARISON_MATCH_KEY"
  | "INVALID_SHIFT_MATCH_KEY";

export type MentorRawRecordValue = string | number | boolean | null | undefined;

export type MentorComparisonRawRecord = {
  AGGridId?: number;
  cdbId?: MentorRawRecordValue;
  date?: MentorRawRecordValue;
  distance?: MentorRawRecordValue;
  distanceKm?: MentorRawRecordValue;
  distanceKms?: MentorRawRecordValue;
  firstName?: MentorRawRecordValue;
  id?: MentorRawRecordValue;
  lastName?: MentorRawRecordValue;
  localDate?: MentorRawRecordValue;
  location1?: MentorRawRecordValue;
  operationalDay?: MentorRawRecordValue;
  pin?: MentorRawRecordValue;
  recordRef?: MentorRawRecordValue;
  reportDate?: MentorRawRecordValue;
  station?: MentorRawRecordValue;
  totalDistanceKm?: MentorRawRecordValue;
  totalTripCount?: MentorRawRecordValue;
  tripCount?: MentorRawRecordValue;
  vrmStatus?: MentorRawRecordValue;
  [key: string]: unknown;
};

export type MentorShiftRawRecord = {
  AGGridId?: number;
  date?: MentorRawRecordValue;
  device?: MentorRawRecordValue;
  distance?: MentorRawRecordValue;
  distanceKm?: MentorRawRecordValue;
  distanceKms?: MentorRawRecordValue;
  driverId?: MentorRawRecordValue;
  firstName?: MentorRawRecordValue;
  id?: MentorRawRecordValue;
  lastName?: MentorRawRecordValue;
  localDate?: MentorRawRecordValue;
  location1?: MentorRawRecordValue;
  operationalDay?: MentorRawRecordValue;
  recordRef?: MentorRawRecordValue;
  reportDate?: MentorRawRecordValue;
  shiftEndTime?: MentorRawRecordValue;
  shiftStartTime?: MentorRawRecordValue;
  station?: MentorRawRecordValue;
  totalDistanceKm?: MentorRawRecordValue;
  trip?: MentorRawRecordValue;
  tripCount?: MentorRawRecordValue;
  vehicleIdentifier?: MentorRawRecordValue;
  vrmStatus?: MentorRawRecordValue;
  [key: string]: unknown;
};

export type MentorDailyMatchingOptions = {
  distanceToleranceKm?: number;
  operationalDay?: string;
};

export type MentorDailyMatch = {
  category: MentorDailyMatchCategory;
  comparisonRecordRef?: string;
  comparisonRecordRefs: string[];
  shiftRecordRef?: string;
  shiftRecordRefs: string[];
  confidenceScore: number;
  matchedDistanceKm?: number;
  distanceDifferenceKm?: number;
  operationalDay?: string;
  stationValidationResult: MentorStationValidationResult;
  validationNotes: string[];
  matchReason: MentorDailyMatchReason;
};

export type MentorDailyMatchingStatistics = {
  ambiguousComparisonRows: number;
  ambiguousGroups: number;
  ambiguousShiftRows: number;
  comparisonRows: number;
  matchRate: number;
  matchedPairs: number;
  shiftRows: number;
  unmatchedComparisonRows: number;
  unmatchedShiftRows: number;
  zeroGuessedMatches: true;
};

export type MentorDailyMatchingResult = {
  matches: MentorDailyMatch[];
  statistics: MentorDailyMatchingStatistics;
};

type NormalizedComparison = {
  distanceKm?: number;
  normalizedStation?: string;
  operationalDay?: string;
  record: MentorComparisonRawRecord;
  ref: string;
  tripCount?: number;
};

type NormalizedShift = {
  distanceKm?: number;
  normalizedStation?: string;
  operationalDay?: string;
  record: MentorShiftRawRecord;
  ref: string;
  tripCount?: number;
};

type CandidatePair = {
  comparisonIndex: number;
  distanceDifferenceKm: number;
  shiftIndex: number;
  stationValidationResult: MentorStationValidationResult;
};

const DEFAULT_DISTANCE_TOLERANCE_KM = 0.01;

export function matchMentorDailyRecords(
  comparisonRecords: MentorComparisonRawRecord[],
  shiftRecords: MentorShiftRawRecord[],
  options: MentorDailyMatchingOptions = {},
): MentorDailyMatchingResult {
  const distanceToleranceKm = options.distanceToleranceKm ?? DEFAULT_DISTANCE_TOLERANCE_KM;
  const comparisons = comparisonRecords.map((record, index) => normalizeComparisonRecord(record, index, options));
  const shifts = shiftRecords.map((record, index) => normalizeShiftRecord(record, index, options));
  const candidatePairs = buildCandidatePairs(comparisons, shifts, distanceToleranceKm);
  const matches: MentorDailyMatch[] = [];
  const categorizedComparisons = new Set<number>();
  const categorizedShifts = new Set<number>();

  for (const component of buildCandidateComponents(candidatePairs)) {
    const stationMatchedPairs = component.pairs.filter((pair) => pair.stationValidationResult === "MATCH");
    const usablePairs = stationMatchedPairs.length > 0 ? stationMatchedPairs : component.pairs;

    if (canResolveOneToOne(usablePairs, component.comparisonIndexes, component.shiftIndexes)) {
      for (const pair of usablePairs) {
        const comparison = comparisons[pair.comparisonIndex];
        const shift = shifts[pair.shiftIndex];

        if (pair.stationValidationResult === "MISMATCH") {
          matches.push(
            ambiguousMatch([comparison], [shift], {
              reason: "STATION_MISMATCH",
              stationValidationResult: "MISMATCH",
              matchedDistanceKm: averageDistance(comparison.distanceKm, shift.distanceKm),
              distanceDifferenceKm: pair.distanceDifferenceKm,
              operationalDay: comparison.operationalDay ?? shift.operationalDay,
              validationNotes: [
                "Distance matched, but station validation failed. The matcher does not guess station mismatches.",
              ],
            }),
          );
        } else {
          matches.push(matchedPair(comparison, shift, pair, distanceToleranceKm));
        }

        categorizedComparisons.add(pair.comparisonIndex);
        categorizedShifts.add(pair.shiftIndex);
      }
    } else {
      const componentComparisons = component.comparisonIndexes.map((index) => comparisons[index]);
      const componentShifts = component.shiftIndexes.map((index) => shifts[index]);
      matches.push(
        ambiguousMatch(componentComparisons, componentShifts, {
          reason:
            component.pairs.some((pair) => pair.stationValidationResult === "MISMATCH") && stationMatchedPairs.length === 0
              ? "STATION_MISMATCH"
              : "DUPLICATE_DISTANCE_CANDIDATES",
          stationValidationResult: stationValidationForComponent(component.pairs),
          matchedDistanceKm: averageComponentDistance(componentComparisons, componentShifts),
          operationalDay: firstDefined(
            componentComparisons.map((record) => record.operationalDay),
            componentShifts.map((record) => record.operationalDay),
          ),
          validationNotes: [
            `Ambiguous distance bucket: ${componentComparisons.length} comparison candidate(s), ${componentShifts.length} shift candidate(s).`,
            "The matcher does not guess when multiple candidates exist.",
          ],
        }),
      );

      for (const index of component.comparisonIndexes) {
        categorizedComparisons.add(index);
      }
      for (const index of component.shiftIndexes) {
        categorizedShifts.add(index);
      }
    }
  }

  comparisons.forEach((comparison, index) => {
    if (categorizedComparisons.has(index)) {
      return;
    }

    matches.push(unmatchedComparison(comparison));
  });

  shifts.forEach((shift, index) => {
    if (categorizedShifts.has(index)) {
      return;
    }

    matches.push(unmatchedShift(shift));
  });

  return {
    matches,
    statistics: buildStatistics(comparisonRecords.length, shiftRecords.length, matches),
  };
}

export function generateMentorDailyMatchingReport(result: MentorDailyMatchingResult) {
  const { statistics } = result;

  return [
    `Comparison rows: ${statistics.comparisonRows}`,
    `Shift rows: ${statistics.shiftRows}`,
    `Matched: ${statistics.matchedPairs}`,
    `Ambiguous: ${statistics.ambiguousGroups}`,
    `Ambiguous comparison rows: ${statistics.ambiguousComparisonRows}`,
    `Ambiguous shift rows: ${statistics.ambiguousShiftRows}`,
    `Comparison unmatched: ${statistics.unmatchedComparisonRows}`,
    `Shift unmatched: ${statistics.unmatchedShiftRows}`,
    `Overall match rate: ${formatPercentage(statistics.matchRate)}`,
    "Guessed matches: 0",
  ].join("\n");
}

export function normalizeMentorStation(value: unknown) {
  const normalized = stringValue(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

  return normalized || undefined;
}

export function parseMentorNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const cleaned = trimmed.replace(/[^\d,.'+-]/g, "").replace(/'/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+") {
    return undefined;
  }

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized = cleaned;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = cleaned.split(thousandsSeparator).join("");
    normalized = normalized.replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = cleaned.replace(",", ".");
  } else {
    normalized = cleaned.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeMentorDistanceKm(value: unknown, precision = 3) {
  const parsed = parseMentorNumber(value);
  if (parsed === undefined) {
    return undefined;
  }

  return roundToPrecision(parsed, precision);
}

function normalizeComparisonRecord(
  record: MentorComparisonRawRecord,
  index: number,
  options: MentorDailyMatchingOptions,
): NormalizedComparison {
  return {
    distanceKm: normalizeMentorDistanceKm(
      record.distanceKms ?? record.distanceKm ?? record.totalDistanceKm ?? record.distance,
    ),
    normalizedStation: normalizeMentorStation(record.station ?? record.location1),
    operationalDay: normalizeOperationalDay(
      record.operationalDay ?? record.localDate ?? record.reportDate ?? record.date ?? options.operationalDay,
    ),
    record,
    ref: recordRef(record, "comparison", index),
    tripCount: parseMentorNumber(record.totalTripCount ?? record.tripCount),
  };
}

function normalizeShiftRecord(
  record: MentorShiftRawRecord,
  index: number,
  options: MentorDailyMatchingOptions,
): NormalizedShift {
  return {
    distanceKm: normalizeMentorDistanceKm(record.distanceKms ?? record.distanceKm ?? record.totalDistanceKm ?? record.distance),
    normalizedStation: normalizeMentorStation(record.location1 ?? record.station),
    operationalDay: normalizeOperationalDay(
      record.operationalDay ??
        record.localDate ??
        record.reportDate ??
        record.date ??
        record.shiftStartTime ??
        options.operationalDay,
    ),
    record,
    ref: recordRef(record, "shift", index),
    tripCount: parseMentorNumber(record.tripCount ?? record.trip),
  };
}

function buildCandidatePairs(
  comparisons: NormalizedComparison[],
  shifts: NormalizedShift[],
  distanceToleranceKm: number,
) {
  const pairs: CandidatePair[] = [];

  comparisons.forEach((comparison, comparisonIndex) => {
    const comparisonDistanceKm = comparison.distanceKm;
    if (comparisonDistanceKm === undefined || !comparison.operationalDay) {
      return;
    }

    shifts.forEach((shift, shiftIndex) => {
      const shiftDistanceKm = shift.distanceKm;
      if (shiftDistanceKm === undefined || !shift.operationalDay || comparison.operationalDay !== shift.operationalDay) {
        return;
      }

      const distanceDifferenceKm = Math.abs(comparisonDistanceKm - shiftDistanceKm);
      if (distanceDifferenceKm <= distanceToleranceKm) {
        pairs.push({
          comparisonIndex,
          distanceDifferenceKm,
          shiftIndex,
          stationValidationResult: validateStation(comparison.normalizedStation, shift.normalizedStation),
        });
      }
    });
  });

  return pairs;
}

function buildCandidateComponents(pairs: CandidatePair[]) {
  const comparisonToPairs = new Map<number, CandidatePair[]>();
  const shiftToPairs = new Map<number, CandidatePair[]>();

  for (const pair of pairs) {
    comparisonToPairs.set(pair.comparisonIndex, [...(comparisonToPairs.get(pair.comparisonIndex) ?? []), pair]);
    shiftToPairs.set(pair.shiftIndex, [...(shiftToPairs.get(pair.shiftIndex) ?? []), pair]);
  }

  const visitedComparisons = new Set<number>();
  const visitedShifts = new Set<number>();
  const components: Array<{
    comparisonIndexes: number[];
    pairs: CandidatePair[];
    shiftIndexes: number[];
  }> = [];

  for (const pair of pairs) {
    if (visitedComparisons.has(pair.comparisonIndex) && visitedShifts.has(pair.shiftIndex)) {
      continue;
    }

    const comparisonIndexes = new Set<number>();
    const componentPairs = new Set<CandidatePair>();
    const shiftIndexes = new Set<number>();
    const comparisonQueue = [pair.comparisonIndex];
    const shiftQueue = [pair.shiftIndex];

    while (comparisonQueue.length > 0 || shiftQueue.length > 0) {
      const comparisonIndex = comparisonQueue.pop();
      if (comparisonIndex !== undefined && !visitedComparisons.has(comparisonIndex)) {
        visitedComparisons.add(comparisonIndex);
        comparisonIndexes.add(comparisonIndex);
        for (const nextPair of comparisonToPairs.get(comparisonIndex) ?? []) {
          componentPairs.add(nextPair);
          if (!visitedShifts.has(nextPair.shiftIndex)) {
            shiftQueue.push(nextPair.shiftIndex);
          }
        }
      }

      const shiftIndex = shiftQueue.pop();
      if (shiftIndex !== undefined && !visitedShifts.has(shiftIndex)) {
        visitedShifts.add(shiftIndex);
        shiftIndexes.add(shiftIndex);
        for (const nextPair of shiftToPairs.get(shiftIndex) ?? []) {
          componentPairs.add(nextPair);
          if (!visitedComparisons.has(nextPair.comparisonIndex)) {
            comparisonQueue.push(nextPair.comparisonIndex);
          }
        }
      }
    }

    components.push({
      comparisonIndexes: [...comparisonIndexes].sort((a, b) => a - b),
      pairs: [...componentPairs],
      shiftIndexes: [...shiftIndexes].sort((a, b) => a - b),
    });
  }

  return components;
}

function canResolveOneToOne(
  pairs: CandidatePair[],
  comparisonIndexes: number[],
  shiftIndexes: number[],
) {
  if (pairs.length === 0 || comparisonIndexes.length !== shiftIndexes.length || pairs.length !== comparisonIndexes.length) {
    return false;
  }

  const comparisonCounts = countIndexes(pairs.map((pair) => pair.comparisonIndex));
  const shiftCounts = countIndexes(pairs.map((pair) => pair.shiftIndex));

  return [...comparisonCounts.values()].every((count) => count === 1) && [...shiftCounts.values()].every((count) => count === 1);
}

function matchedPair(
  comparison: NormalizedComparison,
  shift: NormalizedShift,
  pair: CandidatePair,
  distanceToleranceKm: number,
): MentorDailyMatch {
  const exactDistance = pair.distanceDifferenceKm === 0;
  const stationAvailable = pair.stationValidationResult !== "UNAVAILABLE";
  const validationNotes = [
    exactDistance
      ? "Total distance KM matched exactly for the same operational day."
      : `Total distance KM matched within tolerance ${distanceToleranceKm}.`,
  ];

  if (pair.stationValidationResult === "MATCH") {
    validationNotes.push("Station validation passed.");
  } else {
    validationNotes.push("Station validation was unavailable.");
  }

  const tripNote = validateTripCount(comparison.tripCount, shift.tripCount);
  if (tripNote) {
    validationNotes.push(tripNote);
  }

  return {
    category: "MATCHED",
    comparisonRecordRef: comparison.ref,
    comparisonRecordRefs: [comparison.ref],
    shiftRecordRef: shift.ref,
    shiftRecordRefs: [shift.ref],
    confidenceScore: stationAvailable ? (exactDistance ? 1 : 0.95) : exactDistance ? 0.9 : 0.85,
    matchedDistanceKm: averageDistance(comparison.distanceKm, shift.distanceKm),
    distanceDifferenceKm: pair.distanceDifferenceKm,
    operationalDay: comparison.operationalDay ?? shift.operationalDay,
    stationValidationResult: pair.stationValidationResult,
    validationNotes,
    matchReason: stationAvailable
      ? exactDistance
        ? "EXACT_DISTANCE_AND_STATION"
        : "TOLERANCE_DISTANCE_AND_STATION"
      : "DISTANCE_MATCH_STATION_UNAVAILABLE",
  };
}

function ambiguousMatch(
  comparisons: NormalizedComparison[],
  shifts: NormalizedShift[],
  options: {
    distanceDifferenceKm?: number;
    matchedDistanceKm?: number;
    operationalDay?: string;
    reason: Extract<MentorDailyMatchReason, "DUPLICATE_DISTANCE_CANDIDATES" | "STATION_MISMATCH">;
    stationValidationResult: MentorStationValidationResult;
    validationNotes: string[];
  },
): MentorDailyMatch {
  return {
    category: "AMBIGUOUS",
    comparisonRecordRefs: comparisons.map((comparison) => comparison.ref),
    confidenceScore: 0,
    distanceDifferenceKm: options.distanceDifferenceKm,
    matchedDistanceKm: options.matchedDistanceKm,
    operationalDay: options.operationalDay,
    shiftRecordRefs: shifts.map((shift) => shift.ref),
    stationValidationResult: options.stationValidationResult,
    validationNotes: options.validationNotes,
    matchReason: options.reason,
  };
}

function unmatchedComparison(comparison: NormalizedComparison): MentorDailyMatch {
  const invalidReasons = missingMatchKeyReasons(comparison);

  return {
    category: "UNMATCHED_COMPARISON",
    comparisonRecordRef: comparison.ref,
    comparisonRecordRefs: [comparison.ref],
    confidenceScore: 0,
    matchedDistanceKm: comparison.distanceKm,
    operationalDay: comparison.operationalDay,
    shiftRecordRefs: [],
    stationValidationResult: "UNAVAILABLE",
    validationNotes:
      invalidReasons.length > 0
        ? invalidReasons
        : ["No Shift record matched this Comparison record by operational day and total distance KM."],
    matchReason: invalidReasons.length > 0 ? "INVALID_COMPARISON_MATCH_KEY" : "NO_SHIFT_FOR_COMPARISON",
  };
}

function unmatchedShift(shift: NormalizedShift): MentorDailyMatch {
  const invalidReasons = missingMatchKeyReasons(shift);

  return {
    category: "UNMATCHED_SHIFT",
    comparisonRecordRefs: [],
    confidenceScore: 0,
    matchedDistanceKm: shift.distanceKm,
    operationalDay: shift.operationalDay,
    shiftRecordRef: shift.ref,
    shiftRecordRefs: [shift.ref],
    stationValidationResult: "UNAVAILABLE",
    validationNotes:
      invalidReasons.length > 0
        ? invalidReasons
        : ["No Comparison record matched this Shift record by operational day and total distance KM."],
    matchReason: invalidReasons.length > 0 ? "INVALID_SHIFT_MATCH_KEY" : "NO_COMPARISON_FOR_SHIFT",
  };
}

function missingMatchKeyReasons(record: NormalizedComparison | NormalizedShift) {
  const reasons: string[] = [];
  if (!record.operationalDay) {
    reasons.push("Operational day is missing or invalid.");
  }
  if (record.distanceKm === undefined) {
    reasons.push("Total distance KM is missing or invalid.");
  }
  return reasons;
}

function buildStatistics(
  comparisonRows: number,
  shiftRows: number,
  matches: MentorDailyMatch[],
): MentorDailyMatchingStatistics {
  const matchedPairs = matches.filter((match) => match.category === "MATCHED").length;
  const ambiguousMatches = matches.filter((match) => match.category === "AMBIGUOUS");
  const unmatchedComparisonRows = matches.filter((match) => match.category === "UNMATCHED_COMPARISON").length;
  const unmatchedShiftRows = matches.filter((match) => match.category === "UNMATCHED_SHIFT").length;

  return {
    ambiguousComparisonRows: ambiguousMatches.reduce((sum, match) => sum + match.comparisonRecordRefs.length, 0),
    ambiguousGroups: ambiguousMatches.length,
    ambiguousShiftRows: ambiguousMatches.reduce((sum, match) => sum + match.shiftRecordRefs.length, 0),
    comparisonRows,
    matchRate: comparisonRows === 0 ? 0 : matchedPairs / comparisonRows,
    matchedPairs,
    shiftRows,
    unmatchedComparisonRows,
    unmatchedShiftRows,
    zeroGuessedMatches: true,
  };
}

function validateStation(comparisonStation?: string, shiftStation?: string): MentorStationValidationResult {
  if (!comparisonStation || !shiftStation) {
    return "UNAVAILABLE";
  }

  return comparisonStation === shiftStation ? "MATCH" : "MISMATCH";
}

function validateTripCount(comparisonTripCount?: number, shiftTripCount?: number) {
  if (comparisonTripCount === undefined || shiftTripCount === undefined) {
    return undefined;
  }

  return comparisonTripCount === shiftTripCount
    ? "Trip count validation passed."
    : `Trip count validation differed: Comparison ${comparisonTripCount}, Shift ${shiftTripCount}.`;
}

function stationValidationForComponent(pairs: CandidatePair[]): MentorStationValidationResult {
  const results = new Set(pairs.map((pair) => pair.stationValidationResult));
  if (results.size === 1) {
    return [...results][0] ?? "UNAVAILABLE";
  }
  return "MIXED";
}

function normalizeOperationalDay(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString().slice(0, 10);
  }

  const text = stringValue(value);
  if (!text) {
    return undefined;
  }

  const isoDate = text.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) {
    return isoDate;
  }

  const germanDate = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (germanDate) {
    return `${germanDate[3]}-${germanDate[2].padStart(2, "0")}-${germanDate[1].padStart(2, "0")}`;
  }

  return undefined;
}

function recordRef(record: MentorComparisonRawRecord | MentorShiftRawRecord, prefix: string, index: number) {
  const explicitRef = stringValue(record.recordRef ?? record.id);
  if (explicitRef) {
    return explicitRef;
  }

  if (record.AGGridId !== undefined) {
    return `${prefix}:ag-grid:${record.AGGridId}`;
  }

  if ("cdbId" in record) {
    const cdbId = stringValue(record.cdbId);
    if (cdbId) {
      return `${prefix}:cdb:${cdbId}`;
    }
  }

  if ("driverId" in record) {
    const driverId = stringValue(record.driverId);
    if (driverId) {
      return `${prefix}:driver:${driverId}`;
    }
  }

  return `${prefix}:row:${index}`;
}

function countIndexes(indexes: number[]) {
  const counts = new Map<number, number>();
  for (const index of indexes) {
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return counts;
}

function averageDistance(left?: number, right?: number) {
  if (left !== undefined && right !== undefined) {
    return roundToPrecision((left + right) / 2, 3);
  }
  return left ?? right;
}

function averageComponentDistance(comparisons: NormalizedComparison[], shifts: NormalizedShift[]) {
  const values = [...comparisons.map((record) => record.distanceKm), ...shifts.map((record) => record.distanceKm)].filter(
    (value): value is number => value !== undefined,
  );
  if (values.length === 0) {
    return undefined;
  }

  return roundToPrecision(values.reduce((sum, value) => sum + value, 0) / values.length, 3);
}

function firstDefined<T>(...groups: Array<Array<T | undefined>>) {
  for (const group of groups) {
    for (const value of group) {
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

function roundToPrecision(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatPercentage(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function stringValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
