import { getRandomBytes } from '@/crypto/randomBytes';
import { decryptReflectionText, encryptReflectionText } from '@/crypto/reflectionEncryption';
import { getAllReflections, putReflectionFromSync, markReflectionSyncState } from '@/storage/ayahReflections';
import { getCloudReflections, putCloudReflections, type ReflectionRecord } from './syncApi';

// Matches the backend's putReflectionsSchema batch cap (backend/src/validators/syncValidators.ts).
const UPLOAD_BATCH_SIZE = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Encrypt-then-upload every local reflection that's newer than (or absent
 * from) the cloud, then decrypt-and-download every cloud reflection that's
 * newer than the local copy (Part D §17/§29). The backend re-applies its
 * own last-write-wins/conflict logic per verseKey, so a race with another
 * device is still handled safely even if this device's view was briefly
 * stale.
 */
export async function syncReflections(sessionToken: string, masterKey: Uint8Array): Promise<void> {
  const localReflections = await getAllReflections();
  const cloudReflections = await getCloudReflections(sessionToken);
  const cloudByVerseKey = new Map(cloudReflections.map((record) => [record.verseKey, record]));

  const toUpload: ReflectionRecord[] = [];
  for (const reflection of localReflections) {
    const cloud = cloudByVerseKey.get(reflection.verseKey);
    if (cloud && new Date(cloud.updatedAt).getTime() >= reflection.updatedAt) continue;

    const encrypted = encryptReflectionText(reflection.text, masterKey, getRandomBytes);
    toUpload.push({
      verseKey: reflection.verseKey,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      encryptionVersion: encrypted.encryptionVersion,
      createdAt: new Date(reflection.createdAt).toISOString(),
      updatedAt: new Date(reflection.updatedAt).toISOString(),
    });
  }

  for (const batch of chunk(toUpload, UPLOAD_BATCH_SIZE)) {
    const result = await putCloudReflections(sessionToken, batch);
    await Promise.all(result.saved.map((saved) => markReflectionSyncState(saved.verseKey, 'synced')));
  }

  // Re-fetch: the uploads above may have changed what the server considers
  // current for verseKeys we just wrote.
  const refreshedCloud = toUpload.length > 0 ? await getCloudReflections(sessionToken) : cloudReflections;
  const localByVerseKey = new Map(localReflections.map((reflection) => [reflection.verseKey, reflection]));

  for (const cloudRecord of refreshedCloud) {
    const local = localByVerseKey.get(cloudRecord.verseKey);
    const cloudUpdatedAt = new Date(cloudRecord.updatedAt).getTime();
    if (local && local.updatedAt >= cloudUpdatedAt) continue;

    try {
      const text = decryptReflectionText(cloudRecord, masterKey);
      await putReflectionFromSync({
        verseKey: cloudRecord.verseKey,
        text,
        createdAt: new Date(cloudRecord.createdAt).getTime(),
        updatedAt: cloudUpdatedAt,
      });
    } catch {
      // One record failing to decrypt (wrong key, corrupted data) must never
      // abort syncing the rest — see Part D §17.
    }
  }
}
