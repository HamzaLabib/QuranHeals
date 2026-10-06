import { getAyah } from '@/services/api';
import { resolveVerseKey } from '@/services/quranReference';
import { getAllFavoriteTombstones, getFavorites, putFavoriteFromSync, putFavoriteTombstoneFromSync } from '@/storage/favorites';
import { getCloudFavoriteSyncRecords, putCloudFavoriteSyncRecords, removeCloudFavorite, type FavoriteSyncRecord } from './syncApi';

/** Absent `type` means 'active' — mirrors reflectionsSync.ts's isTombstoneRecord. */
function isTombstoneRecord(record: FavoriteSyncRecord): record is Extract<FavoriteSyncRecord, { type: 'tombstone' }> {
  return record.type === 'tombstone';
}

/** A single comparable last-write-wins instant for any cloud record — an active record's `updatedAt`, or a tombstone's `deletedAt`. */
function recordTimestamp(record: FavoriteSyncRecord): number {
  return new Date(isTombstoneRecord(record) ? record.deletedAt : record.updatedAt).getTime();
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
 * `ownerUserId` must be the account `sessionToken` belongs to: only that
 * account's local partition is read or written (see storage/localDataOwner.ts).
 */
export async function syncFavorites(sessionToken: string, ownerUserId: string): Promise<void> {
  const [localFavorites, localTombstones, cloudRecords] = await Promise.all([
    getFavorites(ownerUserId),
    getAllFavoriteTombstones(ownerUserId),
    getCloudFavoriteSyncRecords(sessionToken),
  ]);
  const cloudByVerseKey = new Map(cloudRecords.map((record) => [record.verseKey, record]));

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
    await putCloudFavoriteSyncRecords(sessionToken, toUpload);
  }

  // Re-fetch: the upload above may have changed what the server considers
  // current for verseKeys we just wrote.
  const refreshedCloud = toUpload.length > 0 ? await getCloudFavoriteSyncRecords(sessionToken) : cloudRecords;
  const localByVerseKey = new Map(localFavorites.map((favorite) => [resolveVerseKey(favorite), favorite]));
  const localTombstoneByVerseKey = new Map(localTombstones.map((tombstone) => [tombstone.verseKey, tombstone]));

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

    if (isTombstoneRecord(cloudRecord)) {
      await putFavoriteTombstoneFromSync({ verseKey: cloudRecord.verseKey, deletedAt: cloudTimestamp }, ownerUserId);
      continue;
    }

    try {
      const ayah = await getAyah(cloudRecord.verseKey);
      await putFavoriteFromSync({ ...ayah, savedAt: cloudRecord.updatedAt }, ownerUserId);
    } catch {
      // One unresolved cloud favorite (e.g. a transient network error) must
      // never abort syncing the rest.
    }
  }
}

/**
 * Explicit removal must propagate — otherwise the next syncFavorites() would
 * silently resurrect it from a stale cloud copy. Local removal has already
 * happened by the time this is called (see hooks/useFavorites.ts); a cloud
 * failure here is surfaced to the caller via the thrown error but never
 * un-does the already-successful local removal — the next full sync still
 * carries the durable local tombstone and will retry.
 */
export function propagateFavoriteRemoval(sessionToken: string, verseKey: string): Promise<void> {
  return removeCloudFavorite(sessionToken, verseKey).then(() => undefined);
}
