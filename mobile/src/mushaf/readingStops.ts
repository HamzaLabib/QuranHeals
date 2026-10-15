import AsyncStorage from '@react-native-async-storage/async-storage';

import { notifyLocalReadingChange } from '@/storage/localChanges';
import { getActiveLocalOwner, ownerStorageKey } from '@/storage/localDataOwner';

import { MUSHAF_PAGE_COUNT } from './mushafPage';
import { isWirdAyahOnPage } from './wirdAyah';

/**
 * Reading stops (أورادي): named page bookmarks — "Mum", "Ramadan" — so
 * several readers or reading plans on one device each keep their place. A
 * stop records a page; when it was saved from an ayah's number (Apply to the
 * ورد), also that ayah (`ayahKey`, wirdAyah.ts), which the reader marks in
 * gold. Any other save, or a change of page, drops it. A guest's stay on the device;
 * a signed-in account's sync with the account (no Sync Password) between its devices
 * (sync/readingSync.ts, docs/auth-and-sync/reading-sync.md).
 *
 * Stored per owner like favorites and reflections (storage/localDataOwner.ts):
 * the keys below are the guest partition (so stops saved before partitioning
 * stay guest data, unchanged), and each account that signed in on this
 * device has its own copy under `<key>:account:<userId>`. Every function
 * uses the active owner unless an explicit `ownerUserId` is given.
 *
 * Saving under a name that already exists (any case) moves that stop to the
 * new page. Renaming changes only that stop's name, and is refused if
 * another stop already uses the new name, so a rename never merges or
 * overwrites someone else's place.
 *
 * One stop can be the active one (the reader's ورد selector): only its id is
 * stored, separately. Choosing a stop never changes any stop's page — a page
 * is saved only when the reader explicitly saves one. Reading cycles and
 * completed Khatmas are kept beside the stops, by stop id (khatmas.ts).
 */
export type ReadingStop = {
  id: string;
  name: string;
  page: number;
  /** ISO timestamp of the last time the stop was saved (not renamed). */
  updatedAt: string;
  /** ISO timestamp of the last time its name was set (created or renamed); absent on stops from before sync. Resolves concurrent renames. */
  nameUpdatedAt?: string;
  /**
   * The ayah whose number was applied on `page` ("2:255"), or absent: a page-only position. Not phase 1's `verseKey`
   * (still dropped on reading), so a position saved then never comes back as an ayah.
   */
  ayahKey?: string;
};

/** Unchanged from phase 1; stops saved then with an ayah are read as page-only. */
export const READING_STOPS_STORAGE_KEY = 'quran-heals:mushaf-reading-stops:v1';
/** The id of the active stop (the ورد being read), or nothing. */
export const ACTIVE_READING_STOP_STORAGE_KEY = 'quran-heals:mushaf-active-reading-stop:v1';
/** When the active stop was last chosen on this device (ISO), so two devices' choices resolve by time. A separate key: the id's format is unchanged. */
export const ACTIVE_READING_STOP_AT_STORAGE_KEY = 'quran-heals:mushaf-active-reading-stop-at:v1';
export const READING_STOP_NAME_MAX_LENGTH = 40;
/**
 * Not a product limit — a storage safeguard so a runaway loop or corrupted
 * input can never grow the stored list without bound (~500 × 100 bytes).
 */
export const MAX_READING_STOPS = 500;

export type ReadingStopErrorKind = 'invalid_name' | 'invalid_page' | 'invalid_ayah' | 'name_taken' | 'not_found' | 'too_many';

export class ReadingStopError extends Error {
  constructor(public readonly kind: ReadingStopErrorKind) {
    super(`Invalid reading stop: ${kind}`);
    this.name = 'ReadingStopError';
  }
}

/** Trimmed, inner whitespace collapsed, control characters removed; null if empty or too long. */
export function normalizeReadingStopName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (name.length === 0 || [...name].length > READING_STOP_NAME_MAX_LENGTH) return null;
  return name;
}

const sameName = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function isValidPage(page: unknown): page is number {
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= MUSHAF_PAGE_COUNT;
}

