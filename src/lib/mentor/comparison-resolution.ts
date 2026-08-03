import type { MentorComparisonRawRecord } from "./daily-matching";
import type { MentorIdentityRepository } from "./identity-dictionary";

export type MentorComparisonResolutionStatus = "RESOLVED" | "UNRESOLVED" | "CONFLICT";

export type ResolvedMentorComparisonRecord = MentorComparisonRawRecord & {
  dictionary_confirmation_count: number | null;
  learned_date: string | null;
  operational_date?: string;
  primary_site: string | null;
  resolution_status: MentorComparisonResolutionStatus;
  resolved_first_name: string | null;
  resolved_last_name: string | null;
};

export type MentorComparisonResolutionSummary = {
  comparisonRows: number;
  conflictBlocked: number;
  resolutionRate: number;
  resolvedByDictionary: number;
  unresolved: number;
};

export type MentorComparisonResolutionResult = {
  rows: ResolvedMentorComparisonRecord[];
  summary: MentorComparisonResolutionSummary;
};

export async function resolveMentorComparisonRecords(
  comparisonRecords: MentorComparisonRawRecord[],
  repository: MentorIdentityRepository,
): Promise<MentorComparisonResolutionResult> {
  const rows: ResolvedMentorComparisonRecord[] = [];

  for (const record of comparisonRecords) {
    rows.push(await resolveMentorComparisonRecord(record, repository));
  }

  const resolvedByDictionary = rows.filter((row) => row.resolution_status === "RESOLVED").length;
  const conflictBlocked = rows.filter((row) => row.resolution_status === "CONFLICT").length;
  const unresolved = rows.filter((row) => row.resolution_status === "UNRESOLVED").length;

  return {
    rows,
    summary: {
      comparisonRows: comparisonRecords.length,
      conflictBlocked,
      resolutionRate: comparisonRecords.length === 0 ? 0 : resolvedByDictionary / comparisonRecords.length,
      resolvedByDictionary,
      unresolved,
    },
  };
}

async function resolveMentorComparisonRecord(
  record: MentorComparisonRawRecord,
  repository: MentorIdentityRepository,
): Promise<ResolvedMentorComparisonRecord> {
  const firstHash = stringValue(record.firstName);
  const lastHash = stringValue(record.lastName);

  if (!firstHash || !lastHash) {
    return unresolved(record);
  }

  const [dictionaryEntry, hasPendingConflict] = await Promise.all([
    repository.findByHashes(firstHash, lastHash),
    repository.hasPendingConflict ? repository.hasPendingConflict(firstHash, lastHash) : Promise.resolve(false),
  ]);

  if (hasPendingConflict) {
    return {
      ...record,
      dictionary_confirmation_count: dictionaryEntry?.confirmationCount ?? null,
      learned_date: dictionaryEntry ? dateOnly(dictionaryEntry.learnedFromOperationalDate) : null,
      primary_site: dictionaryEntry?.primarySite ?? null,
      resolution_status: "CONFLICT",
      resolved_first_name: null,
      resolved_last_name: null,
    };
  }

  if (!dictionaryEntry || dictionaryEntry.status !== "ACTIVE") {
    return unresolved(record);
  }

  return {
    ...record,
    dictionary_confirmation_count: dictionaryEntry.confirmationCount,
    learned_date: dateOnly(dictionaryEntry.learnedFromOperationalDate),
    primary_site: dictionaryEntry.primarySite,
    resolution_status: "RESOLVED",
    resolved_first_name: dictionaryEntry.resolvedFirstName,
    resolved_last_name: dictionaryEntry.resolvedLastName,
  };
}

function unresolved(record: MentorComparisonRawRecord): ResolvedMentorComparisonRecord {
  return {
    ...record,
    dictionary_confirmation_count: null,
    learned_date: null,
    primary_site: null,
    resolution_status: "UNRESOLVED",
    resolved_first_name: null,
    resolved_last_name: null,
  };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}
