import { readReadingSnapshot, updateReadingSnapshot, type ReadingSnapshot } from '@/mushaf/khatmas';

import {
  activeContent,
  khatmaContent,
  khatmaFromContent,
  mergeActive,
  mergeWird,
  parseContent,
  sameContent,
  wirdContent,
  wirdFromContent,
  type ReadingContent,
  type WirdContent,
} from './readingSyncModel';
import {
  emptyReadingSyncMeta,
  loadReadingSyncMeta,
  markReadingSyncFinished,
  markReadingSyncStarted,
  saveReadingSyncMeta,
  type ReadingSyncMeta,
} from './readingSyncState';
import { getCloudReading, pushCloudReading, SyncApiError, type CloudReadingRecord, type ReadingChange, type ReadingChangeResult } from './syncApi';

/**
 * أورادي وختماتي sync for one signed-in account (docs/auth-and-sync/reading-sync.md).
 * Account-based like favorites: the session is all it needs — never the
 * Sync Password, and never affected by locked reflections or a reset.
 *
 *  1. Download every change since the last sync (the account's change feed)
 *     and apply it to this device's data, combining it with anything changed
 *     here (readingSyncModel.ts's rules). A deletion always wins and leaves a
 *     marker; a Khatma is taken exactly as recorded.
 *  2. Upload what differs here from the version the account last confirmed:
 *     new and edited أوراد, new Khatmas, deletions and the active ورد. A
 *     stale upload comes back as a conflict with the account's version,
 *     which is combined and sent again; a Khatma for a cycle the account
 *     already has is replaced by the account's (one per cycle).
 *
 * Everything is saved on the device before and regardless of sync: offline,
 * this simply fails and the next sync retries from durable state. Only this
 * account's own partition (`ownerUserId`) is read or written, whichever
 * account is active by then; `isCurrent` stops it once its session ends.
 * Nothing here ever confirms a Khatma, and a page position is never turned
 * into anything but a page position.
 */

const PULL_LIMIT = 200;
const PUSH_BATCH = 50;
/** Upload rounds per sync (each conflict needs one more); anything left goes at the next sync. */
const MAX_PUSH_ROUNDS = 4;
const MAX_PULL_PAGES = 1000;

export type ReadingSyncOptions = {
  /** False once the session this sync runs for has ended. */
  isCurrent?: () => boolean;
  now?: () => Date;
};

type Pending = { key: string; change: ReadingChange; content?: ReadingContent };

/**
 * Whether the account's server takes a ورد's `ayahKey` (the gold medallion's ayah). A server from before it refuses
 * the whole upload (its content schema is strict: a 400), which would stall every reading change. So on such a
 * refusal of a batch carrying one, this app session uploads without it: the page syncs exactly as before and the
 * ayah stays on this device until a later session finds the server updated (it then goes up like any other change).
 */
let serverTakesAyahKey = true;
/** Tests only: a new app session. */
export function resetReadingSyncServerCapabilitiesForTests(): void {
  serverTakesAyahKey = true;
}
const withoutAyahKey = (content: WirdContent): WirdContent => {
  if (serverTakesAyahKey || content.ayahKey === undefined) return content;
  const { ayahKey: _kept, ...pageOnly } = content;
  return pageOnly;
};
const carriesAyahKey = (batch: Pending[]) => batch.some((item) => item.change.kind === 'wird' && item.change.action === 'upsert' && item.change.data.ayahKey !== undefined);

/** One sync at a time per account: a full sync and a reading-only one (useAuth.tsx) never interleave. */
const queues = new Map<string, Promise<unknown>>();

/** True when everything was downloaded and every change here was acknowledged by the account. */
export function syncReading(sessionToken: string, ownerUserId: string, options: ReadingSyncOptions = {}): Promise<boolean> {
  const previous = queues.get(ownerUserId) ?? Promise.resolve();
  const run = previous.then(() => syncReadingNow(sessionToken, ownerUserId, options), () => syncReadingNow(sessionToken, ownerUserId, options));
  const settled = run.catch(() => undefined);
  queues.set(ownerUserId, settled);
  void settled.then(() => {
    if (queues.get(ownerUserId) === settled) queues.delete(ownerUserId);
  });
  return run;
}

