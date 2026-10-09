import mongoose from 'mongoose';

import { IssueReportModel } from '../models/IssueReport';

import type { AuditEntry } from '../admin/deletionAudit';
import { assertValidHold, HOLD_REASONS, HoldError, type HoldChecker, type HoldReason } from '../retention/preservationHolds';
import { auditEntryDeadline, parseTimestamp } from '../retention/retentionPolicy';
import { isObjectIdHex } from '../utils/objectId';

/**
 * Durable state for the cloud (Render Cron Job) issue-report retention run,
 * which has no persistent disk: holds, audit history and the run lock live
 * in three small collections of the same database (docs/data-retention.md).
 *
 * The retention job's role holds exactly:
 *   issuereports    find, remove
 *   retentionholds  find                         (it can never place or lift a hold)
 *   retentionaudit  find, insert                 (append-only: it can't edit its own history)
 *   retentionlocks  find, insert, update, remove (one lock document)
 * and the holds admin exactly: retentionholds find, insert, update, remove.
 * Both are checked strictly at connect time (config/credentialScope.ts exactScopeProblems).
 */

export const RETENTION_COLLECTIONS = { holds: 'retentionholds', audit: 'retentionaudit', locks: 'retentionlocks' } as const;

export const RETENTION_JOB_PRIVILEGES: Readonly<Record<string, readonly string[]>> = {
  issuereports: ['find', 'remove'],
  [RETENTION_COLLECTIONS.holds]: ['find'],
  [RETENTION_COLLECTIONS.audit]: ['find', 'insert'],
  [RETENTION_COLLECTIONS.locks]: ['find', 'insert', 'update', 'remove'],
};

export const HOLDS_ADMIN_PRIVILEGES: Readonly<Record<string, readonly string[]>> = {
  [RETENTION_COLLECTIONS.holds]: ['find', 'insert', 'update', 'remove'],
};

/** The marker document whose presence proves the holds collection is the real, initialised one. */
export const HOLDS_META_ID = 'meta';
export const HOLDS_FORMAT_VERSION = 1;
export const RETENTION_LOCK_ID = 'issue-report-retention';
/** Far longer than a run (seconds), far shorter than the month between runs. Renewed immediately before deleting. */
export const RETENTION_LOCK_LEASE_MS = 15 * 60_000;

export class RetentionStoreError extends Error {}
export class RetentionLockError extends Error {}

type HoldDoc = { _id: string; kind?: unknown; ref?: unknown; reason?: unknown; placedAt?: unknown; reviewBy?: unknown; formatVersion?: unknown };
type AuditDoc = Omit<AuditEntry, 'at'> & { at: Date; expiresAt: Date };
type LockDoc = { _id: string; owner: string; acquiredAt: Date; expiresAt: Date };

function db() {
  const database = mongoose.connection.db;
  if (!database) throw new RetentionStoreError('Not connected to MongoDB.');
  return database;
}

const holdKey = (ref: string) => `issue-report:${ref}`;

// ---------------------------------------------------------------- holds

export type HoldSnapshot = HoldChecker & { activeAt(now: Date): number; total: number };

/**
 * Reads every hold, refusing (rather than assuming "no holds") when the
 * collection is missing its format marker or contains anything malformed:
 * a cleanup must never run on holds it can't fully trust.
 */
export async function loadMongoHolds(): Promise<HoldSnapshot> {
  let docs: HoldDoc[];
  try {
    docs = (await db().collection<HoldDoc>(RETENTION_COLLECTIONS.holds).find({}).toArray()) as HoldDoc[];
  } catch (error) {
    throw new RetentionStoreError(`The holds collection could not be read (${error instanceof Error ? error.name : 'error'}); nothing is deleted.`);
  }
  const meta = docs.find((doc) => doc._id === HOLDS_META_ID);
  if (!meta || meta.formatVersion !== HOLDS_FORMAT_VERSION) {
    throw new RetentionStoreError(
      `${RETENTION_COLLECTIONS.holds} has no format marker {_id: "${HOLDS_META_ID}", formatVersion: ${HOLDS_FORMAT_VERSION}}, so holds can't be confirmed; nothing is deleted. Initialise it with "issue-reports:holds init".`,
    );
  }
  const reviewByRef = new Map<string, Date>();
  for (const doc of docs) {
    if (doc._id === HOLDS_META_ID) continue;
    const reviewBy = doc.reviewBy instanceof Date ? doc.reviewBy : null;
    const valid =
      doc.kind === 'issue-report' &&
      typeof doc.ref === 'string' &&
      isObjectIdHex(doc.ref) &&
      doc._id === holdKey(doc.ref) &&
      HOLD_REASONS.includes(doc.reason as HoldReason) &&
      reviewBy !== null &&
      Number.isFinite(reviewBy.getTime());
    if (!valid) throw new RetentionStoreError(`${RETENTION_COLLECTIONS.holds} contains an invalid entry (${String(doc._id).slice(0, 60)}); nothing is deleted until it is fixed.`);
    reviewByRef.set(doc.ref as string, reviewBy as Date);
  }
  return {
    isHeld: (kind, ref, now) => kind === 'issue-report' && (reviewByRef.get(ref)?.getTime() ?? Number.NEGATIVE_INFINITY) > now.getTime(),
    activeAt: (now) => [...reviewByRef.values()].filter((date) => date.getTime() > now.getTime()).length,
    total: reviewByRef.size,
  };
}