/** Validates a stored payload; malformed entries are dropped, duplicate names keep the newest. Never throws. */
export function parseReadingStops(raw: unknown): ReadingStop[] {
  if (!Array.isArray(raw)) return [];
  const stops: ReadingStop[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Partial<ReadingStop>;
    const name = normalizeReadingStopName(candidate.name);
    if (typeof candidate.id !== 'string' || !candidate.id || !name || !isValidPage(candidate.page)) continue;
    if (typeof candidate.updatedAt !== 'string' || Number.isNaN(Date.parse(candidate.updatedAt))) continue;
    // Any other stored field (e.g. phase 1's `verseKey`) is dropped.
    const stop: ReadingStop = { id: candidate.id, name, page: candidate.page, updatedAt: candidate.updatedAt };
    if (typeof candidate.nameUpdatedAt === 'string' && !Number.isNaN(Date.parse(candidate.nameUpdatedAt))) stop.nameUpdatedAt = candidate.nameUpdatedAt;
    // An ayah whose number isn't on the stop's page is dropped: the page stays the position.
    if (isWirdAyahOnPage(candidate.ayahKey, stop.page)) stop.ayahKey = candidate.ayahKey;
    stops.push(stop);
  }
  const newestFirst = stops.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return newestFirst
    .filter((stop, index) => newestFirst.findIndex((other) => sameName(other.name, stop.name) || other.id === stop.id) === index)
    .slice(0, MAX_READING_STOPS);
}

/** The owner whose partition an operation uses: `ownerUserId` when given (null = guest), otherwise the active one. */
export async function readingOwner(ownerUserId?: string | null): Promise<string | null> {
  return ownerUserId === undefined ? getActiveLocalOwner() : ownerUserId;
}
export const readingStopsKey = (owner: string | null) => ownerStorageKey(READING_STOPS_STORAGE_KEY, owner);
export const activeReadingStopKey = (owner: string | null) => ownerStorageKey(ACTIVE_READING_STOP_STORAGE_KEY, owner);
export const activeReadingStopAtKey = (owner: string | null) => ownerStorageKey(ACTIVE_READING_STOP_AT_STORAGE_KEY, owner);

/**
 * Every read-modify-write of reading data (stops, the active stop, cycles
 * and Khatmas) runs one at a time, so two quick taps can never interleave
 * and lose a write.
 */
let chain: Promise<unknown> = Promise.resolve();
export function withReadingLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = chain.then(operation, operation);
  chain = result.catch(() => undefined);
  return result;
}