async function syncReadingNow(sessionToken: string, ownerUserId: string, options: ReadingSyncOptions): Promise<boolean> {
  const isCurrent = options.isCurrent ?? (() => true);
  if (!isCurrent()) return false;
  const context: Context = {
    token: sessionToken,
    owner: ownerUserId,
    isCurrent,
    now: options.now ?? (() => new Date()),
    meta: await loadReadingSyncMeta(ownerUserId),
    unreadable: new Set(),
    limited: false,
  };
  markReadingSyncStarted();
  let complete = false;
  try {
    // A second pass only if the account's sync generation changed mid-sync (its stored records were replaced).
    for (let pass = 0; pass < 2; pass += 1) {
      const outcome = await syncOnce(context);
      if (outcome !== 'restart') {
        complete = outcome === 'complete';
        break;
      }
    }
    return complete;
  } finally {
    markReadingSyncFinished(complete, context.meta.lastSyncedAt);
  }
}

type Context = {
  token: string;
  owner: string;
  isCurrent: () => boolean;
  now: () => Date;
  meta: ReadingSyncMeta;
  /** Account records this app version cannot read (damaged, or a newer format): never overwritten from here. */
  unreadable: Set<string>;
  /** The account refused a new record (its storage bound). */
  limited: boolean;
};

const keyOf = (kind: string, id: string) => `${kind}:${id}`;

async function syncOnce(context: Context): Promise<'complete' | 'incomplete' | 'restart' | 'stopped'> {
  const downloaded = await download(context);
  if (downloaded === 'stopped') return 'stopped';

  await updateReadingSnapshot(context.owner, (snapshot) => ({ changed: applyDownloaded(context, snapshot, downloaded.records), result: undefined }));
  context.meta.since = downloaded.since;
  if (!context.isCurrent()) return 'stopped';
  await saveReadingSyncMeta(context.owner, context.meta);

  rounds: for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    const pending = changesToUpload(context, await readReadingSnapshot(context.owner));
    if (pending.length === 0) {
      if (context.limited) return 'incomplete';
      context.meta.lastSyncedAt = context.now().toISOString();
      pruneAckedDeletes(context.meta, await readReadingSnapshot(context.owner));
      await saveReadingSyncMeta(context.owner, context.meta);
      return 'complete';
    }
    for (let start = 0; start < pending.length; start += PUSH_BATCH) {
      const batch = pending.slice(start, start + PUSH_BATCH);
      let response: Awaited<ReturnType<typeof pushCloudReading>>;
      try {
        response = await pushCloudReading(context.token, batch.map((item) => item.change));
      } catch (error) {
        // A server without `ayahKey` (see serverTakesAyahKey): the same changes again, page-only.
        if (serverTakesAyahKey && error instanceof SyncApiError && error.statusCode === 400 && carriesAyahKey(batch)) {
          serverTakesAyahKey = false;
          continue rounds;
        }
        throw error;
      }
      if (!context.isCurrent()) return 'stopped';
      if (context.meta.syncId && response.syncId !== context.meta.syncId) {
        context.meta = { ...emptyReadingSyncMeta(), syncId: null };
        return 'restart';
      }
      context.meta.syncId = response.syncId;
      await updateReadingSnapshot(context.owner, (snapshot) => ({ changed: applyResults(context, snapshot, batch, response.results), result: undefined }));
      await saveReadingSyncMeta(context.owner, context.meta);
    }
  }
  return 'incomplete';
}

async function download(context: Context): Promise<{ records: CloudReadingRecord[]; since: number } | 'stopped'> {
  let since = context.meta.since;
  let records: CloudReadingRecord[] = [];
  let resets = 0;
  for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
    const response = await getCloudReading(context.token, since, PULL_LIMIT);
    if (!context.isCurrent()) return 'stopped';
    if (response.syncId && context.meta.syncId && response.syncId !== context.meta.syncId) {
      // The account's stored records were replaced (e.g. restored from a
      // backup). Forget what it had: everything here is
      // re-sent. Its deletion markers remain, so nothing deleted returns.
      if (++resets > 1) throw new Error('Reading sync generation changed repeatedly.');
      context.meta = { ...emptyReadingSyncMeta(), syncId: response.syncId };
      since = 0;
      records = [];
      continue;
    }
    if (response.syncId) context.meta.syncId = response.syncId;
    records.push(...response.records);
    since = response.nextSince;
    if (!response.hasMore) return { records, since };
  }
  throw new Error('Reading sync download did not finish.');
}

// ── Applying the account's versions ──────────────────────────────────────

function applyDownloaded(context: Context, snapshot: ReadingSnapshot, records: CloudReadingRecord[]): boolean {
  // The latest version of each record (the feed is in change order).
  const latest = new Map<string, CloudReadingRecord>();
  for (const record of records) latest.set(keyOf(record.kind, record.recordId), record);
  let changed = false;
  for (const record of latest.values()) changed = applyRecord(context, snapshot, record) || changed;

  // A ورد this device had synced but has lost without deleting it (damaged
  // storage): restored from its last synced version, never deleted on the
  // account by mistake.
  for (const [id, entry] of Object.entries(context.meta.wirds)) {
    if (!snapshot.stops.some((stop) => stop.id === id) && !(id in snapshot.deletedStops)) changed = setWird(snapshot, entry.content) || changed;
  }
  return changed;
}

