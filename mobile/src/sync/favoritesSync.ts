import { getAyah } from '@/services/api';
import { localAyah } from '@/services/ayahForAction';
import { resolveVerseKey } from '@/services/quranReference';
import { getAllFavoriteTombstones, getFavorites, putFavoriteFromSync, putFavoriteTombstoneFromSync } from '@/storage/favorites';
import { notifyLocalDataChanged } from '@/storage/localDataOwner';
import type { Ayah, FavoriteAyah } from '@/types/domain';
import { getCloudFavoriteSyncRecords, putCloudFavoriteSyncRecords, type FavoriteSyncRecord } from './syncApi';

/** Absent `type` means 'active' — mirrors reflectionsSync.ts's isTombstoneRecord. */
function isTombstoneRecord(record: FavoriteSyncRecord): record is Extract<FavoriteSyncRecord, { type: 'tombstone' }> {
  return record.type === 'tombstone';
}

/** A single comparable last-write-wins instant for any cloud record — an active record's `updatedAt`, or a tombstone's `deletedAt`. */
function recordTimestamp(record: FavoriteSyncRecord): number {
  return new Date(isTombstoneRecord(record) ? record.deletedAt : record.updatedAt).getTime();
}

/**
 * The account stored this device's own change, but at an earlier instant
 * than the one sent: the server's time in place of a device clock running
 * ahead (backend/src/services/clientInstants.ts). The stored instant is the
 * one to keep here, so a later change on any device can still win. Only the
 * same kind of record — a different, older record is never applied over
 * the change sent (it is not this device's change).
 */
function storedEarlier(sent: FavoriteSyncRecord, stored: FavoriteSyncRecord): boolean {
  return isTombstoneRecord(sent) === isTombstoneRecord(stored) && recordTimestamp(stored) < recordTimestamp(sent);
}

/**
 * A cloud favorite's ayah for this device: built from the verified local
 * Quran database (services/ayahForAction.ts — its translation is fetched
 * later, exactly as for one saved offline: storage/favorites.ts
 * completePendingFavoriteTranslations), else the backend's. Null when
 * neither is available right now.
 */
async function restoredAyah(verseKey: string): Promise<Ayah | null> {
  try {
    return await localAyah(verseKey);
  } catch {
    // The local database could not provide it: the backend's, if reachable.
  }
  try {
    return await getAyah(verseKey);
  } catch {
    return null;
  }
}

/**
 * Whether a local tombstone still needs to be (re-)uploaded to converge
 * with the cloud — mirrors reflectionsSync.ts's tombstoneNeedsUpload. A
 * tombstone wins an exact-timestamp tie against an active record, so an
 * equal-timestamp cloud ACTIVE record still needs the tombstone pushed.
 */
function tombstoneNeedsUpload(tombstone: { deletedAt: number }, cloud: FavoriteSyncRecord | undefined): boolean {
  if (!cloud) return true;
  const cloudTimestamp = recordTimestamp(cloud);
  return isTombstoneRecord(cloud) ? cloudTimestamp < tombstone.deletedAt : cloudTimestamp <= tombstone.deletedAt;
}

/**
 * Upload every local favorite/tombstone that's newer than (or absent from)
 * the cloud, then download every cloud active/tombstone record that's
 * newer than the local copy — exactly mirrors reflectionsSync.ts's
 * syncReflections (minus encryption, which favorites never had). The
 * backend re-applies its own last-write-wins logic per verseKey, so a race
 * with another device is still handled safely even if this device's view
 * was briefly stale.
 *
 * This is what makes a deletion durable: a verseKey deleted while offline,
 * on another device, or after a failed immediate cloud delete can never be
 * silently re-added by this sync, because an explicit deletion tombstone —
 * not just the absence of the verseKey — is what's compared and uploaded.
 *
 * A downloaded favorite is restored from the local Quran database
 * (restoredAyah). One that cannot be restored yet is never dropped: the
 * account keeps it, nothing here deletes or overwrites it, and the result
 * is `false` so the caller retries (auth/useAuth.tsx). Anything changed on
 * this device while the sync runs is never replaced.
 *
 * `ownerUserId` must be the account `sessionToken` belongs to: only that
 * account's local partition is read or written (see storage/localDataOwner.ts).
 * Resolves true when every account favorite is on this device.
 */
