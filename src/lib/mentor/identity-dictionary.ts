import type {
  MentorComparisonRawRecord,
  MentorDailyMatchingResult,
  MentorShiftRawRecord,
} from "./daily-matching";

export type MentorIdentityEventType = "LEARNED" | "CONFIRMED" | "CONFLICT";
export type MentorIdentityReviewStatus = "NONE" | "PENDING_REVIEW";
export type MentorIdentityLearningAction = "learned" | "confirmed" | "conflict";

export type MentorIdentityDictionaryEntry = {
  id: string;
  firstHash: string;
  lastHash: string;
  resolvedFirstName: string;
  resolvedLastName: string;
  primaryStation: string | null;
  firstSeenOperationalDate: Date;
  lastSeenOperationalDate: Date;
  learnedFromOperationalDate: Date;
  confirmationCount: number;
  status: string;
};

export type MentorIdentityLearningEvent = {
  id: string;
  dictionaryId: string | null;
  eventType: MentorIdentityEventType;
  reviewStatus: MentorIdentityReviewStatus;
  operationalDate: Date;
  firstHash: string;
  lastHash: string;
  observedFirstName: string;
  observedLastName: string;
  existingFirstName: string | null;
  existingLastName: string | null;
  station: string | null;
  distanceKm: number | null;
  comparisonRecordRef: string | null;
  shiftRecordRef: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
};

export type MentorIdentityLearningObservation = {
  operationalDate: string | Date;
  firstHash: string;
  lastHash: string;
  resolvedFirstName: string;
  resolvedLastName: string;
  station?: string | null;
  distanceKm?: number | null;
  comparisonRecordRef?: string | null;
  shiftRecordRef?: string | null;
  matchConfidence?: number | null;
  matchReason?: string | null;
};

export type MentorIdentityLearningResult = {
  action: MentorIdentityLearningAction;
  dictionaryEntry?: MentorIdentityDictionaryEntry;
  event: MentorIdentityLearningEvent;
};

export type MentorIdentityLearningDryRunSummary = {
  learned: number;
  confirmed: number;
  conflicts: number;
  totalObservations: number;
  finalDictionarySize: number;
};

export type MentorIdentityRepository = {
  countDictionaryEntries?(): Promise<number>;
  createDictionaryEntry(input: CreateMentorIdentityDictionaryEntryInput): Promise<MentorIdentityDictionaryEntry>;
  createLearningEvent(input: CreateMentorIdentityLearningEventInput): Promise<MentorIdentityLearningEvent>;
  findByHashes(firstHash: string, lastHash: string): Promise<MentorIdentityDictionaryEntry | null>;
  hasPendingConflict?(firstHash: string, lastHash: string): Promise<boolean>;
  incrementConfirmation(input: IncrementMentorIdentityConfirmationInput): Promise<MentorIdentityDictionaryEntry>;
};

type CreateMentorIdentityDictionaryEntryInput = {
  firstHash: string;
  lastHash: string;
  resolvedFirstName: string;
  resolvedLastName: string;
  primaryStation: string | null;
  operationalDate: Date;
};

type IncrementMentorIdentityConfirmationInput = {
  id: string;
  operationalDate: Date;
  primaryStation: string | null;
};

type CreateMentorIdentityLearningEventInput = {
  dictionaryId: string | null;
  eventType: MentorIdentityEventType;
  reviewStatus: MentorIdentityReviewStatus;
  operationalDate: Date;
  firstHash: string;
  lastHash: string;
  observedFirstName: string;
  observedLastName: string;
  existingFirstName: string | null;
  existingLastName: string | null;
  station: string | null;
  distanceKm: number | null;
  comparisonRecordRef: string | null;
  shiftRecordRef: string | null;
  matchConfidence: number | null;
  matchReason: string | null;
};

type MentorIdentityPrismaClient = {
  mentorIdentityDictionary: {
    count(): Promise<number>;
    create(input: { data: Record<string, unknown> }): Promise<MentorIdentityDictionaryEntry>;
    findUnique(input: { where: { firstHash_lastHash: { firstHash: string; lastHash: string } } }): Promise<MentorIdentityDictionaryEntry | null>;
    update(input: { data: Record<string, unknown>; where: { id: string } }): Promise<MentorIdentityDictionaryEntry>;
  };
  mentorIdentityLearningEvent: {
    create(input: { data: Record<string, unknown> }): Promise<MentorIdentityLearningEvent>;
    findFirst(input: { where: { eventType: string; firstHash: string; lastHash: string; reviewStatus: string } }): Promise<MentorIdentityLearningEvent | null>;
  };
};