function applyRecord(context: Context, snapshot: ReadingSnapshot, record: CloudReadingRecord): boolean {
  if (record.deleted) return applyDeletion(context, snapshot, record.kind, record.recordId);
  const content = record.data === undefined ? null : parseContent(record.kind, record.recordId, record.data);
  if (!content) {
    context.unreadable.add(keyOf(record.kind, record.recordId));
    return false;
  }
  return applyContent(context, snapshot, record.revision, content);
}

function applyDeletion(context: Context, snapshot: ReadingSnapshot, kind: string, id: string): boolean {
  const at = context.now().toISOString();
  const { meta } = context;
  meta.ackedDeletes[keyOf(kind, id)] = true;
  if (kind === 'wird') {
    delete meta.wirds[id];
    const had = snapshot.stops.some((stop) => stop.id === id) || !(id in snapshot.deletedStops);
    snapshot.stops = snapshot.stops.filter((stop) => stop.id !== id);
    delete snapshot.cycles[id];
    snapshot.deletedStops[id] ??= at;
    if (snapshot.activeStopId === id) snapshot.activeStopId = null;
    return had;
  }
  if (kind === 'khatma') {
    delete meta.khatmas[id];
    const had = snapshot.records.some((record) => record.id === id) || !(id in snapshot.deletedRecords);
    snapshot.records = snapshot.records.filter((record) => record.id !== id);
    snapshot.deletedRecords[id] ??= at;
    return had;
  }
  return false;
}

function applyContent(context: Context, snapshot: ReadingSnapshot, revision: number, content: ReadingContent): boolean {
  const { meta } = context;
  if (content.kind === 'wird') {
    const base = meta.wirds[content.id]?.content ?? null;
    meta.wirds[content.id] = { revision, content };
    // Deleted here, not yet on the account: the deletion goes up next.
    if (content.id in snapshot.deletedStops) return false;
    const stop = snapshot.stops.find((s) => s.id === content.id);
    if (!stop) return setWird(snapshot, content);
    const local = wirdContent(stop, snapshot.cycles[stop.id]);
    if (sameContent(local, content) || (base && sameContent(local, base))) return setWird(snapshot, content);
    return setWird(snapshot, mergeWird(local, content, base));
  }

  if (content.kind === 'khatma') {
    meta.khatmas[content.id] = { revision, content };
    if (content.id in snapshot.deletedRecords) return false;
    const record = khatmaFromContent(content);
    let changed = false;
    // This device's own, not yet uploaded record for the same cycle: the
    // account's is the one kept (one Khatma per cycle); ours is dropped,
    // not deleted (it was never a separate Khatma).
    const sameCycle = snapshot.records.filter((r) => r.cycleId === record.cycleId && r.id !== record.id && !meta.khatmas[r.id]);
    if (sameCycle.length > 0) {
      snapshot.records = snapshot.records.filter((r) => !sameCycle.includes(r));
      changed = true;
    }
    const index = snapshot.records.findIndex((r) => r.id === record.id);
    if (index === -1) {
      snapshot.records.push(record);
      return true;
    }
    if (!sameContent(khatmaContent(snapshot.records[index]), content)) {
      snapshot.records[index] = record;
      return true;
    }
    return changed;
  }

  const base = meta.active?.content ?? null;
  meta.active = { revision, content };
  const local = activeContent(snapshot.activeStopId, snapshot.activeChangedAt);
  const next = base && sameContent(local, base) ? content : mergeActive(local, content, base);
  if (sameContent(next, local)) return false;
  snapshot.activeStopId = next.stopId;
  snapshot.activeChangedAt = next.changedAt;
  return true;
}

function setWird(snapshot: ReadingSnapshot, content: WirdContent): boolean {
  const existing = snapshot.stops.find((stop) => stop.id === content.id);
  if (existing && snapshot.cycles[existing.id] && sameContent(wirdContent(existing, snapshot.cycles[existing.id]), content)) return false;
  const { stop, cycle } = wirdFromContent(content);
  snapshot.stops = existing ? snapshot.stops.map((s) => (s.id === stop.id ? stop : s)) : [...snapshot.stops, stop];
  snapshot.cycles[stop.id] = cycle;
  return true;
}

// ── Uploading what changed here ──────────────────────────────────────────