const listeners = new Set<() => void>();
/** Called after every change to reading data (by any screen): Home, the reader and أورادي وختماتي reload. */
export function subscribeToReadingData(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function notifyReadingDataChanged(): void {
  listeners.forEach((listener) => listener());
}

export async function loadReadingStops(ownerUserId?: string | null): Promise<ReadingStop[]> {
  try {
    const raw = await AsyncStorage.getItem(readingStopsKey(await readingOwner(ownerUserId)));
    return raw === null ? [] : parseReadingStops(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Writes `owner`'s whole list (khatmas.ts uses it inside withReadingLock). */
export async function persistReadingStops(owner: string | null, stops: readonly ReadingStop[]): Promise<void> {
  await AsyncStorage.setItem(readingStopsKey(owner), JSON.stringify(stops));
}

/** `ayahKey`: the ayah whose number was applied (its number must be on `page`); omitted, the save is page-only and clears any. */
export type SaveReadingStopInput = { name: string; page: number; ayahKey?: string | null };
type Options = { now?: () => Date; newId?: () => string };

/** Saves (or moves) the stop with this name to `page`. Returns the updated list, newest first. */
export async function saveReadingStop(input: SaveReadingStopInput, options: Options = {}): Promise<ReadingStop[]> {
  const stops = await withReadingLock(() => saveReadingStopUnlocked(input, options));
  notifyLocalReadingChange();
  return stops;
}

/** saveReadingStop for callers already inside withReadingLock (khatmas.ts). */
export async function saveReadingStopUnlocked(input: SaveReadingStopInput, options: Options & { owner?: string | null } = {}): Promise<ReadingStop[]> {
  const name = normalizeReadingStopName(input.name);
  if (!name) throw new ReadingStopError('invalid_name');
  if (!isValidPage(input.page)) throw new ReadingStopError('invalid_page');
  if (input.ayahKey != null && !isWirdAyahOnPage(input.ayahKey, input.page)) throw new ReadingStopError('invalid_ayah');

  const owner = await readingOwner(options.owner);
  const stops = await loadReadingStops(owner);
  const existing = stops.find((stop) => sameName(stop.name, name));
  if (!existing && stops.length >= MAX_READING_STOPS) throw new ReadingStopError('too_many');
  const at = (options.now ?? (() => new Date()))().toISOString();
  const saved: ReadingStop = {
    id: existing?.id ?? (options.newId ?? defaultId)(),
    name,
    page: input.page,
    updatedAt: at,
  };
  if (input.ayahKey != null) saved.ayahKey = input.ayahKey;
  // A new stop, or the same name typed differently: its name was set now.
  const nameUpdatedAt = existing && existing.name === name ? existing.nameUpdatedAt : at;
  if (nameUpdatedAt) saved.nameUpdatedAt = nameUpdatedAt;
  const next = [saved, ...stops.filter((stop) => stop !== existing)];
  await persistReadingStops(owner, next);
  notifyReadingDataChanged();
  return next;
}

/** The stop moved to `page` (a Khatma's return to page 1, its undo to 604): page-only, its ayah dropped. */
export function stopAtPage(stop: ReadingStop, page: number, updatedAt?: string): ReadingStop {
  const { ayahKey: _dropped, ...rest } = stop;
  return updatedAt === undefined ? { ...rest, page } : { ...rest, page, updatedAt };
}

/** Renames one stop; its page, position and every other stop are unchanged. */
export async function renameReadingStop(id: string, newName: string, options: Pick<Options, 'now'> = {}): Promise<ReadingStop[]> {
  const stops = await withReadingLock(async () => {
    const name = normalizeReadingStopName(newName);
    if (!name) throw new ReadingStopError('invalid_name');
    const owner = await readingOwner();
    const stops = await loadReadingStops(owner);
    const target = stops.find((stop) => stop.id === id);
    if (!target) throw new ReadingStopError('not_found');
    if (stops.some((stop) => stop.id !== id && sameName(stop.name, name))) throw new ReadingStopError('name_taken');
    const nameUpdatedAt = (options.now ?? (() => new Date()))().toISOString();
    const next = stops.map((stop) => (stop.id === id ? { ...stop, name, nameUpdatedAt } : stop));
    await persistReadingStops(owner, next);
    notifyReadingDataChanged();
    return next;
  });
  notifyLocalReadingChange();
  return stops;
}

/** Removes one stop (khatmas.ts's deleteWird also drops its cycle; its completed Khatmas stay in the history). */
export async function removeReadingStop(id: string): Promise<ReadingStop[]> {
  const stops = await withReadingLock(() => removeReadingStopUnlocked(id));
  notifyLocalReadingChange();
  return stops;
}

export async function removeReadingStopUnlocked(id: string, ownerUserId?: string | null): Promise<ReadingStop[]> {
  const owner = await readingOwner(ownerUserId);
  const next = (await loadReadingStops(owner)).filter((stop) => stop.id !== id);
  await persistReadingStops(owner, next);
  if ((await loadActiveReadingStopId(owner)) === id) await writeActiveReadingStop(owner, null);
  notifyReadingDataChanged();
  return next;
}

/** The active stop's id as stored; it may name a stop that no longer exists (see activeReadingStop). Never throws. */
export async function loadActiveReadingStopId(ownerUserId?: string | null): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(activeReadingStopKey(await readingOwner(ownerUserId)));
    return id && id.length <= 100 ? id : null;
  } catch {
    return null;
  }
}

/** When the active stop was last chosen (ISO), or null if never recorded. Never throws. */
export async function loadActiveReadingStopChangedAt(ownerUserId?: string | null): Promise<string | null> {
  try {
    const at = await AsyncStorage.getItem(activeReadingStopAtKey(await readingOwner(ownerUserId)));
    return at && !Number.isNaN(Date.parse(at)) ? at : null;
  } catch {
    return null;
  }
}

/**
 * Sets `owner`'s active stop (null: none), recording when it was chosen.
 * Inside withReadingLock. Does nothing when it is already the active one,
 * so re-saving the same ورد never looks like a new choice. `at` is given
 * only when applying another device's choice (sync).
 */
export async function writeActiveReadingStop(owner: string | null, id: string | null, at?: string | null): Promise<void> {
  if (at === undefined && (await loadActiveReadingStopId(owner)) === id) return;
  if (id === null) await AsyncStorage.removeItem(activeReadingStopKey(owner));
  else await AsyncStorage.setItem(activeReadingStopKey(owner), id);
  const changedAt = at === undefined ? new Date().toISOString() : at;
  if (changedAt === null) await AsyncStorage.removeItem(activeReadingStopAtKey(owner));
  else await AsyncStorage.setItem(activeReadingStopAtKey(owner), changedAt);
}

/** Makes a stop the active one (null: none). Changes no stop. */
export async function setActiveReadingStopId(id: string | null): Promise<void> {
  await withReadingLock(async () => {
    await writeActiveReadingStop(await readingOwner(), id);
    notifyReadingDataChanged();
  });
  notifyLocalReadingChange();
}

/** The active stop among `stops`, or null when none is set or it was removed. */
export function activeReadingStop(stops: readonly ReadingStop[], activeId: string | null): ReadingStop | null {
  return (activeId && stops.find((stop) => stop.id === activeId)) || null;
}

export function defaultId(): string {
  return `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