export class PrismaMentorIdentityRepository implements MentorIdentityRepository {
  constructor(private readonly client: MentorIdentityPrismaClient) {}

  async countDictionaryEntries() {
    return this.client.mentorIdentityDictionary.count();
  }

  async findByHashes(firstHash: string, lastHash: string) {
    return this.client.mentorIdentityDictionary.findUnique({
      where: {
        firstHash_lastHash: {
          firstHash,
          lastHash,
        },
      },
    });
  }

  async hasPendingConflict(firstHash: string, lastHash: string) {
    const conflict = await this.client.mentorIdentityLearningEvent.findFirst({
      where: {
        eventType: "CONFLICT",
        firstHash,
        lastHash,
        reviewStatus: "PENDING_REVIEW",
      },
    });

    return Boolean(conflict);
  }

  async createDictionaryEntry(input: CreateMentorIdentityDictionaryEntryInput) {
    return this.client.mentorIdentityDictionary.create({
      data: {
        firstHash: input.firstHash,
        lastHash: input.lastHash,
        resolvedFirstName: input.resolvedFirstName,
        resolvedLastName: input.resolvedLastName,
        primaryStation: input.primaryStation,
        firstSeenOperationalDate: input.operationalDate,
        lastSeenOperationalDate: input.operationalDate,
        learnedFromOperationalDate: input.operationalDate,
        confirmationCount: 1,
        status: "ACTIVE",
      },
    });
  }

  async incrementConfirmation(input: IncrementMentorIdentityConfirmationInput) {
    return this.client.mentorIdentityDictionary.update({
      where: { id: input.id },
      data: {
        confirmationCount: { increment: 1 },
        lastSeenOperationalDate: input.operationalDate,
        ...(input.primaryStation ? { primaryStation: input.primaryStation } : {}),
      },
    });
  }

  async createLearningEvent(input: CreateMentorIdentityLearningEventInput) {
    return this.client.mentorIdentityLearningEvent.create({
      data: {
        comparisonRecordRef: input.comparisonRecordRef,
        distanceKm: input.distanceKm,
        eventType: input.eventType,
        existingFirstName: input.existingFirstName,
        existingLastName: input.existingLastName,
        firstHash: input.firstHash,
        lastHash: input.lastHash,
        matchConfidence: input.matchConfidence,
        matchReason: input.matchReason,
        observedFirstName: input.observedFirstName,
        observedLastName: input.observedLastName,
        operationalDate: input.operationalDate,
        reviewStatus: input.reviewStatus,
        shiftRecordRef: input.shiftRecordRef,
        station: input.station,
        ...(input.dictionaryId ? { dictionary: { connect: { id: input.dictionaryId } } } : {}),
      },
    });
  }
}

export async function lookupMentorIdentity(
  repository: MentorIdentityRepository,
  firstHash: string,
  lastHash: string,
) {
  const hashes = normalizeHashPair(firstHash, lastHash);
  if (!hashes) {
    return null;
  }

  return repository.findByHashes(hashes.firstHash, hashes.lastHash);
}

export async function learnMentorIdentity(
  repository: MentorIdentityRepository,
  observation: MentorIdentityLearningObservation,
): Promise<MentorIdentityLearningResult> {
  const normalized = normalizeLearningObservation(observation);
  const existing = await repository.findByHashes(normalized.firstHash, normalized.lastHash);

  if (!existing) {
    const dictionaryEntry = await repository.createDictionaryEntry({
      firstHash: normalized.firstHash,
      lastHash: normalized.lastHash,
      resolvedFirstName: normalized.resolvedFirstName,
      resolvedLastName: normalized.resolvedLastName,
      primaryStation: normalized.station,
      operationalDate: normalized.operationalDate,
    });
    const event = await repository.createLearningEvent({
      ...eventInputFromObservation(normalized),
      dictionaryId: dictionaryEntry.id,
      eventType: "LEARNED",
      existingFirstName: null,
      existingLastName: null,
      reviewStatus: "NONE",
    });

    return { action: "learned", dictionaryEntry, event };
  }

  if (sameResolvedIdentity(existing, normalized)) {
    const dictionaryEntry = await repository.incrementConfirmation({
      id: existing.id,
      operationalDate: normalized.operationalDate,
      primaryStation: normalized.station,
    });
    const event = await repository.createLearningEvent({
      ...eventInputFromObservation(normalized),
      dictionaryId: existing.id,
      eventType: "CONFIRMED",
      existingFirstName: existing.resolvedFirstName,
      existingLastName: existing.resolvedLastName,
      reviewStatus: "NONE",
    });

    return { action: "confirmed", dictionaryEntry, event };
  }

  const event = await repository.createLearningEvent({
    ...eventInputFromObservation(normalized),
    dictionaryId: existing.id,
    eventType: "CONFLICT",
    existingFirstName: existing.resolvedFirstName,
    existingLastName: existing.resolvedLastName,
    reviewStatus: "PENDING_REVIEW",
  });

  return { action: "conflict", dictionaryEntry: existing, event };
}

