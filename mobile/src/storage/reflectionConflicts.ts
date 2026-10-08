import AsyncStorage from '@react-native-async-storage/async-storage';

import { getActiveLocalOwner, reflectionsStorageKey } from './localDataOwner';

/**
 * Other versions of a reflection that sync would otherwise have overwritten
 * (D5). Sync is last-write-wins per verseKey; when two devices changed the
 * same reflection without seeing each other's change, the losing text is
 * kept here — on this device, in plaintext like every local reflection, per
 * account — instead of being discarded. The user reviews it in the
 * reflection editor and chooses what to keep. Nothing here is uploaded:
 * whatever the user keeps is saved as an ordinary reflection edit, which
 * then syncs (encrypted) as usual.
 *
 * Account partitions only — a guest never syncs, so has no conflicts — and
 * keyed like the account's reflections, so another account on this device
 * can never see them.
 */

export type ConflictOrigin =
  /** This device's unsynced text, superseded by a newer change from another device. */
  | 'this-device'
  /** Another device's text that this device's newer edit replaced in the cloud. */
  | 'other-device'
  /** A version the server preserved for an exact-timestamp tie. */
  | 'server';

export type ReflectionConflictVersion = {
  /** Stable for the same content, so detecting it again never duplicates it. */
  id: string;
  verseKey: string;
  text: string;
  origin: ConflictOrigin;
  /** When this version was written (its own updatedAt), for display. */
  versionUpdatedAt: number;
  /** True when the change that superseded this text was a deletion. */
  supersededByDeletion?: boolean;
  detectedAt: number;
};

type ConflictState = {
  versions: ReflectionConflictVersion[];
  /** Server-preserved versions the user already handled; never offered again on this device. */
  handledServerIds: string[];
};

function storageKey(ownerUserId: string): string {
  return `${reflectionsStorageKey(ownerUserId)}:conflicts`;
}

/** djb2 — an id, not a security property. */
function contentHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function conflictVersionId(verseKey: string, text: string, serverNonce?: string): string {
  return serverNonce ? `server:${verseKey}:${serverNonce}` : `local:${verseKey}:${contentHash(text)}:${text.length}`;
}

function isVersion(value: unknown): value is ReflectionConflictVersion {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.verseKey === 'string' &&
    typeof v.text === 'string' &&
    (v.origin === 'this-device' || v.origin === 'other-device' || v.origin === 'server') &&
    typeof v.versionUpdatedAt === 'number' &&
    typeof v.detectedAt === 'number'
  );
}

// Unreadable storage is reported, never treated as empty — saving over it
// would erase recovered text.
function parse(raw: string | null): ConflictState {
  if (raw === null) return { versions: [], handledServerIds: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<ConflictState>;
    if (parsed && Array.isArray(parsed.versions)) {
      return {
        versions: parsed.versions.filter(isVersion),
        handledServerIds: Array.isArray(parsed.handledServerIds) ? parsed.handledServerIds.filter((id): id is string => typeof id === 'string') : [],
      };
    }
  } catch {
    // fall through
  }
  throw new Error('Saved reflection versions could not be read. Your stored data has been kept.');
}

let pendingMutation: Promise<unknown> = Promise.resolve();
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const result = pendingMutation.then(operation, operation);
  pendingMutation = result.catch(() => undefined);
  return result;
}

async function resolveOwner(ownerUserId: string | null | undefined): Promise<string | null> {
  return ownerUserId === undefined ? getActiveLocalOwner() : ownerUserId;
}

/** A version to keep; `serverNonce` identifies a server-preserved version across syncs. */
export type NewConflictVersion = Omit<ReflectionConflictVersion, 'id' | 'detectedAt'> & { serverNonce?: string };

/**
 * Adds versions, skipping any whose text is already kept for that verseKey,
 * equals the reflection's current text (`currentTextByVerseKey`), or (for
 * server versions) was already handled. Returns how many were added.
 */
export function addConflictVersions(
  ownerUserId: string,
  versions: NewConflictVersion[],
  options: { currentTextByVerseKey?: Map<string, string>; now?: number } = {},
): Promise<number> {
  return mutate(async () => {
    if (versions.length === 0) return 0;
    const key = storageKey(ownerUserId);
    const state = parse(await AsyncStorage.getItem(key));
    const now = options.now ?? Date.now();
    let added = 0;
    for (const { serverNonce, ...version } of versions) {
      const text = version.text.trim();
      if (!text) continue;
      const id = conflictVersionId(version.verseKey, text, serverNonce);
      if (state.handledServerIds.includes(id)) continue;
      if (options.currentTextByVerseKey?.get(version.verseKey)?.trim() === text) continue;
      if (state.versions.some((kept) => kept.verseKey === version.verseKey && kept.text === text)) continue;
      state.versions.push({ ...version, text, id, detectedAt: now });
      added++;
    }
    if (added > 0) await AsyncStorage.setItem(key, JSON.stringify(state));
    return added;
  });
}

/** Every kept version for the owner (the active owner by default); none for a guest. */
export async function getConflictVersions(ownerUserId?: string | null): Promise<ReflectionConflictVersion[]> {
  await pendingMutation;
  const owner = await resolveOwner(ownerUserId);
  if (owner === null) return [];
  return parse(await AsyncStorage.getItem(storageKey(owner))).versions;
}

export async function getConflictVersionsFor(verseKey: string, ownerUserId?: string | null): Promise<ReflectionConflictVersion[]> {
  return (await getConflictVersions(ownerUserId)).filter((version) => version.verseKey === verseKey);
}

/** Removes versions the user has handled (kept, merged or discarded). Server versions are remembered so they are not offered again. */
export function resolveConflictVersions(ids: string[], ownerUserId?: string | null): Promise<void> {
  return mutate(async () => {
    const owner = await resolveOwner(ownerUserId);
    if (owner === null || ids.length === 0) return;
    const key = storageKey(owner);
    const state = parse(await AsyncStorage.getItem(key));
    const remove = new Set(ids);
    const handled = new Set(state.handledServerIds);
    for (const id of ids) if (id.startsWith('server:')) handled.add(id);
    await AsyncStorage.setItem(key, JSON.stringify({
      versions: state.versions.filter((version) => !remove.has(version.id)),
      handledServerIds: [...handled],
    } satisfies ConflictState));
  });
}

/** Account deletion only: these are plaintext reflections of the deleted account. */
export function clearAllConflictVersions(ownerUserId: string): Promise<void> {
  return mutate(async () => AsyncStorage.removeItem(storageKey(ownerUserId)));
}
