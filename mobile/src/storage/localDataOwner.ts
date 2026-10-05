import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Who owns the device-local reflections and favorites.
 *
 * Local data is partitioned by owner: one guest partition (the original,
 * pre-ownership storage keys) plus one partition per account that has
 * signed in on this device. Sync only ever reads and writes the partition
 * of the account it is syncing for, so one account's data can never be
 * uploaded to another account.
 *
 * The ACTIVE partition is what the app shows and edits. It is the signed-in
 * account's partition, and it stays the last signed-in account's partition
 * after sign-out (sign-out never turns an account's data into guest data,
 * and never hides it from its owner's device). It returns to the guest
 * partition only after that account is deleted.
 *
 * Guest data (created before any account signed in on this device) may be
 * adopted by the FIRST account to sign in — the existing guest → account
 * migration. Data that already has an account owner never moves.
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
  /** Whether the guest partition may be adopted by the next account that signs in. */
  guestAdoptable: boolean;
  /**
   * Upgrade from a version without ownership, with data already in the
   * guest partition: who it belongs to is decided by the first auth outcome
   * (see localDataOwnership.ts). Never persisted.
   */
  legacyUndecided: boolean;
  /** For legacyUndecided only: the legacy reflections show that an account synced them (or could not be read). */
  legacyHasAccountEvidence: boolean;
};

let state: LocalDataOwnerState | null = null;
let loading: Promise<LocalDataOwnerState> | null = null;

function parseStoredState(raw: string): Pick<LocalDataOwnerState, 'activeUserId' | 'guestAdoptable'> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const { activeUserId, guestAdoptable } = parsed as Record<string, unknown>;
    if ((activeUserId !== null && (typeof activeUserId !== 'string' || activeUserId.length === 0)) || typeof guestAdoptable !== 'boolean') {
      return null;
    }
    return { activeUserId, guestAdoptable };
  } catch {
    return null;
  }
}

/** True if any legacy reflection carries a syncState — only ever set by a signed-in sync — or if they cannot be read. */
function legacyReflectionsShowAccountUse(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true;
    return Object.values(parsed as Record<string, unknown>).some(
      (entry) => !!entry && typeof entry === 'object' && (entry as Record<string, unknown>).syncState !== undefined,
    );
  } catch {
    return true;
  }
}

async function load(): Promise<LocalDataOwnerState> {
  const raw = await AsyncStorage.getItem(OWNER_STATE_KEY);
  if (raw !== null) {
    const stored = parseStoredState(raw);
    // An unreadable marker: start from the guest partition and never adopt
    // it — each account's own partition is still found by its key.
    return stored
      ? { ...stored, legacyUndecided: false, legacyHasAccountEvidence: false }
      : { activeUserId: null, guestAdoptable: false, legacyUndecided: false, legacyHasAccountEvidence: false };
  }

  const [legacyReflections, legacyFavorites] = await Promise.all([
    AsyncStorage.getItem(GUEST_REFLECTIONS_KEY),
    AsyncStorage.getItem(GUEST_FAVORITES_KEY),
  ]);
  if (legacyReflections === null && legacyFavorites === null) {
    return { activeUserId: null, guestAdoptable: true, legacyUndecided: false, legacyHasAccountEvidence: false };
  }
  return {
    activeUserId: null,
    guestAdoptable: false,
    legacyUndecided: true,
    legacyHasAccountEvidence: legacyReflectionsShowAccountUse(legacyReflections),
  };
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

/** In-memory switch: every storage operation that starts after this uses the new active partition. */
export function setLocalDataOwnerState(next: LocalDataOwnerState): void {
  state = next;
}

export async function persistLocalDataOwnerState(): Promise<void> {
  const current = await getLocalDataOwnerState();
  await AsyncStorage.setItem(
    OWNER_STATE_KEY,
    JSON.stringify({ activeUserId: current.activeUserId, guestAdoptable: current.guestAdoptable }),
  );
}

/** Test-only: forget in-memory state (simulates an app restart). */
export function resetLocalDataOwnerForTests(): void {
  state = null;
  loading = null;
}