export async function learnMentorIdentities(
  repository: MentorIdentityRepository,
  observations: MentorIdentityLearningObservation[],
) {
  const summary: MentorIdentityLearningDryRunSummary = {
    learned: 0,
    confirmed: 0,
    conflicts: 0,
    finalDictionarySize: 0,
    totalObservations: observations.length,
  };
  const results: MentorIdentityLearningResult[] = [];

  for (const observation of observations) {
    const result = await learnMentorIdentity(repository, observation);
    results.push(result);
    if (result.action === "learned") {
      summary.learned += 1;
    } else if (result.action === "confirmed") {
      summary.confirmed += 1;
    } else {
      summary.conflicts += 1;
    }
  }

  summary.finalDictionarySize = await getRepositoryDictionarySize(repository);
  return { results, summary };
}

export function buildMentorIdentityLearningObservations(input: {
  comparisonRecords: MentorComparisonRawRecord[];
  matchingResult: MentorDailyMatchingResult;
  operationalDate: string | Date;
  shiftRecords: MentorShiftRawRecord[];
}): MentorIdentityLearningObservation[] {
  const comparisonByRef = buildRecordMap(input.comparisonRecords, "comparison");
  const shiftByRef = buildRecordMap(input.shiftRecords, "shift");
  const observations: MentorIdentityLearningObservation[] = [];

  for (const match of input.matchingResult.matches) {
    if (match.category !== "MATCHED" || !match.comparisonRecordRef || !match.shiftRecordRef) {
      continue;
    }

    const comparison = comparisonByRef.get(match.comparisonRecordRef);
    const shift = shiftByRef.get(match.shiftRecordRef);
    if (!comparison || !shift) {
      continue;
    }

    const firstHash = stringValue(comparison.firstName);
    const lastHash = stringValue(comparison.lastName);
    const resolvedFirstName = stringValue(shift.firstName);
    const resolvedLastName = stringValue(shift.lastName);
    if (!firstHash || !lastHash || !resolvedFirstName || !resolvedLastName) {
      continue;
    }

    observations.push({
      comparisonRecordRef: match.comparisonRecordRef,
      distanceKm: match.matchedDistanceKm ?? null,
      firstHash,
      lastHash,
      matchConfidence: match.confidenceScore,
      matchReason: match.matchReason,
      operationalDate: input.operationalDate,
      resolvedFirstName,
      resolvedLastName,
      shiftRecordRef: match.shiftRecordRef,
      station: stringValue(comparison.station ?? comparison.location1 ?? shift.location1 ?? shift.station) || null,
    });
  }

  return observations;
}

export async function simulateMentorIdentityLearning(
  observations: MentorIdentityLearningObservation[],
  initialEntries: MentorIdentityLearningObservation[] = [],
) {
  const repository = createInMemoryMentorIdentityRepository();
  for (const entry of initialEntries) {
    await learnMentorIdentity(repository, entry);
  }
  return learnMentorIdentities(repository, observations);
}

export function createInMemoryMentorIdentityRepository() {
  return new InMemoryMentorIdentityRepository();
}

class InMemoryMentorIdentityRepository implements MentorIdentityRepository {
  private readonly entries = new Map<string, MentorIdentityDictionaryEntry>();
  private readonly events: MentorIdentityLearningEvent[] = [];
  private eventCounter = 0;
  private entryCounter = 0;

  async findByHashes(firstHash: string, lastHash: string) {
    return this.entries.get(dictionaryKey(firstHash, lastHash)) ?? null;
  }

  async createDictionaryEntry(input: CreateMentorIdentityDictionaryEntryInput) {
    const entry: MentorIdentityDictionaryEntry = {
      confirmationCount: 1,
      firstHash: input.firstHash,
      firstSeenOperationalDate: input.operationalDate,
      id: `identity-${++this.entryCounter}`,
      lastHash: input.lastHash,
      lastSeenOperationalDate: input.operationalDate,
      learnedFromOperationalDate: input.operationalDate,
      primaryStation: input.primaryStation,
      resolvedFirstName: input.resolvedFirstName,
      resolvedLastName: input.resolvedLastName,
      status: "ACTIVE",
    };
    this.entries.set(dictionaryKey(input.firstHash, input.lastHash), entry);
    return entry;
  }