export async function syncFavorites(sessionToken: string, ownerUserId: string): Promise<boolean> {
  const [localFavorites, localTombstones, cloudRecords] = await Promise.all([
    getFavorites(ownerUserId),
    getAllFavoriteTombstones(ownerUserId),
    getCloudFavoriteSyncRecords(sessionToken),
  ]);
  const cloudByVerseKey = new Map(cloudRecords.map((record) => [record.verseKey, record]));
  const localByVerseKey = new Map<string, FavoriteAyah>(localFavorites.map((favorite) => [resolveVerseKey(favorite), favorite]));
  const localTombstoneByVerseKey = new Map(localTombstones.map((tombstone) => [tombstone.verseKey, tombstone]));

  const toUpload: FavoriteSyncRecord[] = [];

  for (const favorite of localFavorites) {
    const verseKey = resolveVerseKey(favorite);
    const localTimestamp = new Date(favorite.savedAt).getTime();
    const cloud = cloudByVerseKey.get(verseKey);
    if (cloud && recordTimestamp(cloud) >= localTimestamp) continue;

    toUpload.push({ type: 'active', verseKey, createdAt: favorite.savedAt, updatedAt: favorite.savedAt });
  }

  for (const tombstone of localTombstones) {
    if (!tombstoneNeedsUpload(tombstone, cloudByVerseKey.get(tombstone.verseKey))) continue;

    toUpload.push({ type: 'tombstone', verseKey: tombstone.verseKey, deletedAt: new Date(tombstone.deletedAt).toISOString() });
  }

  if (toUpload.length > 0) {
    const response = await putCloudFavoriteSyncRecords(sessionToken, toUpload);
    const sentByVerseKey = new Map(toUpload.map((record) => [record.verseKey, record]));
    for (const stored of response?.saved ?? []) {
      const sent = sentByVerseKey.get(stored.verseKey);
      if (!sent || !storedEarlier(sent, stored)) continue;
      // Adopt the instant the account stored (see storedEarlier), unless
      // this favorite changed here meanwhile.
      const sentAt = recordTimestamp(sent);
      const acceptedAt = recordTimestamp(stored);
      if (isTombstoneRecord(stored)) {
        await putFavoriteTombstoneFromSync({ verseKey: stored.verseKey, deletedAt: acceptedAt }, ownerUserId, sentAt);
        localTombstoneByVerseKey.set(stored.verseKey, { verseKey: stored.verseKey, deleted: true, deletedAt: acceptedAt });
        continue;
      }
      const local = localByVerseKey.get(stored.verseKey);
      if (!local) continue;
      const adopted = { ...local, savedAt: new Date(acceptedAt).toISOString() };
      await putFavoriteFromSync(adopted, ownerUserId, sentAt);
      localByVerseKey.set(stored.verseKey, adopted);
    }
  }

  // Re-fetch: the upload above may have changed what the server considers
  // current for verseKeys we just wrote.
  const refreshedCloud = toUpload.length > 0 ? await getCloudFavoriteSyncRecords(sessionToken) : cloudRecords;
  let unresolved = 0;

  for (const cloudRecord of refreshedCloud) {
    const localFavorite = localByVerseKey.get(cloudRecord.verseKey);
    const localTombstone = localTombstoneByVerseKey.get(cloudRecord.verseKey);
    const localTimestamp = localFavorite ? new Date(localFavorite.savedAt).getTime() : localTombstone?.deletedAt;
    const cloudTimestamp = recordTimestamp(cloudRecord);
    const cloudIsTombstone = isTombstoneRecord(cloudRecord);

    if (localTimestamp !== undefined) {
      if (localTimestamp > cloudTimestamp) continue;
      if (localTimestamp === cloudTimestamp) {
        // Exact-timestamp tie: the tombstone wins deterministically, in
        // either direction — mirrors reflectionsSync.ts.
        const localIsTombstone = localTombstone !== undefined;
        if (localIsTombstone || !cloudIsTombstone) continue;
      }
    }

    // Applied only if the local entry is still the one read above.
    const expectedLocalTimestamp = localTimestamp ?? null;
    if (isTombstoneRecord(cloudRecord)) {
      await putFavoriteTombstoneFromSync({ verseKey: cloudRecord.verseKey, deletedAt: cloudTimestamp }, ownerUserId, expectedLocalTimestamp);
      continue;
    }

    // Already saved here: only its instant changes, its ayah stays.
    const ayah = localFavorite ?? (await restoredAyah(cloudRecord.verseKey));
    if (!ayah) {
      // Kept on the account and tried again at the next sync.
      unresolved++;
      continue;
    }
    try {
      await putFavoriteFromSync({ ...ayah, savedAt: cloudRecord.updatedAt }, ownerUserId, expectedLocalTimestamp);
    } catch {
      // One favorite failing to store (e.g. its local verse cannot be
      // resolved) must never abort syncing the rest; it is retried.
      unresolved++;
    }
  }

  return unresolved === 0;
}

