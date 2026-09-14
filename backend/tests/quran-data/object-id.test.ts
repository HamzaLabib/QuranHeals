import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeVerifiedJsonBackup } from '../../src/utils/backupFile';
import {
  ARABIC_CLEANUP_BACKUPS_DIR,
  QURAN_DATA_BACKUPS_DIR,
} from '../../src/utils/backupPaths';
import {
  BACKUP_FORMAT_VERSION,
  decodeObjectIdHex,
  encodeObjectIdHex,
  OBJECT_ID_ENCODING,
  recordsRoundTripObjectIds,
  unwrapBackupEnvelope,
  wrapBackupEnvelope,
} from '../../src/utils/objectId';

// This suite proves MongoDB ObjectId round-trip safety for the backup format
// used by prepareArabicCleanup.ts / fullQuran.ts, independent of any real
// backup or database connection. Every write below goes to a freshly created
// OS temp directory - never to backend/backups/ (confirmed explicitly) - and
// nothing here imports mongoose beyond the plain `Types.ObjectId` class,
// which never connects to anything.

const DETERMINISTIC_HEX = '0123456789abcdef01234567';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'object-id-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('encodeObjectIdHex / decodeObjectIdHex', () => {
  it('round-trips a real ObjectId instance through encode -> decode -> equals original', () => {
    const original = new mongoose.Types.ObjectId(DETERMINISTIC_HEX);
    const encoded = encodeObjectIdHex(original);
    expect(encoded).toBe(DETERMINISTIC_HEX);

    const restored = decodeObjectIdHex(encoded);
    expect(restored).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(restored.toHexString()).toBe(original.toHexString());
    expect(restored.equals(original)).toBe(true);
  });

  it('round-trips an already-serialized hex string (JSON.stringify(ObjectId) shape)', () => {
    const original = new mongoose.Types.ObjectId(DETERMINISTIC_HEX);
    const serializedAsJsonWouldProduce = JSON.parse(JSON.stringify({ _id: original }))._id;
    expect(serializedAsJsonWouldProduce).toBe(DETERMINISTIC_HEX); // proves the driver's own toJSON() shape

    const restored = decodeObjectIdHex(serializedAsJsonWouldProduce);
    expect(restored.toHexString()).toBe(DETERMINISTIC_HEX);
  });

  it('round-trips MongoDB Extended JSON { $oid } shape', () => {
    const encoded = encodeObjectIdHex({ $oid: DETERMINISTIC_HEX });
    expect(encoded).toBe(DETERMINISTIC_HEX);
  });

  it('normalizes to lowercase', () => {
    expect(encodeObjectIdHex(DETERMINISTIC_HEX.toUpperCase())).toBe(DETERMINISTIC_HEX);
    expect(decodeObjectIdHex(DETERMINISTIC_HEX.toUpperCase()).toHexString()).toBe(DETERMINISTIC_HEX);
  });

  it('rejects a missing _id', () => {
    expect(() => encodeObjectIdHex(undefined)).toThrow(/missing/i);
  });

  it('rejects a null _id', () => {
    expect(() => encodeObjectIdHex(null)).toThrow(/null/i);
  });

  it('rejects an empty string', () => {
    expect(() => encodeObjectIdHex('')).toThrow();
    expect(() => decodeObjectIdHex('')).toThrow();
  });

  it('rejects a wrong-length hex string', () => {
    expect(() => encodeObjectIdHex('0123456789abcdef0123')).toThrow(); // 20 chars
    expect(() => encodeObjectIdHex('0123456789abcdef012345678')).toThrow(); // 26 chars
    expect(() => decodeObjectIdHex('0123456789abcdef0123')).toThrow();
  });

  it('rejects a non-hex string of the correct length', () => {
    expect(() => encodeObjectIdHex('zzzzzzzzzzzzzzzzzzzzzzzz')).toThrow();
    expect(() => decodeObjectIdHex('zzzzzzzzzzzzzzzzzzzzzzzz')).toThrow();
  });

  it('rejects an unexpected object shape', () => {
    expect(() => encodeObjectIdHex({ foo: 'bar' })).toThrow();
    expect(() => encodeObjectIdHex([1, 2, 3])).toThrow();
    expect(() => encodeObjectIdHex(12345)).toThrow();
  });
});

