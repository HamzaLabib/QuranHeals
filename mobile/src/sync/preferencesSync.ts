import { parseCloudPreferences, SYNCED_PREFERENCE_FIELDS, type SyncedPreferenceField, type SyncedPreferenceValue } from './preferenceFields';
import { loadAccountPreferenceState, updateAccountPreferenceState, type PreferenceEntry } from './preferencesSyncState';
import { getCloudPreferences, putCloudPreferences } from './syncApi';

/** Applies an account value on this device (the settings' setters with `fromSync`, so it is not recorded as the user's change). */
export type ApplyPreference = (field: SyncedPreferenceField, value: SyncedPreferenceValue) => void;

export type PreferenceSyncOptions = {
  /** False once the session this sync runs for has ended: nothing more is applied on the device. */
  isCurrent?: () => boolean;
};

/** One preference sync per account at a time: a full sync and an immediate upload never interleave. */
const queues = new Map<string, Promise<unknown>>();
function oneAtATime<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(userId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.catch(() => undefined);
  queues.set(userId, settled);
  void settled.then(() => {
    if (queues.get(userId) === settled) queues.delete(userId);
  });
  return run;
}

/**
 * Settings sync for one signed-in account, field by field
 * (sync/preferenceFields.ts; the server's rules are
 * backend/src/services/preferencesMerge.ts). Runs on every full sync
 * (sign-in, launch, foreground, pull-to-refresh).
 *
 *  1. Download the account's settings. For each field:
 *     - a change made here for this account and not yet confirmed, newer
 *       than the account's → kept, and uploaded in step 2;
 *     - otherwise the account's value is applied on this device (settings
 *       follow the signed-in account);
 *     - a field the account has never stored is left as it is here, and
 *       NOT uploaded: only the user's own change while signed in to this
 *       account is (sync/preferencesSyncState.ts).
 *  2. Upload this account's pending changes (pushPreferences).
 */
export function syncPreferences(sessionToken: string, ownerUserId: string, apply: ApplyPreference, options: PreferenceSyncOptions = {}): Promise<void> {
  return oneAtATime(ownerUserId, async () => {
    const isCurrent = options.isCurrent ?? (() => true);
    const cloud = parseCloudPreferences(await getCloudPreferences(sessionToken));
    const toApply = await updateAccountPreferenceState(ownerUserId, (state) => {
      const adopted: [SyncedPreferenceField, SyncedPreferenceValue][] = [];
      for (const field of SYNCED_PREFERENCE_FIELDS) {
        const remote = cloud[field];
        if (!remote) continue;
        const entry = state.fields[field];
        if (entry && !entry.synced && entry.updatedAt > remote.at) continue;
        state.fields[field] = { value: remote.value, updatedAt: remote.at, synced: true };
        adopted.push([field, remote.value]);
      }
      return adopted;
    });
    if (isCurrent()) toApply.forEach(([field, value]) => apply(field, value));
    await upload(sessionToken, ownerUserId, apply, isCurrent);
  });
}

/** Uploads this account's pending setting changes now (a change made while signed in; see useAuth.tsx). A failure leaves them pending for the next sync. */
export function pushPreferences(sessionToken: string, ownerUserId: string, apply: ApplyPreference, options: PreferenceSyncOptions = {}): Promise<void> {
  return oneAtATime(ownerUserId, () => upload(sessionToken, ownerUserId, apply, options.isCurrent ?? (() => true)));
}

async function upload(sessionToken: string, ownerUserId: string, apply: ApplyPreference, isCurrent: () => boolean): Promise<void> {
  const state = await loadAccountPreferenceState(ownerUserId);
  const pending = SYNCED_PREFERENCE_FIELDS.flatMap((field) => {
    const entry = state.fields[field];
    return entry && !entry.synced ? [[field, entry] as [SyncedPreferenceField, PreferenceEntry]] : [];
  });
  if (pending.length === 0) return;

  const body: Record<string, unknown> = { fieldUpdatedAt: {} };
  let newest = 0;
  for (const [field, entry] of pending) {
    body[field] = entry.value;
    (body.fieldUpdatedAt as Record<string, string>)[field] = new Date(entry.updatedAt).toISOString();
    newest = Math.max(newest, entry.updatedAt);
  }
  // What a server from before per-field sync compares (it ignores fieldUpdatedAt and the newer settings).
  body.updatedAt = new Date(newest).toISOString();
  const saved = parseCloudPreferences(await putCloudPreferences(sessionToken, body as never));

  const toApply = await updateAccountPreferenceState(ownerUserId, (current) => {
    const adopted: [SyncedPreferenceField, SyncedPreferenceValue][] = [];
    for (const [field, sent] of pending) {
      const entry = current.fields[field];
      // Changed again while this was uploading: that newer change goes next time.
      if (!entry || entry.updatedAt !== sent.updatedAt || entry.synced) continue;
      const stored = saved[field];
      // Not stored (a server that does not know this setting yet): stays pending.
      if (!stored) continue;
      if (stored.at === sent.updatedAt && stored.value === sent.value) {
        entry.synced = true;
        continue;
      }
      if (stored.at >= sent.updatedAt) {
        // The account holds a newer value (another device), or the same
        // value at the newest instant of this upload (an older server).
        current.fields[field] = { value: stored.value, updatedAt: stored.at, synced: true };
        if (stored.value !== sent.value) adopted.push([field, stored.value]);
      }
    }
    return adopted;
  });
  if (isCurrent()) toApply.forEach(([field, value]) => apply(field, value));
}
