import { randomUUID } from 'node:crypto';

import type mongoose from 'mongoose';

import { UserReadingRecordModel, type UserReadingRecordEntity } from '../models/UserReadingRecord';
import { UserReadingSyncStateModel } from '../models/UserReadingSyncState';
import {
  decideReadingChange,
  exceedsReadingLimit,
  publicRecord,
  type ReadingChange,
  type ReadingChangeResult,
  type ReadingPullResult,
  type ReadingPushResult,
  type ReadingRecordKind,
  type StoredReadingState,
} from './readingSync';
import { withExistingUser } from './withExistingUser';

/** أورادي وختماتي sync on MongoDB; the rules are in readingSync.ts. Every function is scoped by a session-derived userId. */

type StoredDoc = Pick<UserReadingRecordEntity, 'kind' | 'recordId' | 'revision' | 'changeSeq' | 'deleted' | 'data' | 'ciphertext' | 'nonce' | 'encryptionVersion' | 'keyFingerprint'>;

function toState(doc: StoredDoc): StoredReadingState {
  return {
    kind: doc.kind as ReadingRecordKind,
    recordId: doc.recordId,
    revision: doc.revision,
    changeSeq: doc.changeSeq,
    deleted: doc.deleted,
    ...(doc.data ? { data: doc.data } : {}),
    // The unreleased encrypted format: content this server cannot serve.
    ...(!doc.deleted && !doc.data ? { legacy: true } : {}),
  };
}

/** Served records: deletion markers, and records with content (never legacy encrypted ones). */
const servable = { kind: { $in: ['wird', 'khatma', 'active'] }, $or: [{ deleted: true }, { data: { $exists: true } }] };

export async function pullReadingRecords(userId: string, since: number, limit: number): Promise<ReadingPullResult> {
  const state = await UserReadingSyncStateModel.findOne({ userId }).lean<{ syncId: string }>();
  const docs = await UserReadingRecordModel.find({ userId, changeSeq: { $gt: since }, ...servable })
    .sort({ changeSeq: 1 })
    .limit(limit + 1)
    .lean<StoredDoc[]>();
  const page = docs.slice(0, limit);
  return {
    syncId: state?.syncId ?? null,
    records: page.map((doc) => publicRecord(toState(doc))),
    nextSince: page.length > 0 ? page[page.length - 1].changeSeq : since,
    hasMore: docs.length > limit,
  };
}

/**
 * Applies a batch in ONE transaction (withExistingUser: never for a deleted
 * account). withExistingUser first writes the account's User document, so
 * concurrent pushes for one account serialize (MongoDB retries the loser's
 * transaction): changes commit in `changeSeq` order, and every decision
 * below sees the latest committed state — including another device's
 * confirmation of the same cycle. Deciding first (decideReadingChange) and
 * inserting only when no confirmed Khatma exists for the cycle means the
 * partial unique index is a last line of defence, never the normal path.
 */