describe('backup envelope (formatVersion / objectIdEncoding)', () => {
  it('wraps and unwraps records unchanged', () => {
    const records = [{ _id: DETERMINISTIC_HEX, name: 'a' }];
    const envelope = wrapBackupEnvelope(records);
    expect(envelope.formatVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(envelope.objectIdEncoding).toBe(OBJECT_ID_ENCODING);
    expect(envelope.records).toEqual(records);

    const unwrapped = unwrapBackupEnvelope<typeof records>(JSON.parse(JSON.stringify(envelope)));
    expect(unwrapped).toEqual(records);
  });

  it('rejects an unsupported formatVersion', () => {
    const bad = { formatVersion: 999, objectIdEncoding: OBJECT_ID_ENCODING, records: [] };
    expect(() => unwrapBackupEnvelope(bad)).toThrow(/formatVersion/);
  });

  it('rejects an unsupported objectIdEncoding', () => {
    const bad = { formatVersion: BACKUP_FORMAT_VERSION, objectIdEncoding: 'base64', records: [] };
    expect(() => unwrapBackupEnvelope(bad)).toThrow(/objectIdEncoding/);
  });

  it('rejects an envelope missing records', () => {
    const bad = { formatVersion: BACKUP_FORMAT_VERSION, objectIdEncoding: OBJECT_ID_ENCODING };
    expect(() => unwrapBackupEnvelope(bad)).toThrow(/records/);
  });

  it('rejects a non-object parsed value', () => {
    expect(() => unwrapBackupEnvelope('just a string')).toThrow();
    expect(() => unwrapBackupEnvelope(null)).toThrow();
    expect(() => unwrapBackupEnvelope(42)).toThrow();
  });
});

describe('recordsRoundTripObjectIds', () => {
  it('proves exact round-trip equality for a deterministic ObjectId end-to-end through a real file write', () => {
    const original = new mongoose.Types.ObjectId(DETERMINISTIC_HEX);
    const originalRecords = [{ _id: original, arabicText: 'placeholder', surahNumber: 1, ayahNumber: 1 }];

    const backupPath = join(tempDir, 'backup.json');
    const backup = writeVerifiedJsonBackup(backupPath, wrapBackupEnvelope(originalRecords), (parsed) => {
      const unwrapped = unwrapBackupEnvelope<unknown[]>(parsed);
      return recordsRoundTripObjectIds(originalRecords, unwrapped);
    });

    // Read back independently (not reusing the utility's internal read) and
    // decode/restore the ObjectId ourselves, one more time, end to end.
    const bytesOnDisk = readFileSync(backupPath, 'utf-8');
    const parsed = JSON.parse(bytesOnDisk);
    const unwrapped = unwrapBackupEnvelope<{ _id: string }[]>(parsed);
    const restored = decodeObjectIdHex(unwrapped[0]._id);

    expect(restored).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(restored.equals(original)).toBe(true);
    expect(restored.toHexString()).toBe(DETERMINISTIC_HEX);
    expect(backup.sha256.length).toBe(64);
  });

  it('retains _id across multiple nested backup records', () => {
    const ids = ['0123456789abcdef01234567', '0123456789abcdef01234568', '0123456789abcdef01234569'].map(
      (hex) => new mongoose.Types.ObjectId(hex),
    );
    const originalRecords = ids.map((id, i) => ({ _id: id, index: i }));
    const roundTripped = JSON.parse(JSON.stringify(wrapBackupEnvelope(originalRecords))).records;

    expect(recordsRoundTripObjectIds(originalRecords, roundTripped)).toBe(true);
    roundTripped.forEach((record: { _id: string }, i: number) => {
      expect(decodeObjectIdHex(record._id).equals(ids[i])).toBe(true);
    });
  });

  it('rejects when the restored ObjectId does not match the original', () => {
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    const tampered = [{ _id: '0123456789abcdef01234568' }]; // one hex digit different
    expect(recordsRoundTripObjectIds(original, tampered)).toBe(false);
  });

  it('rejects duplicate _id records when uniqueness is required', () => {
    const sameId = new mongoose.Types.ObjectId(DETERMINISTIC_HEX);
    const original = [{ _id: sameId }, { _id: sameId }];
    const roundTripped = JSON.parse(JSON.stringify(original));
    // Real MongoDB _ids are always unique per collection; a backup with two
    // identical _ids is corrupted and must fail verification.
    expect(recordsRoundTripObjectIds(original, roundTripped)).toBe(false);
  });

  it('rejects a record with a missing _id', () => {
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    const parsed = [{ noId: true }];
    expect(recordsRoundTripObjectIds(original, parsed)).toBe(false);
  });

  it('rejects a record with a null _id', () => {
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    const parsed = [{ _id: null }];
    expect(recordsRoundTripObjectIds(original, parsed)).toBe(false);
  });

  it('rejects a mismatched record count', () => {
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    expect(recordsRoundTripObjectIds(original, [])).toBe(false);
  });
});

describe('backup verification blocks the guarded mutation when ObjectId round-trip fails', () => {
  it('never returns from a failed ObjectId verification, so a caller-side guarded mutation never runs', () => {
    const target = join(tempDir, 'backup.json');
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    let mutationRan = false;

    function guardedMutation() {
      writeVerifiedJsonBackup(target, wrapBackupEnvelope(original), (parsed) => {
        const unwrapped = unwrapBackupEnvelope<unknown[]>(parsed);
        // Deliberately compare against a record set that cannot match, to
        // simulate a corrupted backup failing ObjectId verification.
        return recordsRoundTripObjectIds([{ _id: new mongoose.Types.ObjectId('ffffffffffffffffffffffff') }], unwrapped);
      });
      mutationRan = true; // must never be reached
    }

    expect(guardedMutation).toThrow();
    expect(mutationRan).toBe(false);
  });

  it('exclusive wx write still refuses to overwrite an existing ObjectId-backup', () => {
    const target = join(tempDir, 'backup.json');
    const original = [{ _id: new mongoose.Types.ObjectId(DETERMINISTIC_HEX) }];
    const validate = (parsed: unknown) => recordsRoundTripObjectIds(original, unwrapBackupEnvelope<unknown[]>(parsed));

    writeVerifiedJsonBackup(target, wrapBackupEnvelope(original), validate);
    expect(() => writeVerifiedJsonBackup(target, wrapBackupEnvelope(original), validate)).toThrow();
  });
});

describe('real backup/report locations are never touched by this suite', () => {
  it('this suite only ever wrote into the OS temp directory', () => {
    expect(tempDir.startsWith(tmpdir())).toBe(true);
    expect(tempDir).not.toBe(QURAN_DATA_BACKUPS_DIR);
    expect(tempDir).not.toBe(ARABIC_CLEANUP_BACKUPS_DIR);
  });

  it('requires no MongoDB connection', () => {
    // Structural: nothing in this file calls mongoose.connect / .connection,
    // and every test above already ran without MONGODB_URI.
    expect(mongoose.connection.readyState).toBe(0); // 0 = disconnected
  });
});
