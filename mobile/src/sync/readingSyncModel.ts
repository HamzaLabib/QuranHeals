import { parseRecord, type KhatmaRecord, type ReadingCycle } from '@/mushaf/khatmas';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { normalizeReadingStopName, type ReadingStop } from '@/mushaf/readingStops';
import { isWirdAyahOnPage } from '@/mushaf/wirdAyah';

/**
 * أورادي وختماتي sync: what one record contains, and the deterministic rules
 * for combining two devices' versions of it. Pure functions, no storage or
 * network (sync/readingSync.ts does those). Design and the reasons for each
 * rule: docs/auth-and-sync/reading-sync.md.
 *
 * Account-based, like favorites (no Sync Password): each record's content
 * is sent as it is (over HTTPS, to the signed-in account only) and checked
 * again on arrival (parseContent). Three kinds of record:
 *  - 'wird': one ورد — its name, its saved page (and, when saved from an
 *    ayah's number, that ayah: `ayahKey`) and its current reading cycle
 *    (with the cycle's generation, `seq`).
 *  - 'khatma': one confirmed Khatma, exactly as recorded on the confirming
 *    device (its date and Ramadan classification never change afterwards).
 *  - 'active': which ورد is selected, and when it was chosen.
 * Counts are never synced: they are always computed from the Khatma
 * records (khatmas.ts's khatmaStats).
 */

export type SyncedCycle = {
  id: string;
  startedAt: string;
  lastSavedPage: number;
  reachedEndAt: string | null;
  startedByKhatmaId: string | null;
  savedSinceStart: boolean;
  seq: number;
  undoneCycleId: string | null;
};

export type WirdContent = {
  v: 1;
  kind: 'wird';
  id: string;
  name: string;
  nameUpdatedAt: string | null;
  page: number;
  /** When the page was last saved (the stop's updatedAt). */
  savedAt: string;
  cycle: SyncedCycle;
  /**
   * The ayah whose number was applied on `page`; absent (not null) for a page-only position, so page-only content is
   * exactly what earlier versions sent. Part of the position: it moves, wins and loses with `page` and `savedAt`.
   */
  ayahKey?: string;
};

export type KhatmaContent = { v: 1; kind: 'khatma' } & KhatmaRecord;

export type ActiveContent = { v: 1; kind: 'active'; id: 'active'; stopId: string | null; changedAt: string | null };

export type ReadingContent = WirdContent | KhatmaContent | ActiveContent;

const isDate = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const isPage = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MUSHAF_PAGE_COUNT;
const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);

// ── Local ↔ record ────────────────────────────────────────────────────────

/** A ورد as synced. The cycle's transient `pendingPage` is never synced. */
export function wirdContent(stop: ReadingStop, cycle: ReadingCycle): WirdContent {
  return {
    v: 1,
    kind: 'wird',
    id: stop.id,
    name: stop.name,
    nameUpdatedAt: stop.nameUpdatedAt ?? null,
    page: stop.page,
    savedAt: stop.updatedAt,
    cycle: {
      id: cycle.id,
      startedAt: cycle.startedAt,
      lastSavedPage: cycle.lastSavedPage,
      reachedEndAt: cycle.reachedEndAt,
      startedByKhatmaId: cycle.startedByKhatmaId,
      savedSinceStart: cycle.savedSinceStart,
      seq: cycle.seq ?? 0,
      undoneCycleId: cycle.undoneCycleId ?? null,
    },
    ...(stop.ayahKey && { ayahKey: stop.ayahKey }),
  };
}

/** The local stop and cycle for a synced ورد; the cycle always agrees with the page (never read as a new save to 604). */
export function wirdFromContent(content: WirdContent): { stop: ReadingStop; cycle: ReadingCycle } {
  const stop: ReadingStop = { id: content.id, name: content.name, page: content.page, updatedAt: content.savedAt };
  if (content.nameUpdatedAt) stop.nameUpdatedAt = content.nameUpdatedAt;
  if (content.ayahKey) stop.ayahKey = content.ayahKey;
  const { seq, undoneCycleId, ...rest } = content.cycle;
  const cycle: ReadingCycle = { ...rest, lastSavedPage: content.page, seq };
  if (undoneCycleId) cycle.undoneCycleId = undoneCycleId;
  return { stop, cycle };
}

