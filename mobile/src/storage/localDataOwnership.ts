import { adoptGuestReflections, guestHasReflections } from './ayahReflections';
import { adoptGuestFavorites, guestHasFavorites } from './favorites';
import { getLocalDataOwnerState, notifyLocalDataChanged, persistLocalDataOwnerState, setLocalDataOwnerState } from './localDataOwner';

/**
 * Ownership transitions for device-local reflections and favorites (see
 * localDataOwner.ts for the model). Serialized: transitions never interleave.
 *
 *   Guest → (optionally merge, only on request) → Account A
 *         → sign out → Guest → Account B
 *
 *  - Signing in (or a restored session) makes that account's own partition
 *    the active one. Nothing moves: another account's partition is never
 *    shown to, synced for, or merged into it.
 *  - Signing out makes the guest partition active again. The account's
 *    partition stays on the device for that account only.
 *  - Guest data moves into an account only through mergeGuestDataIntoAccount,
 *    after the user chose "Add to this account". "Keep separate" leaves it
 *    in the guest partition, where it is shown again after sign-out.
 */

let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = chain.then(operation, operation);
  chain = result.catch(() => undefined);
  return result;
}

/**
 * Makes `userId`'s partition the active one. Must complete before that
 * account's first sync. `isCurrent` is false once that account's session
 * has ended: a queued activation then does nothing, so a sign-out can never
 * be undone by an activation that was still waiting its turn.
 */
export function activateLocalDataForAccount(userId: string, isCurrent: () => boolean = () => true): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (!isCurrent() || (current.activeUserId === userId && current.resolved)) return;
    // In memory first: every storage operation from here on uses the
    // account's partition. Persisted last; if the app dies before that, the
    // next launch repeats this same (idempotent) transition.
    setLocalDataOwnerState({ ...current, activeUserId: userId, resolved: true });
    await persistLocalDataOwnerState();
  });
}

/** Signed out (or a launch that resolved as signed out): the guest partition becomes the active one. */
export function activateGuestLocalData(): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    // Persisted even when already active in memory (hideAccountDataNow).
    setLocalDataOwnerState({ ...current, activeUserId: null, resolved: true });
    await persistLocalDataOwnerState();
  });
}

/**
 * A restored session whose account is not known (offline cold start without
 * a cached profile): the active partition is still the one this same
 * session activated at sign-in — sign-out always switches to the guest
 * partition — so it may be shown.
 */
export function confirmRestoredLocalDataOwner(): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (!current.resolved) setLocalDataOwnerState({ ...current, resolved: true });
  });
}

/** Whether to ask `userId` to add this device's guest data: there is some, and this account has not already chosen to keep it separate. */
export function guestDataAwaitsDecision(userId: string): Promise<boolean> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (current.keptSeparate.includes(userId)) return false;
    return (await guestHasReflections()) || (await guestHasFavorites());
  });
}

/** An interactive sign-in always asks again (a restored session does not). */
export function forgetGuestDataDecision(userId: string): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (!current.keptSeparate.includes(userId)) return;
    setLocalDataOwnerState({ ...current, keptSeparate: current.keptSeparate.filter((id) => id !== userId) });
    await persistLocalDataOwnerState();
  });
}

/** "Keep separate": the guest data stays guest data; this account sees only its own. */
export function keepGuestDataSeparate(userId: string): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (current.keptSeparate.includes(userId)) return;
    setLocalDataOwnerState({ ...current, keptSeparate: [...current.keptSeparate, userId] });
    await persistLocalDataOwnerState();
  });
}

/**
 * "Add to this account": merges the guest partition into `userId`'s
 * (newest entry per verseKey wins, deletion markers included). Each store's
 * guest copy is removed only after its merged result is written, so it is
 * never offered again — and an interrupted merge simply repeats. The next
 * sync uploads the merged data. Returns false if a store could not be read
 * (its guest data then stays where it is, untouched).
 */
export function mergeGuestDataIntoAccount(userId: string, isCurrent: () => boolean = () => true): Promise<boolean> {
  return serialized(async () => {
    // Never into an account whose session ended while the question was open.
    if (!isCurrent()) return false;
    const reflectionsMoved = await adoptGuestReflections(userId);
    const favoritesMoved = await adoptGuestFavorites(userId);
    notifyLocalDataChanged();
    return reflectionsMoved && favoritesMoved;
  });
}

/** After the account's own partition was cleared by account deletion: back to the guest partition. Other accounts' partitions are untouched. */
export function releaseLocalDataAfterAccountDeletion(userId: string): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    setLocalDataOwnerState({
      activeUserId: null,
      keptSeparate: current.keptSeparate.filter((id) => id !== userId),
      resolved: true,
    });
    await persistLocalDataOwnerState();
  });
}