export type StoredHold = { ref: string; reason: string; placedAt: string | null; reviewBy: string | null };

/** Holds management for the holds-admin user only (the retention job's role can't write here). */
export class MongoRetentionHoldsAdmin {
  private get collection() {
    return db().collection<HoldDoc>(RETENTION_COLLECTIONS.holds);
  }

  /** Creates the format marker if missing. Idempotent. */
  async init(): Promise<'created' | 'already-initialised'> {
    const existing = await this.collection.findOne({ _id: HOLDS_META_ID });
    if (existing) {
      if (existing.formatVersion !== HOLDS_FORMAT_VERSION) throw new RetentionStoreError(`The holds format marker has an unexpected version (${String(existing.formatVersion)}).`);
      return 'already-initialised';
    }
    await this.collection.insertOne({ _id: HOLDS_META_ID, formatVersion: HOLDS_FORMAT_VERSION });
    return 'created';
  }

  async place(input: { ref: string; reason: HoldReason; reviewBy: Date }, now: Date): Promise<StoredHold> {
    assertValidHold({ kind: 'issue-report', ...input }, now);
    await loadMongoHolds(); // refuses an uninitialised or corrupt collection before writing to it
    await this.collection.updateOne(
      { _id: holdKey(input.ref) },
      { $set: { kind: 'issue-report', ref: input.ref, reason: input.reason, placedAt: now, reviewBy: input.reviewBy } },
      { upsert: true },
    );
    return { ref: input.ref, reason: input.reason, placedAt: now.toISOString(), reviewBy: input.reviewBy.toISOString() };
  }

  async release(ref: string): Promise<boolean> {
    if (!isObjectIdHex(ref)) throw new HoldError('An issue-report hold needs a 24-character report id.');
    return (await this.collection.deleteOne({ _id: holdKey(ref) })).deletedCount === 1;
  }

  async list(): Promise<StoredHold[]> {
    const docs = await this.collection.find({ _id: { $ne: HOLDS_META_ID } }).toArray();
    return docs.map((doc) => ({
      ref: String(doc.ref),
      reason: String(doc.reason),
      placedAt: parseTimestamp(doc.placedAt)?.toISOString() ?? null,
      reviewBy: parseTimestamp(doc.reviewBy)?.toISOString() ?? null,
    }));
  }
}

// ---------------------------------------------------------------- audit

/** Where a retention run records itself: the local JSONL log (DeletionAuditLog) or retentionaudit. */
export interface RetentionAuditSink {
  preflight(): void | Promise<void>;
  append(entry: AuditEntry): void | Promise<void>;
}

const AUDIT_FIELDS: readonly (keyof AuditEntry)[] = ['environment', 'database', 'action', 'result', 'run', 'reportIds', 'deleted'];

/**
 * Append-only audit history in retentionaudit. Each entry carries
 * `expiresAt` = its time + 3 calendar years (retentionPolicy auditEntryDeadline,
 * leap days rolled forward, never earlier); a TTL index on `expiresAt`
 * (expireAfterSeconds 0, created once by an admin) removes it after that.
 * Ids and counts only, never report content.
 */
export class MongoRetentionAudit implements RetentionAuditSink {
  private get collection() {
    return db().collection<AuditDoc>(RETENTION_COLLECTIONS.audit);
  }

  async preflight(): Promise<void> {
    try {
      await this.collection.findOne({}, { projection: { _id: 1 } });
    } catch (error) {
      throw new RetentionStoreError(`The audit collection could not be read (${error instanceof Error ? error.name : 'error'}); nothing is deleted.`);
    }
  }

  async append(entry: AuditEntry): Promise<void> {
    const at = parseTimestamp(entry.at) ?? new Date();
    const doc = Object.fromEntries(AUDIT_FIELDS.filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]])) as Omit<AuditDoc, 'at' | 'expiresAt'>;
    await this.collection.insertOne({ ...doc, at, expiresAt: auditEntryDeadline(at) } as AuditDoc);
  }

  async entries(): Promise<AuditEntry[]> {
    const docs = await this.collection.find({ action: 'issue-report-retention' }, { projection: { _id: 0, expiresAt: 0 } }).sort({ at: 1 }).toArray();
    return docs.map((doc) => ({ ...doc, at: doc.at instanceof Date ? doc.at.toISOString() : String(doc.at) }) as AuditEntry);
  }

  /** Read-only setup check (needs listIndexes, which the read-only user has): is the 3-year TTL index in place? */
  async hasExpiryIndex(): Promise<boolean> {
    const indexes = await this.collection.listIndexes().toArray();
    return indexes.some((index) => index.key?.expiresAt === 1 && index.expireAfterSeconds === 0);
  }
}

// ---------------------------------------------------------------- lock

const NOW = '$$NOW';

