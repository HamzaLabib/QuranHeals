import { adoptGuestReflections } from './ayahReflections';
import { adoptGuestFavorites } from './favorites';
import { getLocalDataOwnerState, persistLocalDataOwnerState, setLocalDataOwnerState } from './localDataOwner';

/**
 * Ownership transitions for device-local reflections and favorites (see
 * localDataOwner.ts for the model). Serialized: transitions never interleave.
 *
 * Rules:
 *  - Signing in as the account that already owns the active partition
 *    changes nothing.
 *  - Signing in as a different account switches to that account's own
 *    partition. The previous account's data stays on the device, untouched,
 *    and is never shown to, synced for, or moved into the new account.
 *  - Guest data (created before any account signed in here) is adopted only
 *    by the FIRST account to sign in, and only while the guest partition is
 *    still adoptable.
 *  - Data from before ownership existed (an upgrade) is never assigned by
 *    guesswork:
 *      · a session that was already signed in across the upgrade keeps it —
 *        the previous version was already syncing all of this data to that
 *        same account, so nothing new reaches anyone;
 *      · otherwise it is adopted on sign-in only if it shows no sign of ever
 *        having been synced by an account (a never-signed-in guest);
 *      · otherwise it stays local and unclaimed in the guest partition.
 *  - Sign-out changes nothing: the signed-out account keeps owning the
 *    active partition.
 */

let chain: Promise<unknown> = Promise.resolve();

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = chain.then(operation, operation);
  chain = result.catch(() => undefined);
  return result;
}

/**
 * Makes `userId`'s partition the active one. Must complete before that
 * account's first sync. `restored` means the session already existed when
 * the app started (cold-start restore), as opposed to an interactive sign-in.
 */
export function activateLocalDataForAccount(userId: string, options: { restored: boolean }): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (current.activeUserId === userId && !current.legacyUndecided) return;

    const fromGuest = current.activeUserId === null;
    const adoptGuest =
      fromGuest &&
      (current.legacyUndecided ? options.restored || !current.legacyHasAccountEvidence : current.guestAdoptable);

    // Switch in memory first: every storage operation from here on uses the
    // account's partition; the adoption below merges anything that landed
    // in the guest partition before this point.
    setLocalDataOwnerState({
      activeUserId: userId,
      guestAdoptable: current.legacyUndecided ? adoptGuest : current.guestAdoptable,
      legacyUndecided: false,
      legacyHasAccountEvidence: false,
    });

    if (adoptGuest) {
      // If either store cannot be moved (unreadable data), its guest data
      // simply stays where it is — never overwritten, never sent anywhere.
      await adoptGuestReflections(userId);
      await adoptGuestFavorites(userId);
    }
    // Persisted last: if the app dies before this, the next launch repeats
    // the same (idempotent) transition.
    await persistLocalDataOwnerState();
  });
}

/** Records the outcome of a launch that resolved as signed out. Only matters right after an upgrade; otherwise changes nothing. */
export function settleLocalDataOwnerAsGuest(): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    if (!current.legacyUndecided) return;
    setLocalDataOwnerState({
      activeUserId: null,
      guestAdoptable: !current.legacyHasAccountEvidence,
      legacyUndecided: false,
      legacyHasAccountEvidence: false,
    });
    await persistLocalDataOwnerState();
  });
}

/** After the account's own partition was cleared by account deletion: back to the guest partition. Other accounts' partitions are untouched. */
export function releaseLocalDataAfterAccountDeletion(): Promise<void> {
  return serialized(async () => {
    const current = await getLocalDataOwnerState();
    setLocalDataOwnerState({ ...current, activeUserId: null, legacyUndecided: false, legacyHasAccountEvidence: false });
    await persistLocalDataOwnerState();
  });
}
