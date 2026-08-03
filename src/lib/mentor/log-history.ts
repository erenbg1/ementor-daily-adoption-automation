import { parseMentorNumber, type MentorComparisonRawRecord } from "./daily-matching";
import type { ResolvedMentorComparisonRecord } from "./comparison-resolution";

export type MentorLogHistoryRowInput = {
  dictionaryConfirmationCount: number | null;
  distanceKms: number | null;
  safetyScore: number | null;
  firstHash: string | null;
  lastHash: string | null;
  learnedDate: Date | null;
  operationalDate: Date;
  primarySite: string | null;
  rawComparison: Record<string, unknown>;
  resolutionStatus: string;
  resolvedFirstName: string | null;
  resolvedLastName: string | null;
  sourceRecordRef: string | null;
  sourceRowIndex: number;
  site: string | null;
  totalTripCount: number | null;
};

export type MentorLogHistoryAppendSummary = {
  appendedRows: number;
};

type MentorLogHistoryPrismaClient = {
  mentorLogHistoryRow: {
    upsert(input: {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      where: { operationalDate_sourceRowIndex: { operationalDate: Date; sourceRowIndex: number } };
    }): Promise<unknown>;
  };
};

export function buildMentorLogHistoryRows(
  rows: ResolvedMentorComparisonRecord[],
  options: { operationalDate: string | Date },
): MentorLogHistoryRowInput[] {
  const operationalDate = parseOperationalDate(options.operationalDate);

  return rows.map((row, index) => ({
    dictionaryConfirmationCount: row.dictionary_confirmation_count,
    distanceKms: parseMentorNumber(row.distanceKms ?? row.distanceKm ?? row.totalDistanceKm ?? row.distance) ?? null,
    safetyScore: parseMentorNumber(row.overallScore) ?? null,
    firstHash: stringValue(row.firstName) || null,
    lastHash: stringValue(row.lastName) || null,
    learnedDate: row.learned_date ? parseOperationalDate(row.learned_date) : null,
    operationalDate,
    primarySite: row.primary_site,
    rawComparison: jsonSafeObject(row),
    resolutionStatus: row.resolution_status,
    resolvedFirstName: row.resolved_first_name,
    resolvedLastName: row.resolved_last_name,
    sourceRecordRef: recordRef(row, index),
    sourceRowIndex: index,
    site: stringValue(row.site ?? row.location1) || null,
    totalTripCount: parseMentorNumber(row.totalTripCount ?? row.tripCount) ?? null,
  }));
}

export async function appendMentorLogHistoryRows(
  client: MentorLogHistoryPrismaClient,
  rows: MentorLogHistoryRowInput[],
): Promise<MentorLogHistoryAppendSummary> {
  for (const row of rows) {
    const persistedRow = persistableLogHistoryRow(row);
    await client.mentorLogHistoryRow.upsert({
      where: {
        operationalDate_sourceRowIndex: {
          operationalDate: row.operationalDate,
          sourceRowIndex: row.sourceRowIndex,
        },
      },
      create: persistedRow,
      update: {
        dictionaryConfirmationCount: row.dictionaryConfirmationCount,
        distanceKms: row.distanceKms,
        safetyScore: row.safetyScore,
        firstHash: row.firstHash,
        lastHash: row.lastHash,
        learnedDate: row.learnedDate,
        primarySite: row.primarySite,
        rawComparison: persistedRow.rawComparison,
        resolutionStatus: row.resolutionStatus,
        resolvedFirstName: row.resolvedFirstName,
        resolvedLastName: row.resolvedLastName,
        sourceRecordRef: row.sourceRecordRef,
        site: row.site,
        totalTripCount: row.totalTripCount,
      },
    });
  }

  return { appendedRows: rows.length };
}

function persistableLogHistoryRow(row: MentorLogHistoryRowInput) {
  if (process.env.MENTOR_LOG_DATABASE_URL?.trim().startsWith("file:")) {
    return {
      ...row,
      rawComparison: JSON.stringify(row.rawComparison),
    };
  }

  return row;
}

function parseOperationalDate(value: string | Date) {
  if (value instanceof Date) {
    return value;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Mentor operational date: ${value}`);
  }

  return date;
}

function recordRef(record: MentorComparisonRawRecord, index: number) {
  const explicitRef = stringValue(record.recordRef ?? record.id);
  if (explicitRef) {
    return explicitRef;
  }

  if (record.AGGridId !== undefined) {
    return `comparison:ag-grid:${record.AGGridId}`;
  }

  const cdbId = stringValue(record.cdbId);
  if (cdbId) {
    return `comparison:cdb:${cdbId}`;
  }

  return `comparison:row:${index}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function jsonSafeObject(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