/**
 * A lease lock on one document in retentionlocks, shared by every runner
 * (the Render cron job, a manual run, any other computer). All lease times
 * come from the database server's clock ($$NOW), never a runner's, so clock
 * differences between machines can't shorten or extend a lease.
 *
 *  - acquire: one atomic upsert. It matches only an EXPIRED lock document
 *    (and takes it over); with no document it inserts one; with a live one
 *    the upsert's insert hits the unique _id and fails with E11000 — held.
 *  - renew: extends the lease only while this run owns it and it is live.
 *  - deleteWithinLease: the fence. The lease check-and-extend and the
 *    report deletion run in ONE transaction, so a deletion can only commit
 *    while this run provably owns a live lease. If another run took the lock
 *    over (or does so concurrently — a write conflict on the lock document),
 *    the transaction aborts and nothing is deleted. Two workers therefore
 *    can never both delete.
 *  - release: deletes the document only if this run owns it.
 */
export class MongoRetentionLock {
  constructor(private readonly leaseMs = RETENTION_LOCK_LEASE_MS) {}

  private get collection() {
    return db().collection<LockDoc>(RETENTION_COLLECTIONS.locks);
  }

  private lostLease(): RetentionLockError {
    return new RetentionLockError('This run no longer holds the retention lock (its lease expired or another run took it over); it stops without deleting.');
  }

  async acquire(run: string): Promise<void> {
    // One atomic upsert on the lock's _id (MongoDB doesn't allow $expr in an upsert's filter): the pipeline
    // takes the lock only when it is missing or its lease has expired by the server clock, and otherwise
    // leaves the current holder untouched. Whoever owns it afterwards is the answer.
    const free = { $or: [{ $eq: [{ $type: '$expiresAt' }, 'missing'] }, { $lte: ['$expiresAt', NOW] }] };
    const take = [
      {
        $set: {
          owner: { $cond: [free, run, '$owner'] },
          acquiredAt: { $cond: [free, NOW, '$acquiredAt'] },
          expiresAt: { $cond: [free, { $add: [NOW, this.leaseMs] }, '$expiresAt'] },
        },
      },
    ];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.collection.updateOne({ _id: RETENTION_LOCK_ID }, take, { upsert: true });
        break;
      } catch (error) {
        // Two first-ever upserts racing: one inserts, the other gets E11000 and retries as an update.
        if ((error as { code?: unknown }).code !== 11000 || attempt === 1) throw error;
      }
    }
    const holder = await this.collection.findOne({ _id: RETENTION_LOCK_ID });
    if (holder?.owner === run) return;
    throw new RetentionLockError(
      `Another retention run holds the lock until ${holder?.expiresAt instanceof Date ? holder.expiresAt.toISOString() : 'an unknown time'}; nothing was deleted. ` +
        'If no run is active, it expires on its own; see "Recovery" in docs/data-retention.md.',
    );
  }

  async renew(run: string): Promise<void> {
    const result = await this.collection.updateOne(
      { _id: RETENTION_LOCK_ID, owner: run, $expr: { $gt: ['$expiresAt', NOW] } },
      [{ $set: { expiresAt: { $add: [NOW, this.leaseMs] } } }],
    );
    if (result.matchedCount !== 1) throw this.lostLease();
  }

  /**
   * Deletes exactly these due ids (with the createdAt backstop) inside one
   * transaction that first re-checks and extends this run's lease. With no
   * ids it still runs the fenced transaction (used by `verify` to prove the
   * transaction and lock permissions without deleting anything).
   */
  async deleteWithinLease(run: string, ids: string[], notAfter: Date): Promise<number> {
    const session = await mongoose.startSession();
    try {
      let deleted = 0;
      await session.withTransaction(async () => {
        deleted = 0;
        const lease = await this.collection.updateOne(
          { _id: RETENTION_LOCK_ID, owner: run, $expr: { $gt: ['$expiresAt', NOW] } },
          [{ $set: { expiresAt: { $add: [NOW, this.leaseMs] } } }],
          { session },
        );
        if (lease.matchedCount !== 1) throw this.lostLease();
        for (let i = 0; i < ids.length; i += 500) {
          const result = await IssueReportModel.deleteMany({ _id: { $in: ids.slice(i, i + 500) }, createdAt: { $lte: notAfter } }, { session });
          deleted += result.deletedCount;
        }
      });
      return deleted;
    } finally {
      await session.endSession();
    }
  }

  async release(run: string): Promise<void> {
    await this.collection.deleteOne({ _id: RETENTION_LOCK_ID, owner: run });
  }

  /** Read-only: who holds the lock, if anyone (for preflight/status). `now` is only used for display. */
  async state(now: Date): Promise<{ held: boolean; expiresAt: string | null; expired: boolean }> {
    const doc = await this.collection.findOne({ _id: RETENTION_LOCK_ID });
    if (!doc) return { held: false, expiresAt: null, expired: false };
    const expired = doc.expiresAt.getTime() <= now.getTime();
    return { held: !expired, expiresAt: doc.expiresAt.toISOString(), expired };
  }
}