/** This device's current record for `verseKey` in `ownerUserId`'s partition, as a sync record (null: none). */
async function localRecordFor(ownerUserId: string, verseKey: string): Promise<FavoriteSyncRecord | null> {
  const [favorites, tombstones] = await Promise.all([getFavorites(ownerUserId), getAllFavoriteTombstones(ownerUserId)]);
  const favorite = favorites.find((candidate) => resolveVerseKey(candidate) === verseKey);
  if (favorite) return { type: 'active', verseKey, createdAt: favorite.savedAt, updatedAt: favorite.savedAt };
  const tombstone = tombstones.find((candidate) => candidate.verseKey === verseKey);
  return tombstone ? { type: 'tombstone', verseKey, deletedAt: new Date(tombstone.deletedAt).toISOString() } : null;
}

/**
 * Uploads one favorite's current state right after the user adds, removes
 * or re-adds it (hooks/useFavorites.ts), through the same tombstone-aware
 * endpoint and the same last-write-wins rule as syncFavorites — stamped
 * with this device's own change time, so:
 *  - a re-add after a removal (here or on another device) replaces the
 *    account's deletion marker at once, instead of waiting for the next
 *    full sync;
 *  - a removal is a deletion marker carrying the time it was made here,
 *    never the server's clock — unless that time lies in the future, when
 *    the account stores its own time instead and this device adopts it
 *    (storedEarlier).
 * If the account already holds a newer change (another device), that one
 * is applied here, unless this device changed the favorite again meanwhile.
 * Throws on failure; the local change stands and the next full sync
 * carries it (the durable record or tombstone is what it compares).
 * `ownerUserId` must be the account `sessionToken` belongs to.
 */
export async function pushFavoriteChange(sessionToken: string, ownerUserId: string, verseKey: string): Promise<void> {
  const sent = await localRecordFor(ownerUserId, verseKey);
  if (!sent) return;
  const { saved } = await putCloudFavoriteSyncRecords(sessionToken, [sent]);
  const stored = saved?.find((record) => record.verseKey === verseKey);
  if (!stored) return;
  const sentAt = recordTimestamp(sent);
  if (!storedEarlier(sent, stored) && recordTimestamp(stored) <= sentAt) return;

  const current = await localRecordFor(ownerUserId, verseKey);
  if (!current || recordTimestamp(current) !== sentAt || isTombstoneRecord(current) !== isTombstoneRecord(sent)) return;
  if (isTombstoneRecord(stored)) {
    await putFavoriteTombstoneFromSync({ verseKey, deletedAt: recordTimestamp(stored) }, ownerUserId, sentAt);
  } else {
    // Saved here (an adopted instant): its ayah stays; removed here: restored.
    const local = isTombstoneRecord(sent) ? undefined : (await getFavorites(ownerUserId)).find((candidate) => resolveVerseKey(candidate) === verseKey);
    const ayah = local ?? (await restoredAyah(verseKey));
    if (!ayah) return; // Left for the next full sync, which compares the account's record again.
    await putFavoriteFromSync({ ...ayah, savedAt: stored.updatedAt }, ownerUserId, sentAt);
  }
  notifyLocalDataChanged();
}
