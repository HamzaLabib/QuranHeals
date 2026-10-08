/**
 * The user's own edit to synced data on this device — currently saving or
 * deleting a reflection. The signed-in session (auth/useAuth.tsx) listens
 * and uploads the change right away, instead of only at the next
 * sign-in, app foreground or pull-to-refresh; for a guest nothing listens.
 * Carries no content: listeners run the ordinary full sync, which reads
 * what changed from local storage.
 *
 * Favorites have their own immediate upload (hooks/useFavorites.ts).
 */

const listeners = new Set<() => void>();

/** Returns the unsubscribe function. */
export function subscribeToLocalChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called after a local change has been saved (never before, never on failure). */
export function notifyLocalChange(): void {
  listeners.forEach((listener) => listener());
}
