import { getRandomBytes } from '@/crypto/randomBytes';
import { decryptReflectionText, encryptReflectionText } from '@/crypto/reflectionEncryption';
import {
  getAllReflections,
  getAllTombstones,
  markReflectionSyncState,
  putReflectionFromSync,
  putTombstoneFromSync,
} from '@/storage/ayahReflections';
import { getCloudReflections, putCloudReflections, type ReflectionSyncRecord } from './syncApi';

// Matches the backend's putReflectionsSchema batch cap (backend/src/validators/syncValidators.ts).
const UPLOAD_BATCH_SIZE = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Absent `type` means 'active' — see ReflectionActiveRecord's doc comment (backward compatibility with pre-tombstone cloud data). */
function isTombstoneRecord(record: ReflectionSyncRecord): record is Extract<ReflectionSyncRecord, { type: 'tombstone' }> {
  return record.type === 'tombstone';
}

/** A single comparable last-write-wins instant for any cloud record — an active record's `updatedAt`, or a tombstone's `deletedAt`. */
function recordTimestamp(record: ReflectionSyncRecord): number {
  return new Date(isTombstoneRecord(record) ? record.deletedAt : record.updatedAt).getTime();
}

/**
 * Whether a local tombstone still needs to be (re-)uploaded to converge
 * with the cloud. A tombstone wins an exact-timestamp tie against an
 * active record, so unlike the active-upload check below (`>=`), an
 * equal-timestamp cloud ACTIVE record still needs the tombstone pushed —
 * otherwise the backend would be left disagreeing with every device that
 * already deleted this verseKey. An equal-or-newer cloud TOMBSTONE, or a
 * strictly newer cloud active record (a genuine later recreation
 * elsewhere), never needs a re-upload.
 */
function tombstoneNeedsUpload(tombstone: { deletedAt: number }, cloud: ReflectionSyncRecord | undefined): boolean {
  if (!cloud) return true;
  const cloudTimestamp = recordTimestamp(cloud);
  return isTombstoneRecord(cloud) ? cloudTimestamp < tombstone.deletedAt : cloudTimestamp <= tombstone.deletedAt;
}

/**
 * Encrypt-then-upload every local reflection/tombstone that's newer than
 * (or absent from) the cloud, then decrypt-and-download every cloud
 * active/tombstone record that's newer than the local copy (Part D
 * §17/§29). The backend re-applies its own last-write-wins logic per
 * verseKey, so a race with another device is still handled safely even if
 * this device's view was briefly stale.
 *
 * Tombstones flow through this exactly like active records, just without
 * any encryption — a newer local tombstone is uploaded as-is, and a newer
 * cloud tombstone is downloaded and applied locally via
 * putTombstoneFromSync (which removes any local active reflection for that
 * verseKey). This is what stops a stale cloud copy from resurrecting a
 * reflection deleted on another device, while still letting a genuinely
 * newer active record supersede an older tombstone (intentional
 * recreation).
 */
export async function syncReflections(sessionToken: string, masterKey: Uint8Array): Promise<void> {
  const [localReflections, localTombstones, cloudReflections] = await Promise.all([
    getAllReflections(),
    getAllTombstones(),
    getCloudReflections(sessionToken),
  ]);
  const cloudByVerseKey = new Map(cloudReflections.map((record) => [record.verseKey, record]));

  const toUpload: ReflectionSyncRecord[] = [];

  for (const reflection of localReflections) {
    const cloud = cloudByVerseKey.get(reflection.verseKey);
    if (cloud && recordTimestamp(cloud) >= reflection.updatedAt) continue;

    const encrypted = encryptReflectionText(reflection.text, masterKey, getRandomBytes);
    toUpload.push({
      type: 'active',
      verseKey: reflection.verseKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      createdAt: new Date(reflection.createdAt).toISOString(),
      updatedAt: new Date(reflection.updatedAt).toISOString(),
    });
  }

  for (const tombstone of localTombstones) {
    if (!tombstoneNeedsUpload(tombstone, cloudByVerseKey.get(tombstone.verseKey))) continue;

    toUpload.push({ type: 'tombstone', verseKey: tombstone.verseKey, deletedAt: new Date(tombstone.deletedAt).toISOString() });
  }

  for (const batch of chunk(toUpload, UPLOAD_BATCH_SIZE)) {
    const result = await putCloudReflections(sessionToken, batch);
    await Promise.all(result.saved.map((saved) => markReflectionSyncState(saved.verseKey, 'synced')));
  }

  // Re-fetch: the uploads above may have changed what the server considers
  // current for verseKeys we just wrote.
  const refreshedCloud = toUpload.length > 0 ? await getCloudReflections(sessionToken) : cloudReflections;
  const localReflectionByVerseKey = new Map(localReflections.map((reflection) => [reflection.verseKey, reflection]));
  const localTombstoneByVerseKey = new Map(localTombstones.map((tombstone) => [tombstone.verseKey, tombstone]));

  for (const cloudRecord of refreshedCloud) {
    const localReflection = localReflectionByVerseKey.get(cloudRecord.verseKey);
    const localTombstone = localTombstoneByVerseKey.get(cloudRecord.verseKey);
    const localTimestamp = localReflection?.updatedAt ?? localTombstone?.deletedAt;
    const cloudTimestamp = recordTimestamp(cloudRecord);
    const cloudIsTombstone = isTombstoneRecord(cloudRecord);

    if (localTimestamp !== undefined) {
      if (localTimestamp > cloudTimestamp) continue;
      if (localTimestamp === cloudTimestamp) {
        // Exact-timestamp tie: the tombstone wins deterministically. A
        // local tombstone always wins (regardless of the cloud's kind), and
        // an active-vs-active tie is left alone here — the server's own
        // conflictVersions mechanism is what handles that ambiguity, not
        // the client. The only case that still needs applying below is a
        // local ACTIVE record losing to a cloud TOMBSTONE.
        const localIsTombstone = localTombstone !== undefined;
        if (localIsTombstone || !cloudIsTombstone) continue;
      }
    }

    if (cloudIsTombstone) {
      await putTombstoneFromSync({ verseKey: cloudRecord.verseKey, deletedAt: cloudTimestamp });
      continue;
    }

    try {
      const text = decryptReflectionText(cloudRecord, masterKey);
      await putReflectionFromSync({
        verseKey: cloudRecord.verseKey,
        text,
        createdAt: new Date(cloudRecord.createdAt).getTime(),
        updatedAt: cloudTimestamp,
      });
    } catch {
      // One record failing to decrypt (wrong key, corrupted data) must never
      // abort syncing the rest — see Part D §17.
    }
  }
}
