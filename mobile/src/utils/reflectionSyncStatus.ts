import type { Messages } from '@/localization/messages';
import type { SyncState } from '@/storage/ayahReflections';

/**
 * Maps a reflection's stored `syncState` to its localized display label on
 * the My Reflections list. `undefined` (never attempted) and the `'local'`
 * literal (reserved on the type, not currently ever written — see
 * ayahReflections.ts) both mean "device-only" and share the same label.
 */
export function resolveReflectionSyncStatusLabel(syncState: SyncState | undefined, messages: Messages): string {
  if (syncState === 'pending') return messages.reflections.statusPendingSync;
  if (syncState === 'synced') return messages.reflections.statusSynced;
  return messages.reflections.statusSavedOnDevice;
}
