import mongoose from 'mongoose';

/**
 * Backup envelope format for any backup whose records carry a MongoDB
 * ObjectId `_id`. `JSON.stringify` on a real ObjectId already serializes it
 * to its plain 24-character hex string (via `ObjectId#toJSON`), so that is
 * this repository's actual on-disk encoding today; this module makes that
 * fact explicit, versioned, and strictly validated instead of leaving it
 * implicit. No real backup exists yet (`backend/backups/` holds only
 * `.gitignore`), so introducing this format has no compatibility obligation.
 */
export const BACKUP_FORMAT_VERSION = 1 as const;
export const OBJECT_ID_ENCODING = 'hex24' as const;

export type ObjectIdBackupEnvelope<T> = {
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  objectIdEncoding: typeof OBJECT_ID_ENCODING;
  records: T;
};

export function wrapBackupEnvelope<T>(records: T): ObjectIdBackupEnvelope<T> {
  return { formatVersion: BACKUP_FORMAT_VERSION, objectIdEncoding: OBJECT_ID_ENCODING, records };
}

/** Unwraps a parsed backup envelope, or throws if the version/encoding is unrecognized. */
export function unwrapBackupEnvelope<T>(parsed: unknown): T {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Backup envelope is not an object.');
  }
  const candidate = parsed as Partial<ObjectIdBackupEnvelope<T>>;
  if (candidate.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`Unsupported backup formatVersion: ${JSON.stringify(candidate.formatVersion)}`);
  }
  if (candidate.objectIdEncoding !== OBJECT_ID_ENCODING) {
    throw new Error(`Unsupported objectIdEncoding: ${JSON.stringify(candidate.objectIdEncoding)}`);
  }
  if (!('records' in candidate)) {
    throw new Error('Backup envelope is missing records.');
  }
  return candidate.records as T;
}

const OBJECT_ID_HEX_PATTERN = /^[0-9a-f]{24}$/i;

export function isObjectIdHex(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID_HEX_PATTERN.test(value);
}

/**
 * Extracts the canonical lowercase 24-character hex ObjectId from a record's
 * `_id`, however it arrived: a real `mongoose.Types.ObjectId` instance, an
 * already-serialized hex string, or MongoDB Extended JSON `{ $oid: "..." }`.
 * Throws on a missing, `null`, or unrecognizable value rather than silently
 * coercing it.
 */
export function encodeObjectIdHex(id: unknown): string {
  if (id === undefined) throw new Error('_id is missing.');
  if (id === null) throw new Error('_id is null.');
  if (id instanceof mongoose.Types.ObjectId) return id.toHexString();
  if (typeof id === 'string') {
    if (!isObjectIdHex(id)) throw new Error(`_id "${id}" is not a valid 24-character hex ObjectId.`);
    return id.toLowerCase();
  }
  if (typeof id === 'object' && id !== null && '$oid' in (id as Record<string, unknown>)) {
    const oid = (id as { $oid: unknown }).$oid;
    if (!isObjectIdHex(oid)) throw new Error('_id.$oid is not a valid 24-character hex ObjectId.');
    return (oid as string).toLowerCase();
  }
  throw new Error('_id is not a recognized ObjectId representation.');
}

/**
 * Reconstructs a real `mongoose.Types.ObjectId` from its canonical hex
 * string. Throws on any malformed input (wrong length, non-hex characters,
 * wrong type) rather than silently constructing a different identity.
 */
export function decodeObjectIdHex(hex: unknown): mongoose.Types.ObjectId {
  if (!isObjectIdHex(hex)) {
    throw new Error(`Cannot decode ObjectId: ${JSON.stringify(hex)} is not a valid 24-character hex string.`);
  }
  return new mongoose.Types.ObjectId(hex);
}

/**
 * Proves that every record in `parsedRecords` (as read back from a written
 * backup) still carries the exact same `_id` as the corresponding record in
 * `originalRecords` (as fetched from MongoDB before serialization) — encode
 * the original, decode the parsed copy back into a real ObjectId, and
 * compare the hex value exactly. Also rejects a backup whose record count
 * differs, or whose `_id` values are not unique (a Mongo `_id` is always
 * unique per collection; a backup that violates that is corrupted).
 */
export function recordsRoundTripObjectIds(originalRecords: readonly unknown[], parsedRecords: readonly unknown[]): boolean {
  if (!Array.isArray(originalRecords) || !Array.isArray(parsedRecords) || parsedRecords.length !== originalRecords.length) {
    return false;
  }

  const seenHex = new Set<string>();

  return originalRecords.every((original, index) => {
    if (typeof original !== 'object' || original === null) return false;
    const candidate = parsedRecords[index];
    if (typeof candidate !== 'object' || candidate === null) return false;
    try {
      const originalHex = encodeObjectIdHex((original as { _id?: unknown })._id);
      const restored = decodeObjectIdHex((candidate as { _id?: unknown })._id);
      if (restored.toHexString() !== originalHex) return false;
      if (seenHex.has(originalHex)) return false; // duplicate _id: reject
      seenHex.add(originalHex);
      return true;
    } catch {
      return false;
    }
  });
}
