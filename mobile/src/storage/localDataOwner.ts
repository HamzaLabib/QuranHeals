import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Who owns the device-local reflections and favorites.
 *
 * Local data is partitioned by owner: one guest partition (the original,
 * pre-ownership storage keys) plus one partition per account that has
 * signed in on this device, keyed by its stable user id. Sync only ever
 * reads and writes the partition of the account it is syncing for, so one
 * account's data can never be uploaded to another account.
 *
 * The ACTIVE partition is what the app shows and edits: the signed-in
 * account's partition while signed in, and the guest partition otherwise.
 * Signing out switches back to the guest partition at once; the account's
 * partition stays on the device (unsynced edits are never lost) but is
 * never shown, edited or synced again until that same account signs in.
 *
 * Guest data only ever moves into an account when the user explicitly
 * chooses "Add to this account" (see localDataOwnership.ts). Data whose
 * owner cannot be proven — including everything stored before ownership
 * existed — is guest data.
 */

export const GUEST_REFLECTIONS_KEY = 'quran-heals:ayah-reflections:v1';
export const GUEST_FAVORITES_KEY = 'quran-heals:favorites';
const OWNER_STATE_KEY = 'quran-heals:local-data-owner:v1';

export function reflectionsStorageKey(userId: string | null): string {
  return userId === null ? GUEST_REFLECTIONS_KEY : `${GUEST_REFLECTIONS_KEY}:account:${userId}`;
}

export function favoritesStorageKey(userId: string | null): string {
  return userId === null ? GUEST_FAVORITES_KEY : `${GUEST_FAVORITES_KEY}:account:${userId}`;
}

export type LocalDataOwnerState = {
  /** Owner of the active partition; null = the guest partition. */
  activeUserId: string | null;
  /** Accounts that chose "Keep separate" for this device's guest data; not asked again on a restored session. */
  keptSeparate: string[];
  /**
   * False from launch until the auth state is known, when the last owner
   * was an account: that account may have signed out or expired meanwhile,
   * so its data must not be shown yet. Never persisted.
   */
  resolved: boolean;
};

let state: LocalDataOwnerState | null = null;
let loading: Promise<LocalDataOwnerState> | null = null;
let generation = 0;
/** 'owner': a different owner's data is now active — drop what is shown. 'data': the same owner's data changed (a merge, a finished sync) — reload. */
export type LocalDataChange = 'owner' | 'data';
const listeners = new Set<(change: LocalDataChange) => void>();

function parseStoredState(raw: string): Omit<LocalDataOwnerState, 'resolved'> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { activeUserId, keptSeparate } = parsed as Record<string, unknown>;
    if (activeUserId !== null && (typeof activeUserId !== 'string' || activeUserId.length === 0)) return null;
    // Markers written before "Keep separate" existed have no list (their
    // guestAdoptable flag no longer means anything: guest data is only ever
    // merged on request).
    const kept = Array.isArray(keptSeparate) ? keptSeparate.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
    return { activeUserId, keptSeparate: kept };
  } catch {
    return null;
  }
}

async function load(): Promise<LocalDataOwnerState> {
  const raw = await AsyncStorage.getItem(OWNER_STATE_KEY);
  const stored = raw === null ? null : parseStoredState(raw);
  // No marker (fresh install, or an upgrade from before ownership existed)
  // or an unreadable one: the guest partition, whose data stays guest data.
  // Each account's own partition is still found by its key.
  if (!stored) return { activeUserId: null, keptSeparate: [], resolved: true };
  return { ...stored, resolved: stored.activeUserId === null };
}

export async function getLocalDataOwnerState(): Promise<LocalDataOwnerState> {
  if (state) return state;
  loading ??= load()
    .then((loaded) => {
      state ??= loaded;
      return state;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** The owner of the partition the app currently shows and edits (null = guest). */
export async function getActiveLocalOwner(): Promise<string | null> {
  return (await getLocalDataOwnerState()).activeUserId;
}

/** Changes whenever the active owner (or whether it is resolved) changes: work begun under an older value is stale. */
export function getLocalDataGeneration(): number {
  return generation;
}

/** Called after every owner change (screens drop what they show and reload) and every data change (they reload). Returns the unsubscribe function. */
export function subscribeToLocalDataOwner(listener: (change: LocalDataChange) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The active owner's data was replaced in storage (not by a screen's own edit): screens showing it reload. */
export function notifyLocalDataChanged(): void {
  listeners.forEach((listener) => listener('data'));
}

/** In-memory switch: every storage operation that starts after this uses the new active partition. */
export function setLocalDataOwnerState(next: LocalDataOwnerState): void {
  const changed = state === null || state.activeUserId !== next.activeUserId || state.resolved !== next.resolved;
  state = next;
  if (!changed) return;
  generation += 1;
  listeners.forEach((listener) => listener('owner'));
}

/**
 * Sign-out's first step, synchronous so no render after it can still show
 * the account's data: the guest partition becomes active in memory at once
 * (localDataOwnership.ts's activateGuestLocalData then persists it). A
 * no-op while the state has not been loaded — nothing can have been shown.
 */
export function hideAccountDataNow(): void {
  if (state && (state.activeUserId !== null || !state.resolved)) {
    setLocalDataOwnerState({ ...state, activeUserId: null, resolved: true });
  }
}

export async function persistLocalDataOwnerState(): Promise<void> {
  const current = await getLocalDataOwnerState();
  await AsyncStorage.setItem(
    OWNER_STATE_KEY,
    JSON.stringify({ activeUserId: current.activeUserId, keptSeparate: current.keptSeparate }),
  );
}

/** Test-only: forget in-memory state (simulates an app restart). */
export function resetLocalDataOwnerForTests(): void {
  state = null;
  loading = null;
  generation += 1;
}
