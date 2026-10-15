import AsyncStorage from '@react-native-async-storage/async-storage';

import { notifyLocalReadingChange } from '@/storage/localChanges';
import { ownerStorageKey } from '@/storage/localDataOwner';

import { MUSHAF_PAGE_COUNT } from './mushafPage';
import { classifyRamadan, localCivilDate } from './ramadan';
import {
  ACTIVE_READING_STOP_AT_STORAGE_KEY,
  ACTIVE_READING_STOP_STORAGE_KEY,
  activeReadingStopAtKey,
  activeReadingStopKey,
  defaultId,
  loadActiveReadingStopChangedAt,
  loadActiveReadingStopId,
  normalizeReadingStopName,
  notifyReadingDataChanged,
  parseReadingStops,
  persistReadingStops,
  READING_STOP_NAME_MAX_LENGTH,
  READING_STOPS_STORAGE_KEY,
  ReadingStopError,
  readingOwner,
  readingStopsKey,
  removeReadingStopUnlocked,
  saveReadingStopUnlocked,
  stopAtPage,
  withReadingLock,
  writeActiveReadingStop,
  type ReadingStop,
} from './readingStops';
import { LEGACY_READING_SYNC_STORAGE_KEY, READING_SYNC_STORAGE_KEY } from './readingSyncKeys';

/**
 * أورادي وختماتي: each reading stop's (ورد's) current reading cycle, and
 * every completed Khatma (docs/khatma.md).
 *
 * Stored beside the stops (readingStops.ts, whose format is unchanged), by
 * stop id, in one document per owner (guest: KHATMAS_STORAGE_KEY; an
 * account: `<key>:account:<userId>`), so a record and its cycle change
 * together in one write.
 *
 *  - Progress is the stop's saved page out of 604. It changes only through
 *    an explicit save; opening, browsing or searching a page changes nothing.
 *  - A Khatma becomes available to confirm when a save takes a stop from an
 *    earlier page to page 604 ('pending'). A stop at 604 that got there
 *    without such a save (saved before this feature, or created on 604) is
 *    'unconfirmedEnd': nothing is counted or discarded, and the reader may
 *    record a Khatma only through a separate, explicitly worded confirmation.
 *  - Confirming creates one record (its id derives from the cycle's id, so
 *    a repeated tap, a retry or an interrupted write can never count a cycle
 *    twice) and starts a new cycle at page 1. Previous records are never
 *    touched.
 *  - Removing a record (a mistaken confirmation) recalculates every count
 *    from the records. If the stop has not been saved since that
 *    confirmation, it returns to page 604 with the completion pending again;
 *    otherwise its current progress is kept as it is.
 *  - Deleting a stop keeps its completed Khatmas in the history and totals,
 *    under the name it had.
 *
 * Writes that touch both the stops and this document (confirm, undo) mark
 * the cycle's `pendingPage` first; a later load finishes an interrupted one.
 *
 * Sync (signed-in accounts, account-based: sync/readingSync.ts) needs three more things,
 * all optional so older data reads unchanged:
 *  - each cycle's `seq`: its generation, +1 at every confirmation and
 *    every undo. Two devices' versions of one ورد compare by it, so a
 *    device that has not seen a confirmation can never revert it.
 *  - `undoneCycleId`: on a cycle restored by an undo, the cycle the undo
 *    discarded — another device's progress in that cycle then wins.
 *  - deletion markers (`deletedStops`, `deletedRecords`), so a deletion
 *    reaches the account and an older copy can never bring the record back.
 */

export const KHATMAS_STORAGE_KEY = 'quran-heals:mushaf-khatmas:v1';
export const khatmasKey = (owner: string | null) => ownerStorageKey(KHATMAS_STORAGE_KEY, owner);

export type ReadingCycle = {
  id: string;
  startedAt: string;
  /** The stop's page as last recorded here: a stop saved elsewhere (or by an interrupted save) is caught up on load. */
  lastSavedPage: number;
  /** Set when a save took this cycle from an earlier page to 604: the completion awaits confirmation. */
  reachedEndAt: string | null;
  /** The Khatma whose confirmation began this cycle (null for a stop's first cycle). */
  startedByKhatmaId: string | null;
  /** The stop was saved at least once since this cycle began. */
  savedSinceStart: boolean;
  /** Set between the two writes of a confirmation or undo: the stop's page to apply. */
  pendingPage?: number;
  /** Generation: +1 at each confirmation and undo (absent: 0). */
  seq?: number;
  /** On a cycle restored by an undo: the cycle the undo discarded. */
  undoneCycleId?: string;
};

