/**
 * أورادي وختماتي sync: shared types and the server's rules, as pure
 * functions used by both MongooseReadingSync (production) and the
 * in-memory test repository, so the two can never disagree.
 * Full design: docs/auth-and-sync/reading-sync.md.
 *
 * Account-based, like favorites: the server stores each record's content
 * (validated, readingSyncValidators.ts) for the authenticated account. It
 * needs no Sync Password and is never affected by the reflections' one.
 * The rules:
 *  - 'wird' and 'active': compare-and-swap. An update names the revision it
 *    was based on (`baseRevision`, null for a new record); a stale one is a
 *    'conflict' and gets the current record back, which the device merges
 *    and sends again. Nothing is ever silently overwritten.
 *  - 'khatma': created once, never edited. Re-sending the same record is
 *    harmless ('applied', the stored record is returned). A second record
 *    for a cycle that already has a confirmed one is refused as
 *    'duplicate', with the canonical record returned.
 *  - Deletion ('wird', 'khatma') always applies and is permanent: the
 *    record becomes a deletion marker without content, and any later
 *    update or re-creation of that id is answered 'deleted'.
 *  - 'active' (the account's selected ورد) is never deleted.
 *
 * Legacy records: an unreleased development build stored this content
 * end-to-end encrypted. Such a record (ciphertext, no `data`) is never
 * served and never blocks a write: a device uploading its own copy of
 * that record replaces it, and its ciphertext is kept aside
 * (`legacyEncrypted`), never deleted. Its deletion markers carry no
 * content and keep applying unchanged.
 */

export type ReadingRecordKind = 'wird' | 'khatma' | 'active';

export type ReadingCycleData = {
  id: string;
  startedAt: string;
  lastSavedPage: number;
  reachedEndAt: string | null;
  startedByKhatmaId: string | null;
  savedSinceStart: boolean;
  seq: number;
  undoneCycleId: string | null;
};
export type WirdData = { v: 1; kind: 'wird'; id: string; name: string; nameUpdatedAt: string | null; page: number; savedAt: string; cycle: ReadingCycleData; ayahKey?: string };
export type KhatmaData = {
  v: 1;
  kind: 'khatma';
  id: string;
  stopId: string;
  stopName: string;
  cycleId: string;
  cycleStartedAt: string;
  previousStartedByKhatmaId: string | null;
  completedAt: string;
  localDate: string;
  ramadan: boolean;
  ramadanHijriYear: number | null;
};
export type ActiveData = { v: 1; kind: 'active'; id: 'active'; stopId: string | null; changedAt: string | null };
export type ReadingData = WirdData | KhatmaData | ActiveData;

export type ReadingChange =
  | { kind: 'wird'; recordId: string; action: 'upsert'; baseRevision: number | null; data: WirdData }
  | { kind: 'active'; recordId: 'active'; action: 'upsert'; baseRevision: number | null; data: ActiveData }
  | { kind: 'khatma'; recordId: string; action: 'upsert'; data: KhatmaData }
  | { kind: 'wird' | 'khatma'; recordId: string; action: 'delete' };

/** A stored record as the server returns it (no content once deleted). */
export type ReadingRecordDto = {
  kind: ReadingRecordKind;
  recordId: string;
  revision: number;
  changeSeq: number;
  deleted: boolean;
  data?: ReadingData;
};

/** What the rules need to know about a stored record: legacy ones (encrypted, no content here) count as absent. */
export type StoredReadingState = ReadingRecordDto & { legacy?: boolean };

export type ReadingChangeStatus = 'applied' | 'conflict' | 'deleted' | 'duplicate' | 'limit';

export type ReadingChangeResult = {
  kind: ReadingRecordKind;
  recordId: string;
  status: ReadingChangeStatus;
  /** applied: the record as stored now; conflict/deleted: the current record; duplicate: the cycle's canonical Khatma. */
  record?: ReadingRecordDto;
};

export type ReadingPullResult = {
  /** null until the account's first reading write. */
  syncId: string | null;
  records: ReadingRecordDto[];
  /** Pass as `since` next time. */
  nextSince: number;
  hasMore: boolean;
};

export type ReadingPushResult = { syncId: string; results: ReadingChangeResult[] };

/** Bounds per account. Not product limits: storage safeguards (the app itself keeps at most 500 أوراد). */
export const READING_LIMITS = { activeWirds: 500, activeKhatmas: 10_000, records: 50_000 } as const;
export const READING_PULL_DEFAULT_LIMIT = 200;
export const READING_PULL_MAX_LIMIT = 500;
export const READING_PUSH_MAX_CHANGES = 50;

/** What a change does to the stored record, decided from the current state only. */
export type ReadingDecision =
  | { status: 'applied'; write: { deleted: boolean; data?: ReadingData } }
  | { status: 'applied' | 'conflict' | 'deleted' | 'duplicate'; current: ReadingRecordDto; write?: undefined };

/** The record as returned to devices (never the legacy flag or anything else stored). */
export function publicRecord(record: StoredReadingState): ReadingRecordDto {
  return {
    kind: record.kind,
    recordId: record.recordId,
    revision: record.revision,
    changeSeq: record.changeSeq,
    deleted: record.deleted,
    ...(record.data && !record.deleted ? { data: record.data } : {}),
  };
}

/**
 * `existing`: the stored record with this kind and id, if any.
 * `cycleKhatma`: for a Khatma upsert, the confirmed (not deleted, not
 * legacy) Khatma already stored for the same cycle, if any.
 */
export function decideReadingChange(change: ReadingChange, existing: StoredReadingState | null, cycleKhatma: StoredReadingState | null): ReadingDecision {
  if (change.action === 'delete') {
    if (existing?.deleted) return { status: 'applied', current: publicRecord(existing) };
    return { status: 'applied', write: { deleted: true } };
  }
  if (existing?.deleted) return { status: 'deleted', current: publicRecord(existing) };
  // An encrypted legacy record: its owner's device now uploads the content itself.
  const live = existing && !existing.legacy ? existing : null;

  if (change.kind === 'khatma') {
    if (live) return { status: 'applied', current: publicRecord(live) };
    if (cycleKhatma && !cycleKhatma.legacy) return { status: 'duplicate', current: publicRecord(cycleKhatma) };
    return { status: 'applied', write: { deleted: false, data: change.data } };
  }

  // New, or based on a revision the server no longer has: stored as the record's next version.
  if (!live) return { status: 'applied', write: { deleted: false, data: change.data } };
  if (change.baseRevision !== live.revision) return { status: 'conflict', current: publicRecord(live) };
  return { status: 'applied', write: { deleted: false, data: change.data } };
}

/** Whether a new record would exceed the account's bounds. `counts` are the account's current totals. */
export function exceedsReadingLimit(
  change: ReadingChange,
  existing: StoredReadingState | null,
  counts: { activeWirds: number; activeKhatmas: number; records: number },
): boolean {
  if (existing) return false;
  if (counts.records >= READING_LIMITS.records) return true;
  if (change.action !== 'upsert') return false;
  if (change.kind === 'wird') return counts.activeWirds >= READING_LIMITS.activeWirds;
  if (change.kind === 'khatma') return counts.activeKhatmas >= READING_LIMITS.activeKhatmas;
  return false;
}
