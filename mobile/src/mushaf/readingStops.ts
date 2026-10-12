import AsyncStorage from '@react-native-async-storage/async-storage';

import { MUSHAF_PAGE_COUNT } from './mushafPage';

/**
 * Reading stops (Mushaf prototype): named page bookmarks — "Mum",
 * "Ramadan" — so several readers or reading plans on one device each keep
 * their place. A stop records a whole page, never an ayah. Device-local
 * only: never uploaded, synced or shared, and not yet split by
 * guest/account like reflections and favorites (a decision for the full
 * reader).
 *
 * Saving under a name that already exists (any case) moves that stop to the
 * new page. Renaming changes only that stop's name, and is refused if
 * another stop already uses the new name, so a rename never merges or
 * overwrites someone else's place.
 *
 * One stop can be the active one (the reader's ورد selector): only its id is
 * stored, separately. Choosing a stop never changes any stop's page — a page
 * is saved only when the reader explicitly saves one. Stops have no reading
 * progress or Khatma count yet.
 */
export type ReadingStop = {
  id: string;
  name: string;
  page: number;
  /** ISO timestamp of the last time the stop was saved (not renamed). */
  updatedAt: string;
};

/** Unchanged from phase 1; stops saved then with an ayah are read as page-only. */
export const READING_STOPS_STORAGE_KEY = 'quran-heals:mushaf-reading-stops:v1';
/** The id of the active stop (the ورد being read), or nothing. */
export const ACTIVE_READING_STOP_STORAGE_KEY = 'quran-heals:mushaf-active-reading-stop:v1';
export const READING_STOP_NAME_MAX_LENGTH = 40;
/**
 * Not a product limit — a storage safeguard so a runaway loop or corrupted
 * input can never grow the stored list without bound (~500 × 100 bytes).
 */
export const MAX_READING_STOPS = 500;

export type ReadingStopErrorKind = 'invalid_name' | 'invalid_page' | 'name_taken' | 'not_found' | 'too_many';

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
    stops.push({ id: candidate.id, name, page: candidate.page, updatedAt: candidate.updatedAt });
  }
  const newestFirst = stops.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return newestFirst
    .filter((stop, index) => newestFirst.findIndex((other) => sameName(other.name, stop.name) || other.id === stop.id) === index)
    .slice(0, MAX_READING_STOPS);
}

export async function loadReadingStops(): Promise<ReadingStop[]> {
  try {
    const raw = await AsyncStorage.getItem(READING_STOPS_STORAGE_KEY);
    return raw === null ? [] : parseReadingStops(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function persist(stops: ReadingStop[]): Promise<void> {
  await AsyncStorage.setItem(READING_STOPS_STORAGE_KEY, JSON.stringify(stops));
}

export type SaveReadingStopInput = { name: string; page: number };
type Options = { now?: () => Date; newId?: () => string };

/** Saves (or moves) the stop with this name to `page`. Returns the updated list, newest first. */
export async function saveReadingStop(input: SaveReadingStopInput, options: Options = {}): Promise<ReadingStop[]> {
  const name = normalizeReadingStopName(input.name);
  if (!name) throw new ReadingStopError('invalid_name');
  if (!isValidPage(input.page)) throw new ReadingStopError('invalid_page');

  const stops = await loadReadingStops();
  const existing = stops.find((stop) => sameName(stop.name, name));
  if (!existing && stops.length >= MAX_READING_STOPS) throw new ReadingStopError('too_many');
  const saved: ReadingStop = {
    id: existing?.id ?? (options.newId ?? defaultId)(),
    name,
    page: input.page,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  const next = [saved, ...stops.filter((stop) => stop !== existing)];
  await persist(next);
  return next;
}

/** Renames one stop; its page, position and every other stop are unchanged. */
export async function renameReadingStop(id: string, newName: string): Promise<ReadingStop[]> {
  const name = normalizeReadingStopName(newName);
  if (!name) throw new ReadingStopError('invalid_name');
  const stops = await loadReadingStops();
  const target = stops.find((stop) => stop.id === id);
  if (!target) throw new ReadingStopError('not_found');
  if (stops.some((stop) => stop.id !== id && sameName(stop.name, name))) throw new ReadingStopError('name_taken');
  const next = stops.map((stop) => (stop.id === id ? { ...stop, name } : stop));
  await persist(next);
  return next;
}

export async function removeReadingStop(id: string): Promise<ReadingStop[]> {
  const next = (await loadReadingStops()).filter((stop) => stop.id !== id);
  await persist(next);
  if ((await loadActiveReadingStopId()) === id) await setActiveReadingStopId(null);
  return next;
}

/** The active stop's id as stored; it may name a stop that no longer exists (see activeReadingStop). Never throws. */
export async function loadActiveReadingStopId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(ACTIVE_READING_STOP_STORAGE_KEY);
    return id && id.length <= 100 ? id : null;
  } catch {
    return null;
  }
}

/** Makes a stop the active one (null: none). Changes no stop. */
export async function setActiveReadingStopId(id: string | null): Promise<void> {
  if (id === null) await AsyncStorage.removeItem(ACTIVE_READING_STOP_STORAGE_KEY);
  else await AsyncStorage.setItem(ACTIVE_READING_STOP_STORAGE_KEY, id);
}

/** The active stop among `stops`, or null when none is set or it was removed. */
export function activeReadingStop(stops: readonly ReadingStop[], activeId: string | null): ReadingStop | null {
  return (activeId && stops.find((stop) => stop.id === activeId)) || null;
}

function defaultId(): string {
  return `stop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
