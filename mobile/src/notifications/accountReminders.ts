import type { NotificationKind } from './types';

/**
 * Between account sync (auth/useAuth.tsx) and the reminders' provider
 * (useNotifications.tsx), without either importing the other: the
 * signed-in account's reminder settings are handed here, and the provider
 * applies them once its own stored settings have loaded — one that arrives
 * earlier waits for that (the latest per reminder), so it is never
 * replaced by the provider's own load.
 */
type Apply = (kind: NotificationKind, stored: unknown) => void;

let apply: Apply | null = null;
const waiting = new Map<NotificationKind, unknown>();

/** The account's reminder, in stored form (sync/preferenceFields.ts SyncedReminder). */
export function applyAccountReminder(kind: NotificationKind, stored: unknown): void {
  if (apply) apply(kind, stored);
  else waiting.set(kind, stored);
}

/** The provider, once loaded: applies what waited, then each later one. Returns the unregister function. */
export function registerAccountReminderApplier(next: Apply): () => void {
  apply = next;
  const held = [...waiting];
  waiting.clear();
  held.forEach(([kind, stored]) => next(kind, stored));
  return () => {
    if (apply === next) apply = null;
  };
}

/** Sign-out or another account: anything still waiting belonged to the session that ended. */
export function discardWaitingAccountReminders(): void {
  waiting.clear();
}