export type KhatmaRecord = {
  id: string;
  stopId: string;
  /** The stop's name when confirmed (shown if the stop is later deleted). */
  stopName: string;
  cycleId: string;
  cycleStartedAt: string;
  /** The completed cycle's own startedByKhatmaId, restored if this record is removed. */
  previousStartedByKhatmaId: string | null;
  completedAt: string;
  /** Local civil date of the confirmation (YYYY-MM-DD). */
  localDate: string;
  ramadan: boolean;
  ramadanHijriYear: number | null;
};

export type WirdStatus = 'reading' | 'pending' | 'unconfirmedEnd';

export type Wird = {
  stop: ReadingStop;
  cycle: ReadingCycle;
  status: WirdStatus;
  /** Whole percent of the current cycle (saved page ÷ 604, rounded down: 100 only on page 604). */
  percent: number;
  khatmas: number;
};

export type KhatmaStats = { total: number; ramadan: number; nonRamadan: number };

export type ReadingData = {
  owner: string | null;
  stops: ReadingStop[];
  activeStopId: string | null;
  /** In the stops' order (most recently saved first). */
  wirds: Wird[];
  /** Newest first. */
  records: KhatmaRecord[];
  stats: KhatmaStats;
};

type KhatmaDocument = {
  schema: 1;
  cycles: Record<string, ReadingCycle>;
  records: KhatmaRecord[];
  /** Deleted stops and removed Khatma records, by id → when (ISO). */
  deletedStops: Record<string, string>;
  deletedRecords: Record<string, string>;
};

/** Bounds the deletion markers kept on the device (the account keeps its own permanently). */
const MAX_DELETION_MARKERS = 5000;

export type KhatmaErrorKind = 'not_found' | 'not_eligible' | 'stale';
export class KhatmaError extends Error {
  constructor(public readonly kind: KhatmaErrorKind) {
    super(`Khatma: ${kind}`);
    this.name = 'KhatmaError';
  }
}

type Clock = { now?: () => Date; newId?: () => string };

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isDate = (value: unknown): value is string => isText(value) && !Number.isNaN(Date.parse(value));
const isPage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MUSHAF_PAGE_COUNT;

function parseCycle(value: unknown): ReadingCycle | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (!isText(c.id) || !isDate(c.startedAt) || !isPage(c.lastSavedPage)) return null;
  if (c.reachedEndAt !== null && !isDate(c.reachedEndAt)) return null;
  if (c.startedByKhatmaId !== null && !isText(c.startedByKhatmaId)) return null;
  if (typeof c.savedSinceStart !== 'boolean') return null;
  const cycle: ReadingCycle = {
    id: c.id, startedAt: c.startedAt, lastSavedPage: c.lastSavedPage, reachedEndAt: c.reachedEndAt,
    startedByKhatmaId: c.startedByKhatmaId, savedSinceStart: c.savedSinceStart,
  };
  if (isPage(c.pendingPage)) cycle.pendingPage = c.pendingPage;
  if (typeof c.seq === 'number' && Number.isInteger(c.seq) && c.seq >= 0) cycle.seq = c.seq;
  if (isText(c.undoneCycleId)) cycle.undoneCycleId = c.undoneCycleId;
  return cycle;
}

function parseDeletionMarkers(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => entry[0].length > 0 && entry[0].length <= 128 && isDate(entry[1]));
  return Object.fromEntries(entries.sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, MAX_DELETION_MARKERS));
}

export function parseRecord(value: unknown): KhatmaRecord | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (!isText(r.id) || !isText(r.stopId) || !isText(r.stopName) || !isText(r.cycleId) || !isDate(r.cycleStartedAt)) return null;
  if (r.previousStartedByKhatmaId !== null && !isText(r.previousStartedByKhatmaId)) return null;
  if (!isDate(r.completedAt) || typeof r.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.localDate)) return null;
  if (typeof r.ramadan !== 'boolean') return null;
  if (r.ramadanHijriYear !== null && typeof r.ramadanHijriYear !== 'number') return null;
  return {
    id: r.id, stopId: r.stopId, stopName: r.stopName, cycleId: r.cycleId, cycleStartedAt: r.cycleStartedAt,
    previousStartedByKhatmaId: r.previousStartedByKhatmaId, completedAt: r.completedAt, localDate: r.localDate,
    ramadan: r.ramadan, ramadanHijriYear: r.ramadanHijriYear,
  };
}