function changesToUpload(context: Context, snapshot: ReadingSnapshot): Pending[] {
  const { meta, unreadable } = context;
  const pending: Pending[] = [];

  for (const stop of snapshot.stops) {
    const key = keyOf('wird', stop.id);
    if (unreadable.has(key) || !snapshot.cycles[stop.id]) continue;
    const content = withoutAyahKey(wirdContent(stop, snapshot.cycles[stop.id]));
    const base = meta.wirds[stop.id];
    if (base && sameContent(content, base.content)) continue;
    pending.push({ key, content, change: { kind: 'wird', recordId: stop.id, action: 'upsert', baseRevision: base?.revision ?? null, data: content } });
  }
  for (const id of Object.keys(snapshot.deletedStops)) {
    if (!meta.ackedDeletes[keyOf('wird', id)]) pending.push({ key: keyOf('wird', id), change: { kind: 'wird', recordId: id, action: 'delete' } });
  }

  for (const record of snapshot.records) {
    const key = keyOf('khatma', record.id);
    if (meta.khatmas[record.id] || unreadable.has(key)) continue;
    const content = khatmaContent(record);
    pending.push({ key, content, change: { kind: 'khatma', recordId: record.id, action: 'upsert', data: content } });
  }
  for (const id of Object.keys(snapshot.deletedRecords)) {
    if (!meta.ackedDeletes[keyOf('khatma', id)]) pending.push({ key: keyOf('khatma', id), change: { kind: 'khatma', recordId: id, action: 'delete' } });
  }

  if (!unreadable.has(keyOf('active', 'active'))) {
    const stopId = snapshot.activeStopId && snapshot.stops.some((stop) => stop.id === snapshot.activeStopId) ? snapshot.activeStopId : null;
    const content = activeContent(stopId, snapshot.activeChangedAt);
    const base = meta.active;
    const nothingChosen = content.stopId === null && content.changedAt === null;
    if (base ? !sameContent(content, base.content) : !nothingChosen) {
      pending.push({ key: keyOf('active', 'active'), content, change: { kind: 'active', recordId: 'active', action: 'upsert', baseRevision: base?.revision ?? null, data: content } });
    }
  }
  return pending;
}

function applyResults(context: Context, snapshot: ReadingSnapshot, batch: Pending[], results: ReadingChangeResult[]): boolean {
  const { meta } = context;
  let changed = false;
  for (const result of results) {
    const sent = batch.find((item) => item.change.kind === result.kind && item.change.recordId === result.recordId);
    if (!sent) continue;
    const { change } = sent;
    if (result.status === 'limit') {
      context.limited = true;
      continue;
    }
    if (change.action === 'delete') {
      // 'applied': now deleted on the account too.
      changed = applyDeletion(context, snapshot, change.kind, change.recordId) || changed;
      continue;
    }
    if (result.status === 'deleted') {
      changed = applyDeletion(context, snapshot, change.kind, change.recordId) || changed;
      continue;
    }
    const record = result.record;
    if (result.status === 'applied' && record) {
      if (change.kind === 'wird') meta.wirds[change.recordId] = { revision: record.revision, content: sent.content as WirdContent };
      else if (change.kind === 'active') meta.active = { revision: record.revision, content: sent.content as never };
      else {
        // The account may already hold this same Khatma from another device:
        // its stored version is the one kept.
        const stored = record.data === undefined ? null : parseContent('khatma', record.recordId, record.data);
        if (stored && !sameContent(stored, sent.content)) changed = applyContent(context, snapshot, record.revision, stored) || changed;
        else meta.khatmas[change.recordId] = { revision: record.revision, content: sent.content as never };
      }
      continue;
    }
    if ((result.status === 'conflict' || result.status === 'duplicate') && record) {
      if (result.status === 'duplicate') {
        // Another device confirmed this cycle first: its record is the Khatma.
        const before = snapshot.records.length;
        snapshot.records = snapshot.records.filter((r) => r.id !== change.recordId);
        changed = changed || snapshot.records.length !== before;
      }
      changed = applyRecord(context, snapshot, record) || changed;
    }
  }
  return changed;
}

/** Acknowledged deletions are remembered only while this device still keeps the deletion marker. */
function pruneAckedDeletes(meta: ReadingSyncMeta, snapshot: ReadingSnapshot) {
  const kept = new Set([
    ...Object.keys(snapshot.deletedStops).map((id) => keyOf('wird', id)),
    ...Object.keys(snapshot.deletedRecords).map((id) => keyOf('khatma', id)),
  ]);
  meta.ackedDeletes = Object.fromEntries(Object.keys(meta.ackedDeletes).filter((key) => kept.has(key)).map((key) => [key, true as const]));
}