  async incrementConfirmation(input: IncrementMentorIdentityConfirmationInput) {
    const entry = [...this.entries.values()].find((candidate) => candidate.id === input.id);
    if (!entry) {
      throw new Error(`Mentor identity ${input.id} was not found.`);
    }

    entry.confirmationCount += 1;
    entry.lastSeenOperationalDate = input.operationalDate;
    if (input.primaryStation) {
      entry.primaryStation = input.primaryStation;
    }
    return entry;
  }

  async createLearningEvent(input: CreateMentorIdentityLearningEventInput) {
    const event = {
      ...input,
      id: `event-${++this.eventCounter}`,
    };
    this.events.push(event);
    return event;
  }

  async countDictionaryEntries() {
    return this.entries.size;
  }

  async hasPendingConflict(firstHash: string, lastHash: string) {
    return this.events.some(
      (event) =>
        event.firstHash === firstHash &&
        event.lastHash === lastHash &&
        event.eventType === "CONFLICT" &&
        event.reviewStatus === "PENDING_REVIEW",
    );
  }
}

type NormalizedLearningObservation = Required<
  Pick<
    MentorIdentityLearningObservation,
    "firstHash" | "lastHash" | "resolvedFirstName" | "resolvedLastName"
  >
> & {
  comparisonRecordRef: string | null;
  distanceKm: number | null;
  matchConfidence: number | null;
  matchReason: string | null;
  operationalDate: Date;
  shiftRecordRef: string | null;
  station: string | null;
};

function normalizeLearningObservation(observation: MentorIdentityLearningObservation): NormalizedLearningObservation {
  const hashes = normalizeHashPair(observation.firstHash, observation.lastHash);
  const resolvedFirstName = stringValue(observation.resolvedFirstName);
  const resolvedLastName = stringValue(observation.resolvedLastName);

  if (!hashes || !resolvedFirstName || !resolvedLastName) {
    throw new Error("Mentor identity learning requires first hash, last hash, first name, and last name.");
  }

  return {
    comparisonRecordRef: stringValue(observation.comparisonRecordRef) || null,
    distanceKm: typeof observation.distanceKm === "number" && Number.isFinite(observation.distanceKm) ? observation.distanceKm : null,
    firstHash: hashes.firstHash,
    lastHash: hashes.lastHash,
    matchConfidence:
      typeof observation.matchConfidence === "number" && Number.isFinite(observation.matchConfidence)
        ? observation.matchConfidence
        : null,
    matchReason: stringValue(observation.matchReason) || null,
    operationalDate: parseOperationalDate(observation.operationalDate),
    resolvedFirstName,
    resolvedLastName,
    shiftRecordRef: stringValue(observation.shiftRecordRef) || null,
    station: stringValue(observation.station) || null,
  };
}

function normalizeHashPair(firstHash: string, lastHash: string) {
  const normalizedFirstHash = stringValue(firstHash);
  const normalizedLastHash = stringValue(lastHash);
  if (!normalizedFirstHash || !normalizedLastHash) {
    return null;
  }

  return { firstHash: normalizedFirstHash, lastHash: normalizedLastHash };
}

function eventInputFromObservation(
  observation: NormalizedLearningObservation,
): Omit<CreateMentorIdentityLearningEventInput, "dictionaryId" | "eventType" | "existingFirstName" | "existingLastName" | "reviewStatus"> {
  return {
    comparisonRecordRef: observation.comparisonRecordRef,
    distanceKm: observation.distanceKm,
    firstHash: observation.firstHash,
    lastHash: observation.lastHash,
    matchConfidence: observation.matchConfidence,
    matchReason: observation.matchReason,
    observedFirstName: observation.resolvedFirstName,
    observedLastName: observation.resolvedLastName,
    operationalDate: observation.operationalDate,
    shiftRecordRef: observation.shiftRecordRef,
    station: observation.station,
  };
}

function sameResolvedIdentity(entry: MentorIdentityDictionaryEntry, observation: NormalizedLearningObservation) {
  return entry.resolvedFirstName === observation.resolvedFirstName && entry.resolvedLastName === observation.resolvedLastName;
}

function buildRecordMap<T extends MentorComparisonRawRecord | MentorShiftRawRecord>(records: T[], prefix: string) {
  return new Map(records.map((record, index) => [recordRef(record, prefix, index), record] as const));
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

async function getRepositoryDictionarySize(repository: MentorIdentityRepository) {
  if (repository.countDictionaryEntries) {
    return repository.countDictionaryEntries();
  }

  return 0;
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

function dictionaryKey(firstHash: string, lastHash: string) {
  return `${firstHash}\u0000${lastHash}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}