/** Malformed entries are dropped; never throws (an unreadable document reads as empty). */
export function parseKhatmaDocument(raw: unknown): KhatmaDocument {
  const empty: KhatmaDocument = { schema: 1, cycles: {}, records: [], deletedStops: {}, deletedRecords: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const doc = raw as Record<string, unknown>;
  const cycles: Record<string, ReadingCycle> = {};
  if (doc.cycles && typeof doc.cycles === 'object' && !Array.isArray(doc.cycles)) {
    for (const [stopId, value] of Object.entries(doc.cycles as Record<string, unknown>)) {
      const cycle = parseCycle(value);
      if (cycle) cycles[stopId] = cycle;
    }
  }
  const seen = new Set<string>();
  const records: KhatmaRecord[] = [];
  for (const value of Array.isArray(doc.records) ? doc.records : []) {
    const record = parseRecord(value);
    // One record per cycle, whatever was stored.
    if (record && !seen.has(record.id) && !seen.has(`cycle:${record.cycleId}`)) {
      seen.add(record.id);
      seen.add(`cycle:${record.cycleId}`);
      records.push(record);
    }
  }
  return { schema: 1, cycles, records, deletedStops: parseDeletionMarkers(doc.deletedStops), deletedRecords: parseDeletionMarkers(doc.deletedRecords) };
}

async function readDocument(owner: string | null): Promise<KhatmaDocument> {
  try {
    const raw = await AsyncStorage.getItem(khatmasKey(owner));
    return raw === null ? parseKhatmaDocument(null) : parseKhatmaDocument(JSON.parse(raw));
  } catch {
    return parseKhatmaDocument(null);
  }
}

async function writeDocument(owner: string | null, doc: KhatmaDocument): Promise<void> {
  doc.deletedStops = parseDeletionMarkers(doc.deletedStops);
  doc.deletedRecords = parseDeletionMarkers(doc.deletedRecords);
  await AsyncStorage.setItem(khatmasKey(owner), JSON.stringify(doc));
}

async function readStops(owner: string | null): Promise<ReadingStop[]> {
  try {
    const raw = await AsyncStorage.getItem(readingStopsKey(owner));
    return raw === null ? [] : parseReadingStops(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** A stop with no cycle on record (saved before this feature): its first cycle, with a stable id. */
function initialCycle(stop: ReadingStop): ReadingCycle {
  return { id: `first-${stop.id}`, startedAt: stop.updatedAt, lastSavedPage: stop.page, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: true, seq: 0 };
}

/** Catches a cycle up with its stop's saved page (a save made elsewhere, or by an interrupted write). */
function catchUp(cycle: ReadingCycle, stop: ReadingStop): ReadingCycle {
  if (cycle.pendingPage !== undefined || stop.page === cycle.lastSavedPage) return cycle;
  const reachedEnd = stop.page === MUSHAF_PAGE_COUNT && cycle.lastSavedPage < MUSHAF_PAGE_COUNT;
  return {
    ...cycle,
    lastSavedPage: stop.page,
    reachedEndAt: stop.page < MUSHAF_PAGE_COUNT ? null : reachedEnd ? stop.updatedAt : cycle.reachedEndAt,
    savedSinceStart: true,
  };
}

export function wirdStatus(stop: ReadingStop, cycle: ReadingCycle): WirdStatus {
  if (stop.page !== MUSHAF_PAGE_COUNT) return 'reading';
  return cycle.reachedEndAt ? 'pending' : 'unconfirmedEnd';
}

export const progressPercent = (page: number) => Math.floor((page / MUSHAF_PAGE_COUNT) * 100);

export function khatmaStats(records: readonly KhatmaRecord[]): KhatmaStats {
  const ramadan = records.filter((record) => record.ramadan).length;
  return { total: records.length, ramadan, nonRamadan: records.length - ramadan };
}

/**
 * Loads an owner's stops and document, finishing any interrupted
 * confirmation or undo (`pendingPage`) and catching cycles up with their
 * stops. Writes only when something had to be repaired. Inside the lock.
 */
async function loadRepaired(owner: string | null): Promise<{ stops: ReadingStop[]; doc: KhatmaDocument }> {
  let stops = await readStops(owner);
  const doc = await readDocument(owner);
  let stopsChanged = false;
  let docChanged = false;
  for (const stop of stops) {
    const stored = doc.cycles[stop.id];
    if (stored?.pendingPage !== undefined) {
      const page = stored.pendingPage;
      if (stop.page !== page) {
        stops = stops.map((s) => (s.id === stop.id ? stopAtPage(s, page) : s));
        stopsChanged = true;
      }
      const { pendingPage: _done, ...rest } = stored;
      doc.cycles[stop.id] = rest;
      docChanged = true;
      continue;
    }
    const cycle = stored ?? initialCycle(stop);
    const caughtUp = catchUp(cycle, stop);
    if (stored && caughtUp !== stored) {
      doc.cycles[stop.id] = caughtUp;
      docChanged = true;
    } else if (!stored) {
      doc.cycles[stop.id] = caughtUp;
      if (caughtUp !== cycle) docChanged = true;
    }
  }
  // Stops first: a crash between the two leaves `pendingPage` set, and the next load repeats this.
  if (stopsChanged) await persistReadingStops(owner, stops);
  if (docChanged) await writeDocument(owner, doc);
  return { stops, doc };
}

function toReadingData(owner: string | null, stops: ReadingStop[], doc: KhatmaDocument, activeStopId: string | null): ReadingData {
  const counts = new Map<string, number>();
  for (const record of doc.records) counts.set(record.stopId, (counts.get(record.stopId) ?? 0) + 1);
  const wirds = stops.map((stop) => {
    const cycle = doc.cycles[stop.id] ?? initialCycle(stop);
    return { stop, cycle, status: wirdStatus(stop, cycle), percent: progressPercent(stop.page), khatmas: counts.get(stop.id) ?? 0 };
  });
  const records = [...doc.records].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return { owner, stops, activeStopId: stops.some((stop) => stop.id === activeStopId) ? activeStopId : null, wirds, records, stats: khatmaStats(records) };
}

/** Everything أورادي وختماتي, Home and the reader show, for the active owner (or `ownerUserId`). */
export function loadReadingData(ownerUserId?: string | null): Promise<ReadingData> {
  return withReadingLock(async () => {
    const owner = await readingOwner(ownerUserId);
    const { stops, doc } = await loadRepaired(owner);
    return toReadingData(owner, stops, doc, await loadActiveReadingStopId(owner));
  });
}

/** A new ورد on `page` (1 by default). A name already in use (any case) is refused: creating never moves another stop. */
export async function createWird(input: { name: string; page?: number }, clock: Clock = {}): Promise<ReadingStop> {
  const created = await withReadingLock(async () => {
    const owner = await readingOwner();
    const name = normalizeReadingStopName(input.name);
    if (!name) throw new ReadingStopError('invalid_name');
    const { stops, doc } = await loadRepaired(owner);
    if (stops.some((stop) => stop.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new ReadingStopError('name_taken');
    const page = input.page ?? 1;
    const [created] = await saveReadingStopUnlocked({ name, page }, { ...clock, owner });
    doc.cycles[created.id] = { id: (clock.newId ?? defaultId)(), startedAt: created.updatedAt, lastSavedPage: page, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: false, seq: 0 };
    await writeDocument(owner, doc);
    await writeActiveReadingStop(owner, created.id);
    notifyReadingDataChanged();
    return created;
  });
  notifyLocalReadingChange();
  return created;
}

/**
 * The reader's explicit save (the bookmark): saves or moves the stop named
 * `name` to `page`, and makes it the active one. `reachedEnd` is true only
 * when this save took an existing stop from an earlier page to page 604.
 * `ayahKey`: saved from that ayah's number (Apply to the ورد); without it the
 * position is the page alone, and any ayah saved before is cleared.
 */
export async function saveWirdPage(input: { name: string; page: number; ayahKey?: string | null }, clock: Clock = {}): Promise<{ stops: ReadingStop[]; stop: ReadingStop; reachedEnd: boolean; cycleId: string }> {
  const saved = await withReadingLock(async () => {
    const owner = await readingOwner();
    const { stops: before, doc } = await loadRepaired(owner);
    const name = normalizeReadingStopName(input.name);
    const previous = name ? before.find((stop) => stop.name.toLocaleLowerCase() === name.toLocaleLowerCase()) : undefined;
    const stops = await saveReadingStopUnlocked(input, { ...clock, owner });
    const stop = stops[0];
    const cycle = previous
      ? catchUp(doc.cycles[stop.id] ?? initialCycle(previous), stop)
      : { id: (clock.newId ?? defaultId)(), startedAt: stop.updatedAt, lastSavedPage: stop.page, reachedEndAt: null, startedByKhatmaId: null, savedSinceStart: false, seq: 0 };
    doc.cycles[stop.id] = cycle;
    await writeDocument(owner, doc);
    await writeActiveReadingStop(owner, stop.id);
    notifyReadingDataChanged();
    const reachedEnd = previous !== undefined && previous.page < MUSHAF_PAGE_COUNT && wirdStatus(stop, cycle) === 'pending';
    return { stops, stop, reachedEnd, cycleId: cycle.id };
  });
  notifyLocalReadingChange();
  return saved;
}

/**
 * Records the completed Khatma of `stopId`'s cycle `cycleId` and starts its
 * next cycle at page 1. Idempotent: if that cycle is already recorded, the
 * existing record is returned and nothing changes. `unconfirmedEnd` stops
 * need `acceptUnconfirmedEnd` (the reader's separate, explicit choice).
 */
export async function confirmKhatma(stopId: string, cycleId: string, options: Clock & { acceptUnconfirmedEnd?: boolean } = {}): Promise<{ record: KhatmaRecord; alreadyRecorded: boolean }> {
  const confirmed = await withReadingLock(async () => {
    const owner = await readingOwner();
    const { stops, doc } = await loadRepaired(owner);
    const existing = doc.records.find((record) => record.cycleId === cycleId && record.stopId === stopId);
    if (existing) return { record: existing, alreadyRecorded: true };
    const stop = stops.find((s) => s.id === stopId);
    if (!stop) throw new KhatmaError('not_found');
    const cycle = doc.cycles[stop.id] ?? initialCycle(stop);
    if (cycle.id !== cycleId) throw new KhatmaError('stale');
    const status = wirdStatus(stop, cycle);
    if (status === 'reading' || (status === 'unconfirmedEnd' && !options.acceptUnconfirmedEnd)) throw new KhatmaError('not_eligible');

    const at = (options.now ?? (() => new Date()))();
    const localDate = localCivilDate(at);
    const ramadan = classifyRamadan(localDate);
    const record: KhatmaRecord = {
      id: khatmaRecordId(cycle.id, doc),
      stopId: stop.id,
      stopName: stop.name,
      cycleId: cycle.id,
      cycleStartedAt: cycle.startedAt,
      previousStartedByKhatmaId: cycle.startedByKhatmaId,
      completedAt: at.toISOString(),
      localDate,
      ramadan: ramadan.ramadan,
      ramadanHijriYear: ramadan.hijriYear,
    };
    const next: ReadingCycle = { id: (options.newId ?? defaultId)(), startedAt: record.completedAt, lastSavedPage: 1, reachedEndAt: null, startedByKhatmaId: record.id, savedSinceStart: false, seq: (cycle.seq ?? 0) + 1 };
    // 1. The record and the new cycle, together; the stop's page is still pending.
    doc.records.push(record);
    doc.cycles[stop.id] = { ...next, pendingPage: 1 };
    await writeDocument(owner, doc);
    // 2. The stop back to page 1. 3. Done.
    await persistReadingStops(owner, stops.map((s) => (s.id === stop.id ? stopAtPage(s, 1, record.completedAt) : s)));
    doc.cycles[stop.id] = next;
    await writeDocument(owner, doc);
    notifyReadingDataChanged();
    return { record, alreadyRecorded: false };
  });
  if (!confirmed.alreadyRecorded) notifyLocalReadingChange();
  return confirmed;
}

/**
 * A cycle's Khatma id: `khatma-<cycle id>`, so retries and repeated taps
 * can never count it twice. If that id was removed (an undone mistaken
 * confirmation) and the cycle is confirmed again, the next free
 * `khatma-<cycle id>-<n>`: a removed record is never brought back, here or
 * on the account. Every device derives the same id from the same history.
 */
function khatmaRecordId(cycleId: string, doc: KhatmaDocument): string {
  const taken = (id: string) => id in doc.deletedRecords || doc.records.some((record) => record.id === id);
  const base = `khatma-${cycleId}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n += 1) if (!taken(`${base}-${n}`)) return `${base}-${n}`;
}

/**
 * Removes a mistaken Khatma record. When it began its stop's current cycle
 * and the stop has not been saved since, that stop returns to page 604 with
 * the completion pending again ('restored'); otherwise the stop's progress
 * is left as it is ('kept'). Other stops and records are never touched.
 */
export async function removeKhatma(recordId: string, clock: Pick<Clock, 'now'> = {}): Promise<'restored' | 'kept'> {
  const outcome = await withReadingLock(async () => {
    const owner = await readingOwner();
    const { stops, doc } = await loadRepaired(owner);
    const record = doc.records.find((r) => r.id === recordId);
    if (!record) throw new KhatmaError('not_found');
    doc.records = doc.records.filter((r) => r.id !== recordId);
    doc.deletedRecords[recordId] = (clock.now ?? (() => new Date()))().toISOString();
    const stop = stops.find((s) => s.id === record.stopId);
    const cycle = stop ? doc.cycles[stop.id] : undefined;
    const restore = stop !== undefined && cycle !== undefined && cycle.startedByKhatmaId === record.id && !cycle.savedSinceStart && stop.page === 1;
    if (!restore) {
      await writeDocument(owner, doc);
      notifyReadingDataChanged();
      return 'kept' as const;
    }
    const restored: ReadingCycle = {
      id: record.cycleId,
      startedAt: record.cycleStartedAt,
      lastSavedPage: MUSHAF_PAGE_COUNT,
      reachedEndAt: record.completedAt,
      startedByKhatmaId: record.previousStartedByKhatmaId,
      savedSinceStart: true,
      seq: (cycle.seq ?? 0) + 1,
      undoneCycleId: cycle.id,
    };
    doc.cycles[stop.id] = { ...restored, pendingPage: MUSHAF_PAGE_COUNT };
    await writeDocument(owner, doc);
    await persistReadingStops(owner, stops.map((s) => (s.id === stop.id ? stopAtPage(s, MUSHAF_PAGE_COUNT) : s)));
    doc.cycles[stop.id] = restored;
    await writeDocument(owner, doc);
    notifyReadingDataChanged();
    return 'restored' as const;
  });
  notifyLocalReadingChange();
  return outcome;
}

/** Deletes a ورد and its current cycle. Its completed Khatmas stay in the history and totals. */
export async function deleteWird(stopId: string, clock: Pick<Clock, 'now'> = {}): Promise<void> {
  await withReadingLock(async () => {
    const owner = await readingOwner();
    const doc = await readDocument(owner);
    // The marker first: an interrupted deletion is still a deletion, never a lost stop.
    delete doc.cycles[stopId];
    doc.deletedStops[stopId] = (clock.now ?? (() => new Date()))().toISOString();
    await writeDocument(owner, doc);
    await removeReadingStopUnlocked(stopId, owner);
    notifyReadingDataChanged();
  });
  notifyLocalReadingChange();
}

// ── Guest data and accounts (storage/localDataOwnership.ts) ─────────────

/** Whether the guest partition holds reading stops or Khatmas to offer to an account. */
export async function guestHasReadingData(): Promise<boolean> {
  return withReadingLock(async () => (await readStops(null)).length > 0 || (await readDocument(null)).records.length > 0);
}

/** A strict read for moving data: null when stored but unreadable (it is then left exactly where it is). */
async function readStrict(key: string): Promise<unknown | null | 'unreadable'> {
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return 'unreadable';
  }
}

function uniqueName(name: string, taken: readonly ReadingStop[]): string {
  const used = (candidate: string) => taken.some((stop) => stop.name.toLocaleLowerCase() === candidate.toLocaleLowerCase());
  if (!used(name)) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${[...name].slice(0, READING_STOP_NAME_MAX_LENGTH - suffix.length).join('')}${suffix}`;
    if (!used(candidate)) return candidate;
  }
}

/**
 * Gives every ورد a distinct name (names are how a save finds its ورد),
 * deterministically, so every device that sees the same أوراد renames the
 * same ones the same way: within a group sharing a name (any case), the
 * stop with the smallest id keeps it and the others get a numbered one.
 * Returns the stops (unchanged objects where nothing changed).
 */
export function withDistinctNames(stops: readonly ReadingStop[]): ReadingStop[] {
  const byId = [...stops].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const kept: ReadingStop[] = [];
  const renamed = new Map<string, ReadingStop>();
  for (const stop of byId) {
    const clash = kept.find((other) => other.name.toLocaleLowerCase() === stop.name.toLocaleLowerCase());
    if (!clash) {
      kept.push(stop);
      continue;
    }
    const nameUpdatedAt = [clash.nameUpdatedAt, stop.nameUpdatedAt].filter((at): at is string => !!at).sort().at(-1);
    const next: ReadingStop = { ...stop, name: uniqueName(stop.name, [...kept, ...byId]) };
    if (nameUpdatedAt) next.nameUpdatedAt = nameUpdatedAt;
    kept.push(next);
    renamed.set(stop.id, next);
  }
  return renamed.size === 0 ? [...stops] : stops.map((stop) => renamed.get(stop.id) ?? stop);
}

/**
 * "Add to this account": moves the guest partition's stops, cycles,
 * Khatmas and deletion markers into `userId`'s. Nothing is overwritten:
 *  - a guest stop whose name the account already uses gets a numbered name;
 *  - a guest stop whose id the account already uses (not expected: ids are
 *    random) gets a new id, with its cycle and Khatmas moved along, so it
 *    is added, never merged into or replacing the account's;
 *  - records are kept by id, one per cycle.
 * When signed in, the next sync uploads what was added. The guest copies
 * are removed only after the merged data is written, so an interrupted
 * merge repeats safely. Returns false (moving nothing) when the guest data
 * cannot be read.
 */
export function adoptGuestReadingData(userId: string): Promise<boolean> {
  return withReadingLock(async () => {
    const guestStopsRaw = await readStrict(READING_STOPS_STORAGE_KEY);
    const guestDocRaw = await readStrict(KHATMAS_STORAGE_KEY);
    if (guestStopsRaw === 'unreadable' || guestDocRaw === 'unreadable') return false;
    const guestActive = await AsyncStorage.getItem(ACTIVE_READING_STOP_STORAGE_KEY);
    const guestActiveAt = await AsyncStorage.getItem(ACTIVE_READING_STOP_AT_STORAGE_KEY);
    const removeGuest = async () => {
      await AsyncStorage.removeItem(READING_STOPS_STORAGE_KEY);
      await AsyncStorage.removeItem(KHATMAS_STORAGE_KEY);
      await AsyncStorage.removeItem(ACTIVE_READING_STOP_STORAGE_KEY);
      await AsyncStorage.removeItem(ACTIVE_READING_STOP_AT_STORAGE_KEY);
    };
    if (guestStopsRaw === null && guestDocRaw === null) {
      await removeGuest();
      return true;
    }
    const guestStops = parseReadingStops(guestStopsRaw);
    const guestDoc = parseKhatmaDocument(guestDocRaw);
    const { stops: accountStops, doc: accountDoc } = await loadRepaired(userId);

    const merged = [...accountStops];
    const newIds = new Map<string, string>();
    for (const stop of guestStops) {
      let id = stop.id;
      if (merged.some((s) => s.id === id) || id in accountDoc.deletedStops) {
        id = defaultId();
        newIds.set(stop.id, id);
      }
      merged.push({ ...stop, id, name: uniqueName(stop.name, merged) });
      const cycle = guestDoc.cycles[stop.id];
      if (cycle && !accountDoc.cycles[id]) accountDoc.cycles[id] = cycle;
    }
    const ids = new Set(accountDoc.records.map((record) => record.id));
    const cycles = new Set(accountDoc.records.map((record) => record.cycleId));
    for (const record of guestDoc.records) {
      if (ids.has(record.id) || cycles.has(record.cycleId) || record.id in accountDoc.deletedRecords) continue;
      accountDoc.records.push({ ...record, stopId: newIds.get(record.stopId) ?? record.stopId });
    }
    // The guest's own removals: so a re-confirmed cycle never takes back a removed id.
    accountDoc.deletedRecords = { ...guestDoc.deletedRecords, ...accountDoc.deletedRecords };

    await persistReadingStops(userId, merged);
    await writeDocument(userId, accountDoc);
    const active = guestActive ? (newIds.get(guestActive) ?? guestActive) : null;
    if ((await AsyncStorage.getItem(activeReadingStopKey(userId))) === null && active && merged.some((s) => s.id === active)) {
      await writeActiveReadingStop(userId, active, guestActiveAt && !Number.isNaN(Date.parse(guestActiveAt)) ? guestActiveAt : new Date().toISOString());
    }
    await removeGuest();
    notifyReadingDataChanged();
    return true;
  });
}

/** Account deletion: that account's stops, active stop, Khatmas and sync state on this device. Guest data and other accounts are untouched. */
export function clearAccountReadingData(userId: string): Promise<void> {
  return withReadingLock(async () => {
    await AsyncStorage.removeItem(readingStopsKey(userId));
    await AsyncStorage.removeItem(activeReadingStopKey(userId));
    await AsyncStorage.removeItem(activeReadingStopAtKey(userId));
    await AsyncStorage.removeItem(khatmasKey(userId));
    await AsyncStorage.removeItem(ownerStorageKey(READING_SYNC_STORAGE_KEY, userId));
    await AsyncStorage.removeItem(ownerStorageKey(LEGACY_READING_SYNC_STORAGE_KEY, userId));
    notifyReadingDataChanged();
  });
}

// ── Sync (sync/readingSync.ts) ───────────────────────────────────────────

/** One owner's whole reading data, as sync reads and replaces it. */
export type ReadingSnapshot = {
  stops: ReadingStop[];
  cycles: Record<string, ReadingCycle>;
  records: KhatmaRecord[];
  deletedStops: Record<string, string>;
  deletedRecords: Record<string, string>;
  activeStopId: string | null;
  activeChangedAt: string | null;
};

async function readSnapshot(owner: string | null): Promise<ReadingSnapshot> {
  const { stops, doc } = await loadRepaired(owner);
  return {
    stops,
    cycles: doc.cycles,
    records: doc.records,
    deletedStops: doc.deletedStops,
    deletedRecords: doc.deletedRecords,
    activeStopId: await loadActiveReadingStopId(owner),
    activeChangedAt: await loadActiveReadingStopChangedAt(owner),
  };
}

/** `owner`'s reading data, repaired, read inside the lock. */
export function readReadingSnapshot(owner: string | null): Promise<ReadingSnapshot> {
  return withReadingLock(() => readSnapshot(owner));
}

/**
 * Reads `owner`'s data, lets `change` edit the snapshot in place, and
 * writes it back if `change` returns true — all inside the reading lock,
 * so no user edit can interleave. Writes like a confirmation: cycles first,
 * each changed stop's page marked pending (loadRepaired finishes an
 * interrupted write and never mistakes it for a save to page 604), then
 * the stops, then the cycles again. Applying downloaded data is not a user
 * change: it never notifies notifyLocalReadingChange (no upload loop).
 */
export function updateReadingSnapshot<T>(owner: string | null, change: (snapshot: ReadingSnapshot) => { changed: boolean; result: T }): Promise<T> {
  return withReadingLock(async () => {
    const before = await readSnapshot(owner);
    const snapshot: ReadingSnapshot = structuredClone(before);
    const { changed, result } = change(snapshot);
    if (!changed) return result;
    // Distinct names first: parsing keeps only the newest stop of each name.
    const stops = parseReadingStops(withDistinctNames(snapshot.stops));
    const pageBefore = new Map(before.stops.map((stop) => [stop.id, stop.page]));
    const doc: KhatmaDocument = {
      schema: 1,
      cycles: Object.fromEntries(Object.entries(snapshot.cycles).filter(([id]) => stops.some((stop) => stop.id === id))),
      records: parseKhatmaDocument({ records: snapshot.records }).records,
      deletedStops: snapshot.deletedStops,
      deletedRecords: snapshot.deletedRecords,
    };
    const marked = structuredClone(doc);
    for (const stop of stops) {
      if (marked.cycles[stop.id] && pageBefore.get(stop.id) !== undefined && pageBefore.get(stop.id) !== stop.page) {
        marked.cycles[stop.id] = { ...marked.cycles[stop.id], pendingPage: stop.page };
      }
    }
    await writeDocument(owner, marked);
    await persistReadingStops(owner, stops);
    await writeDocument(owner, doc);
    const activeStopId = snapshot.activeStopId && stops.some((stop) => stop.id === snapshot.activeStopId) ? snapshot.activeStopId : null;
    if (activeStopId !== before.activeStopId || snapshot.activeChangedAt !== before.activeChangedAt) {
      await writeActiveReadingStop(owner, activeStopId, snapshot.activeChangedAt);
    }
    notifyReadingDataChanged();
    return result;
  });
}