export async function pushReadingChanges(userId: string, changes: readonly ReadingChange[]): Promise<ReadingPushResult> {
  return withExistingUser(userId, async (session) => {
    const state = await UserReadingSyncStateModel.findOneAndUpdate(
      { userId },
      { $setOnInsert: { syncId: randomUUID(), seq: 0 } },
      { upsert: true, returnDocument: 'after', session },
    ).lean<{ seq: number; syncId: string }>();
    let seq = state!.seq;
    const counts = await countRecords(userId, session);
    const results: ReadingChangeResult[] = [];

    for (const change of changes) {
      const existingDoc = await UserReadingRecordModel.findOne({ userId, kind: change.kind, recordId: change.recordId }).session(session).lean<StoredDoc & { legacyEncrypted?: unknown }>();
      const existing = existingDoc ? toState(existingDoc) : null;
      let cycleKhatma: StoredReadingState | null = null;
      if (change.kind === 'khatma' && change.action === 'upsert') {
        const holder = await UserReadingRecordModel.findOne({ userId, kind: 'khatma', cycleId: change.data.cycleId, deleted: false, recordId: { $ne: change.recordId } })
          .session(session).lean<StoredDoc>();
        if (holder && !holder.data) {
          // A legacy encrypted Khatma for this cycle under another id: set aside (kept, never served), so the device's own copy can take its place.
          await UserReadingRecordModel.updateOne({ userId, kind: 'khatma', recordId: holder.recordId }, { $set: { kind: 'legacy-khatma' } }).session(session);
        } else if (holder) {
          cycleKhatma = toState(holder);
        }
      }
      const decision = decideReadingChange(change, existing, cycleKhatma);
      if (!decision.write) {
        results.push({ kind: change.kind, recordId: change.recordId, status: decision.status, record: decision.current });
        continue;
      }
      if (exceedsReadingLimit(change, existing, counts)) {
        results.push({ kind: change.kind, recordId: change.recordId, status: 'limit' });
        continue;
      }

      seq += 1;
      const { write } = decision;
      const revision = (existing?.revision ?? 0) + 1;
      const legacyCiphertext = existing?.legacy && existingDoc?.ciphertext
        ? { ciphertext: existingDoc.ciphertext, nonce: existingDoc.nonce, encryptionVersion: existingDoc.encryptionVersion, keyFingerprint: existingDoc.keyFingerprint }
        : null;
      const update = write.deleted
        ? {
            // A deletion marker keeps no content of any kind.
            $set: { deleted: true, changeSeq: seq, revision },
            $unset: { data: 1, cycleId: 1, ciphertext: 1, nonce: 1, encryptionVersion: 1, keyFingerprint: 1, legacyEncrypted: 1 },
          }
        : {
            $set: {
              deleted: false,
              changeSeq: seq,
              revision,
              data: write.data,
              ...(write.data!.kind === 'khatma' ? { cycleId: write.data!.cycleId } : {}),
              // The replaced encrypted copy is kept aside, not deleted.
              ...(legacyCiphertext ? { legacyEncrypted: legacyCiphertext } : {}),
            },
            $unset: { ciphertext: 1, nonce: 1, encryptionVersion: 1, keyFingerprint: 1 },
          };
      const saved = await UserReadingRecordModel.findOneAndUpdate(
        { userId, kind: change.kind, recordId: change.recordId },
        update,
        // Input is validated by readingSyncValidators.ts.
        { upsert: true, returnDocument: 'after', session },
      ).lean<StoredDoc>();
      trackCounts(counts, change, existing, write.deleted);
      results.push({ kind: change.kind, recordId: change.recordId, status: 'applied', record: publicRecord(toState(saved!)) });
    }

    await UserReadingSyncStateModel.updateOne({ userId }, { $set: { seq } }, { session });
    return { syncId: state!.syncId, results };
  });
}

async function countRecords(userId: string, session: mongoose.ClientSession) {
  // Sequential: a transaction's session runs one operation at a time (see MongooseAccountDeletionService).
  const records = await UserReadingRecordModel.countDocuments({ userId }).session(session);
  const activeWirds = await UserReadingRecordModel.countDocuments({ userId, kind: 'wird', deleted: false }).session(session);
  const activeKhatmas = await UserReadingRecordModel.countDocuments({ userId, kind: 'khatma', deleted: false }).session(session);
  return { records, activeWirds, activeKhatmas };
}

function trackCounts(counts: { records: number; activeWirds: number; activeKhatmas: number }, change: ReadingChange, existing: StoredReadingState | null, deleted: boolean) {
  if (!existing) counts.records += 1;
  const wasActive = existing !== null && !existing.deleted;
  const delta = (deleted ? 0 : 1) - (wasActive ? 1 : 0);
  if (change.kind === 'wird') counts.activeWirds += delta;
  if (change.kind === 'khatma') counts.activeKhatmas += delta;
}
