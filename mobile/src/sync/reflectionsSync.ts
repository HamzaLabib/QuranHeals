import { getRandomBytes } from '@/crypto/randomBytes';
import { decryptReflectionText, encryptReflectionText, masterKeyFingerprint } from '@/crypto/reflectionEncryption';
import {
  getAllReflections,
  getAllTombstones,
  markReflectionSyncState,
  markReflectionUploaded,
  putReflectionFromSync,
  putTombstoneFromSync,
  syncBaseOf,
  type AyahReflection,
  type ReflectionTombstone,
} from '@/storage/ayahReflections';
import { addConflictVersions, type NewConflictVersion } from '@/storage/reflectionConflicts';
import { getCloudReflectionConflicts, getCloudReflections, putCloudReflections, type ReflectionSyncRecord } from './syncApi';

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
 * Whether a local unsynced change was made without seeing this cloud
 * version, i.e. another device changed the reflection concurrently. A
 * synced entry, or an edit made on top of exactly this cloud version, is
 * sequential and follows plain last-write-wins.
 */
function isConcurrent(local: AyahReflection | ReflectionTombstone, cloud: ReflectionSyncRecord): boolean {
  return local.syncState !== 'synced' && syncBaseOf(local) !== recordTimestamp(cloud);
}

/** The server kept something other than the active record this device sent. */
function serverKeptDifferentVersion(sent: ReflectionSyncRecord, saved: ReflectionSyncRecord): boolean {
  if (isTombstoneRecord(sent)) return false; // a deletion carries no text to lose
  if (isTombstoneRecord(saved)) return true;
  return typeof saved.ciphertext === 'string' && (saved.ciphertext !== sent.ciphertext || saved.nonce !== sent.nonce);
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
 *
 * Concurrent edits (D5): last-write-wins still decides which version is
 * current everywhere, but the text that loses is never discarded. When this
 * device's unsynced change and another device's change were made without
 * seeing each other (isConcurrent), the losing text (this device's, or the
 * other device's it is about to replace) is kept on this device first
 * (storage/reflectionConflicts.ts), before anything is uploaded or
 * overwritten, for the user to review. Versions the server preserved for
 * exact-timestamp ties are fetched and decrypted here too. Decryption only
 * ever happens on the device.
 *
 * `ownerUserId` must be the account `sessionToken` and `masterKey` belong
 * to: only that account's local partition is ever read or written (see
 * storage/localDataOwner.ts), so another account's reflections can never be
 * encrypted under this key or uploaded here — even if the active account
 * changes while this sync is in flight.
 */
export async function syncReflections(sessionToken: string, masterKey: Uint8Array, ownerUserId: string): Promise<void> {
  const [localReflections, localTombstones, cloudReflections] = await Promise.all([
    getAllReflections(ownerUserId),
    getAllTombstones(ownerUserId),
    getCloudReflections(sessionToken),
  ]);
  const cloudByVerseKey = new Map(cloudReflections.map((record) => [record.verseKey, record]));

  const toUpload: ReflectionSyncRecord[] = [];
  // Tells the backend which key this ciphertext is under; it refuses
  // ciphertext under a key the account no longer uses (see syncKeyManager.ts).
  const keyFingerprint = masterKeyFingerprint(masterKey);
  const decryptOrNull = (record: ReflectionSyncRecord): string | null => {
    if (isTombstoneRecord(record)) return null;
    try {
      return decryptReflectionText(record, masterKey);
    } catch {
      return null;
    }
  };
  // Losing text to keep before anything is overwritten, and concurrent
  // verseKeys whose cloud version must replace the local one even at a tie.
  const keep: NewConflictVersion[] = [];
  const adoptCloud = new Set<string>();

  for (const reflection of localReflections) {
    const cloud = cloudByVerseKey.get(reflection.verseKey);
    if (cloud && isConcurrent(reflection, cloud)) {
      const cloudTimestamp = recordTimestamp(cloud);
      const cloudText = decryptOrNull(cloud);
      // An active cloud version this device cannot decrypt (wrong key,
      // corrupted data) cannot replace anything here either: the local text
      // simply stays current, as before, with nothing to keep.
      const unreadableCloud = cloudText === null && !isTombstoneRecord(cloud);
      if (!unreadableCloud && cloudText !== reflection.text) {
        if (cloudTimestamp >= reflection.updatedAt) {
          // The other device's change is current (newer, or the
          // deterministic tie): keep this device's unsynced text.
          keep.push({
            verseKey: reflection.verseKey,
            text: reflection.text,
            origin: 'this-device',
            versionUpdatedAt: reflection.updatedAt,
            ...(isTombstoneRecord(cloud) ? { supersededByDeletion: true } : {}),
          });
          adoptCloud.add(reflection.verseKey);
          continue;
        }
        // This device's newer edit becomes current: keep the other
        // device's text it replaces (if it can be read at all).
        if (cloudText !== null) {
          keep.push({ verseKey: reflection.verseKey, text: cloudText, origin: 'other-device', versionUpdatedAt: cloudTimestamp });
        }
      }
    }
    if (cloud && recordTimestamp(cloud) >= reflection.updatedAt) continue;

    const encrypted = encryptReflectionText(reflection.text, masterKey, getRandomBytes);
    toUpload.push({
      type: 'active',
      verseKey: reflection.verseKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      keyFingerprint,
      createdAt: new Date(reflection.createdAt).toISOString(),
      updatedAt: new Date(reflection.updatedAt).toISOString(),
    });
  }

  for (const tombstone of localTombstones) {
    const cloud = cloudByVerseKey.get(tombstone.verseKey);
    if (!tombstoneNeedsUpload(tombstone, cloud)) continue;
    // Deleting here without having seen another device's edit: that edit's
    // text is kept before the deletion replaces it.
    if (cloud && isConcurrent(tombstone, cloud)) {
      const cloudText = decryptOrNull(cloud);
      if (cloudText !== null) {
        keep.push({ verseKey: tombstone.verseKey, text: cloudText, origin: 'other-device', versionUpdatedAt: recordTimestamp(cloud) });
      }
    }

    toUpload.push({ type: 'tombstone', verseKey: tombstone.verseKey, deletedAt: new Date(tombstone.deletedAt).toISOString() });
  }

  // Persisted before any upload or download can replace the text. A
  // storage failure here aborts the sync with nothing overwritten.
  await addConflictVersions(ownerUserId, keep);

  const localTextByVerseKey = new Map(localReflections.map((reflection) => [reflection.verseKey, reflection.text]));
  for (const batch of chunk(toUpload, UPLOAD_BATCH_SIZE)) {
    const result = await putCloudReflections(sessionToken, batch);
    // Another device may have written between our read and this upload; the
    // server then keeps its version and returns it instead of ours.
    const sentByVerseKey = new Map(batch.map((record) => [record.verseKey, record]));
    const raced: NewConflictVersion[] = [];
    const racedVerseKeys = new Set<string>();
    for (const saved of result.saved) {
      const sent = sentByVerseKey.get(saved.verseKey);
      const text = localTextByVerseKey.get(saved.verseKey);
      if (!sent || text === undefined || !serverKeptDifferentVersion(sent, saved)) continue;
      racedVerseKeys.add(saved.verseKey);
      raced.push({
        verseKey: saved.verseKey,
        text,
        origin: 'this-device',
        versionUpdatedAt: recordTimestamp(sent),
        ...(isTombstoneRecord(saved) ? { supersededByDeletion: true } : {}),
      });
      adoptCloud.add(saved.verseKey);
    }
    await addConflictVersions(ownerUserId, raced);
    // Only the entry this sync uploaded is marked synced, never an edit made
    // meanwhile; such an edit is instead rebased on the version just stored.
    await Promise.all(result.saved.map((saved) => {
      const sent = sentByVerseKey.get(saved.verseKey);
      if (!sent) return markReflectionSyncState(saved.verseKey, 'synced', ownerUserId);
      if (racedVerseKeys.has(saved.verseKey)) return markReflectionSyncState(saved.verseKey, 'synced', ownerUserId, recordTimestamp(sent));
      return markReflectionUploaded(saved.verseKey, recordTimestamp(sent), ownerUserId);
    }));
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
      // A concurrent tie whose local text is already kept adopts the cloud
      // version, so every device converges on the same current text.
      if (localTimestamp === cloudTimestamp && !adoptCloud.has(cloudRecord.verseKey)) {
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

    // Applied only if the local entry is still the one read at the start, so
    // anything the user saved or deleted during this sync is never replaced.
    const expectedLocalTimestamp = localTimestamp ?? null;
    if (cloudIsTombstone) {
      await putTombstoneFromSync({ verseKey: cloudRecord.verseKey, deletedAt: cloudTimestamp }, ownerUserId, expectedLocalTimestamp);
      continue;
    }

    try {
      const text = decryptReflectionText(cloudRecord, masterKey);
      await putReflectionFromSync(
        {
          verseKey: cloudRecord.verseKey,
          text,
          createdAt: new Date(cloudRecord.createdAt).getTime(),
          updatedAt: cloudTimestamp,
        },
        ownerUserId,
        expectedLocalTimestamp,
      );
    } catch {
      // One record failing to decrypt (wrong key, corrupted data) must never
      // abort syncing the rest — see Part D §17.
    }
  }

  await importServerPreservedVersions(sessionToken, ownerUserId, decryptOrNull);
}

/**
 * Versions the server kept for exact-timestamp ties (possibly from other
 * devices). Best-effort: a backend without the endpoint, a network error or
 * an undecryptable version never fails the sync.
 */
async function importServerPreservedVersions(
  sessionToken: string,
  ownerUserId: string,
  decryptOrNull: (record: ReflectionSyncRecord) => string | null,
): Promise<void> {
  let conflicts;
  try {
    conflicts = await getCloudReflectionConflicts(sessionToken);
  } catch {
    return;
  }
  if (!Array.isArray(conflicts)) return;
  const versions: NewConflictVersion[] = [];
  for (const conflict of conflicts) {
    if (!conflict || typeof conflict.verseKey !== 'string' || !Array.isArray(conflict.conflictVersions)) continue;
    for (const version of conflict.conflictVersions) {
      const text = decryptOrNull({ type: 'active', verseKey: conflict.verseKey, ...version, updatedAt: version.createdAt });
      if (text === null) continue;
      const createdAt = new Date(version.createdAt).getTime();
      versions.push({ verseKey: conflict.verseKey, text, origin: 'server', versionUpdatedAt: Number.isFinite(createdAt) ? createdAt : Date.now(), serverNonce: version.nonce });
    }
  }
  if (versions.length === 0) return;
  const current = await getAllReflections(ownerUserId);
  await addConflictVersions(ownerUserId, versions, { currentTextByVerseKey: new Map(current.map((reflection) => [reflection.verseKey, reflection.text])) });
}
