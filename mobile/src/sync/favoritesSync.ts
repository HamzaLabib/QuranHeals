import { getAyah } from '@/services/api';
import { resolveVerseKey } from '@/services/quranReference';
import { getAllFavoriteTombstones, getFavorites, putFavoriteFromSync, putFavoriteTombstoneFromSync } from '@/storage/favorites';
import { notifyLocalDataChanged } from '@/storage/localDataOwner';
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
 *    never the server's clock.
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
  if (!stored || recordTimestamp(stored) <= recordTimestamp(sent)) return;

  const current = await localRecordFor(ownerUserId, verseKey);
  if (!current || recordTimestamp(current) !== recordTimestamp(sent) || isTombstoneRecord(current) !== isTombstoneRecord(sent)) return;
  if (isTombstoneRecord(stored)) {
    await putFavoriteTombstoneFromSync({ verseKey, deletedAt: recordTimestamp(stored) }, ownerUserId);
  } else {
    const ayah = await getAyah(verseKey);
    await putFavoriteFromSync({ ...ayah, savedAt: stored.updatedAt }, ownerUserId);
  }
  notifyLocalDataChanged();
}