export function khatmaContent(record: KhatmaRecord): KhatmaContent {
  return {
    v: 1, kind: 'khatma', id: record.id, stopId: record.stopId, stopName: record.stopName, cycleId: record.cycleId,
    cycleStartedAt: record.cycleStartedAt, previousStartedByKhatmaId: record.previousStartedByKhatmaId,
    completedAt: record.completedAt, localDate: record.localDate, ramadan: record.ramadan, ramadanHijriYear: record.ramadanHijriYear,
  };
}

export function khatmaFromContent(content: KhatmaContent): KhatmaRecord {
  const { v: _v, kind: _kind, ...record } = content;
  return record;
}

export function activeContent(stopId: string | null, changedAt: string | null): ActiveContent {
  return { v: 1, kind: 'active', id: 'active', stopId, changedAt };
}

/** Field-by-field equality of two contents (key order never matters). */
export function sameContent(a: ReadingContent | null | undefined, b: ReadingContent | null | undefined): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

// ── Validation of downloaded content ─────────────────────────────────────

function parseCycle(value: unknown): SyncedCycle | null {
  if (!value || typeof value !== 'object') return null;
  const c = value as Record<string, unknown>;
  if (!isId(c.id) || !isDate(c.startedAt) || !isPage(c.lastSavedPage) || typeof c.savedSinceStart !== 'boolean') return null;
  if (c.reachedEndAt !== null && !isDate(c.reachedEndAt)) return null;
  if (c.startedByKhatmaId !== null && !isId(c.startedByKhatmaId)) return null;
  if (typeof c.seq !== 'number' || !Number.isInteger(c.seq) || c.seq < 0) return null;
  if (c.undoneCycleId !== null && !isId(c.undoneCycleId)) return null;
  return {
    id: c.id, startedAt: c.startedAt, lastSavedPage: c.lastSavedPage, reachedEndAt: c.reachedEndAt,
    startedByKhatmaId: c.startedByKhatmaId, savedSinceStart: c.savedSinceStart, seq: c.seq, undoneCycleId: c.undoneCycleId,
  };
}

/** A downloaded record's content, checked to be of the expected kind and id; null if anything is wrong (never applied then). */
export function parseContent(kind: string, recordId: string, value: unknown): ReadingContent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const c = value as Record<string, unknown>;
  // Bound to its record: content moved from another record (or a reflection) is rejected.
  if (c.v !== 1 || c.kind !== kind || c.id !== recordId) return null;
  if (kind === 'wird') {
    const name = normalizeReadingStopName(c.name);
    const cycle = parseCycle(c.cycle);
    if (!name || name !== c.name || !isPage(c.page) || !isDate(c.savedAt) || !cycle) return null;
    if (c.nameUpdatedAt !== null && !isDate(c.nameUpdatedAt)) return null;
    // An ayah must have its number on the saved page.
    if (c.ayahKey !== undefined && !isWirdAyahOnPage(c.ayahKey, c.page)) return null;
    const wird: WirdContent = { v: 1, kind: 'wird', id: recordId, name, nameUpdatedAt: c.nameUpdatedAt, page: c.page, savedAt: c.savedAt, cycle };
    if (c.ayahKey !== undefined) wird.ayahKey = c.ayahKey;
    return wird;
  }
  if (kind === 'khatma') {
    const record = parseRecord(c);
    return record ? khatmaContent(record) : null;
  }
  if (kind === 'active') {
    if (c.stopId !== null && !isId(c.stopId)) return null;
    if (c.changedAt !== null && !isDate(c.changedAt)) return null;
    return activeContent(c.stopId, c.changedAt);
  }
  return null;
}

// ── Combining two versions ───────────────────────────────────────────────

const samePosition = (a: WirdContent, b: WirdContent) =>
  a.page === b.page && a.ayahKey === b.ayahKey && a.savedAt === b.savedAt && sameContent(a.cycle as never, b.cycle as never);

