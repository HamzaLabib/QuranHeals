import AsyncStorage from '@react-native-async-storage/async-storage';

import { LEGACY_READING_SYNC_STORAGE_KEY, READING_SYNC_STORAGE_KEY } from '@/mushaf/readingSyncKeys';
import { ownerStorageKey } from '@/storage/localDataOwner';

import { parseContent, type ActiveContent, type KhatmaContent, type WirdContent } from './readingSyncModel';

/**
 * What this device knows about one account's synced أورادي وختماتي, kept on
 * the device beside the data itself (one per account; guests have none):
 *
 *  - `wirds`, `khatmas`, `active`: for each record, the last version the
 *    account confirmed (its revision and content). Comparing the local data
 *    with these is what tells sync what changed here — durably: a change
 *    survives a restart, a failed upload or a lost response until the
 *    account has acknowledged it. Nothing waits in memory.
 *  - `ackedDeletes`: deletion markers the account has confirmed.
 *  - `syncId` / `since`: the account's sync generation and how far this
 *    device has downloaded its change feed.
 *
 * Written only after the local data it describes, so an interruption at
 * any point repeats safely: the next sync downloads the same changes again
 * and re-sends anything not confirmed.
 */
export type ReadingSyncMeta = {
  schema: 1;
  syncId: string | null;
  since: number;
  wirds: Record<string, { revision: number; content: WirdContent }>;
  khatmas: Record<string, { revision: number; content: KhatmaContent }>;
  active: { revision: number; content: ActiveContent } | null;
  ackedDeletes: Record<string, true>;
  lastSyncedAt: string | null;
};

export const readingSyncKey = (userId: string) => ownerStorageKey(READING_SYNC_STORAGE_KEY, userId);

export function emptyReadingSyncMeta(): ReadingSyncMeta {
  return { schema: 1, syncId: null, since: 0, wirds: {}, khatmas: {}, active: null, ackedDeletes: {}, lastSyncedAt: null };
}

function parseEntries<T>(value: unknown, kind: 'wird' | 'khatma'): Record<string, { revision: number; content: T }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, { revision: number; content: T }> = {};
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    const e = entry as { revision?: unknown; content?: unknown } | null;
    const content = e && parseContent(kind, id, e.content);
    if (content && typeof e.revision === 'number' && Number.isInteger(e.revision) && e.revision >= 1) out[id] = { revision: e.revision, content: content as T };
  }
  return out;
}

/** Never throws: unreadable state reads as empty (everything is then re-checked against the account). */
export async function loadReadingSyncMeta(userId: string): Promise<ReadingSyncMeta> {
  try {
    const raw = await AsyncStorage.getItem(readingSyncKey(userId));
    if (raw === null) {
      // The unreleased encrypted build's state: discarded, so this device re-uploads its own copy (the data itself is untouched).
      await AsyncStorage.removeItem(ownerStorageKey(LEGACY_READING_SYNC_STORAGE_KEY, userId));
      return emptyReadingSyncMeta();
    }
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.schema !== 1) return emptyReadingSyncMeta();
    const active = value.active as { revision?: unknown; content?: unknown } | null;
    const activeParsed = active && parseContent('active', 'active', active.content);
    return {
      schema: 1,
      syncId: typeof value.syncId === 'string' ? value.syncId : null,
      since: typeof value.since === 'number' && Number.isInteger(value.since) && value.since >= 0 ? value.since : 0,
      wirds: parseEntries<WirdContent>(value.wirds, 'wird'),
      khatmas: parseEntries<KhatmaContent>(value.khatmas, 'khatma'),
      active: activeParsed && typeof active.revision === 'number' ? { revision: active.revision, content: activeParsed as ActiveContent } : null,
      ackedDeletes: value.ackedDeletes && typeof value.ackedDeletes === 'object'
        ? Object.fromEntries(Object.keys(value.ackedDeletes as object).map((key) => [key, true as const]))
        : {},
      lastSyncedAt: typeof value.lastSyncedAt === 'string' ? value.lastSyncedAt : null,
    };
  } catch {
    return emptyReadingSyncMeta();
  }
}

export async function saveReadingSyncMeta(userId: string, meta: ReadingSyncMeta): Promise<void> {
  await AsyncStorage.setItem(readingSyncKey(userId), JSON.stringify(meta));
}

// ── Status, for أورادي وختماتي's sync line ────────────────────────────────

/**
 * - 'syncing': a sync is running.
 * - 'synced': the last sync finished and nothing changed here since —
 *   only ever set after the account acknowledged every change.
 * - 'pending': a change here is not yet on the account (offline, failed,
 *   or simply not sent yet). Everything is already saved on the device.
 */
export type ReadingSyncStatus = { state: 'idle' | 'syncing' | 'synced' | 'pending'; lastSyncedAt: string | null };

let status: ReadingSyncStatus = { state: 'idle', lastSyncedAt: null };
let changedDuringSync = false;
const statusListeners = new Set<(next: ReadingSyncStatus) => void>();

function setStatus(next: ReadingSyncStatus) {
  status = next;
  statusListeners.forEach((listener) => listener(status));
}

export function getReadingSyncStatus(): ReadingSyncStatus {
  return status;
}

export function subscribeToReadingSyncStatus(listener: (next: ReadingSyncStatus) => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

export function markReadingSyncStarted(): void {
  changedDuringSync = false;
  setStatus({ ...status, state: 'syncing' });
}

/** `complete`: everything was acknowledged. A change made while it ran still counts as pending. */
export function markReadingSyncFinished(complete: boolean, lastSyncedAt: string | null): void {
  setStatus({ state: complete && !changedDuringSync ? 'synced' : 'pending', lastSyncedAt: lastSyncedAt ?? status.lastSyncedAt });
}

/** A user change here, not yet acknowledged by the account. */
export function markReadingChangedLocally(): void {
  if (status.state === 'syncing') changedDuringSync = true;
  else setStatus({ ...status, state: 'pending' });
}

/** Signed out, another account, or a guest: no sync status to show. */
export function resetReadingSyncStatus(): void {
  changedDuringSync = false;
  setStatus({ state: 'idle', lastSyncedAt: null });
}