type Position = Pick<WirdContent, 'page' | 'savedAt' | 'cycle' | 'ayahKey'>;
/** `ayahKey` always present (undefined for page-only), so the winner's replaces the other side's when spread over it. */
const positionOf = (w: WirdContent): Position => ({ page: w.page, savedAt: w.savedAt, cycle: w.cycle, ayahKey: w.ayahKey });

/**
 * This device's version (`local`) and the account's (`remote`) of one ورد,
 * both changed since `base` (the last version this device had synced; null
 * when the two were created independently with the same id). Each part
 * resolves on its own:
 *
 * Name — whichever side renamed it; if both did, the later rename
 * (`nameUpdatedAt`); an exact tie keeps the account's.
 *
 * Saved page (with its ayah, if any) and cycle:
 *  - Only one side saved or confirmed: that side.
 *  - Same cycle on both: the later SAVE wins (`savedAt`, when the page was
 *    saved) — never the higher page, which would wrongly treat reading
 *    further as reading later. An exact tie keeps the account's.
 *  - Different generations (`seq`): the newer generation wins, so a device
 *    that has not yet seen a confirmation can never revert it — its saves
 *    in the finished cycle are superseded. Except: when the newer side is
 *    an undo of the very cycle in which the other side has saved progress,
 *    the progress is kept (an undo restores a cycle only if nothing was
 *    saved in the one it removes; this device had saved).
 *  - Same generation, different cycles (both confirmed the same Khatma):
 *    the cycle with saved progress; then the later save; then the smaller
 *    cycle id, so both devices pick the same one.
 */
export function mergeWird(local: WirdContent, remote: WirdContent, base: WirdContent | null): WirdContent {
  const localRenamed = !base || local.name !== base.name;
  const remoteRenamed = !base || remote.name !== base.name;
  const takeLocalName =
    localRenamed && (!remoteRenamed || (local.name !== remote.name && time(local.nameUpdatedAt) > time(remote.nameUpdatedAt)));
  const name = takeLocalName ? { name: local.name, nameUpdatedAt: local.nameUpdatedAt } : { name: remote.name, nameUpdatedAt: remote.nameUpdatedAt };
  return { ...remote, ...name, ...mergePosition(local, remote, base) };
}

function mergePosition(local: WirdContent, remote: WirdContent, base: WirdContent | null): Position {
  const localMoved = !base || !samePosition(local, base);
  const remoteMoved = !base || !samePosition(remote, base);
  if (!localMoved) return positionOf(remote);
  if (!remoteMoved) return positionOf(local);

  const [l, r] = [local.cycle, remote.cycle];
  if (l.seq === r.seq && l.id === r.id) {
    const winner = time(local.savedAt) > time(remote.savedAt) ? local : remote;
    return { ...positionOf(winner), cycle: { ...winner.cycle, savedSinceStart: l.savedSinceStart || r.savedSinceStart } };
  }
  if (l.seq === r.seq) {
    if (l.savedSinceStart !== r.savedSinceStart) return positionOf(l.savedSinceStart ? local : remote);
    if (l.savedSinceStart && time(local.savedAt) !== time(remote.savedAt)) return positionOf(time(local.savedAt) > time(remote.savedAt) ? local : remote);
    return positionOf(l.id < r.id ? local : remote);
  }
  const [newer, older] = l.seq > r.seq ? [local, remote] : [remote, local];
  const undidOlderProgress = newer.cycle.undoneCycleId === older.cycle.id && older.cycle.seq === newer.cycle.seq - 1 && older.cycle.savedSinceStart;
  if (undidOlderProgress) {
    return { ...positionOf(older), cycle: { ...older.cycle, seq: newer.cycle.seq + 1, undoneCycleId: null } };
  }
  return positionOf(newer);
}

/** The selected ورد: whichever device chose more recently; an exact tie keeps the account's. */
export function mergeActive(local: ActiveContent, remote: ActiveContent, base: ActiveContent | null): ActiveContent {
  if (base && sameContent(local, base)) return remote;
  if (base && sameContent(remote, base)) return local;
  return time(local.changedAt) > time(remote.changedAt) ? local : remote;
}
