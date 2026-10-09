import { existsSync, readFileSync } from 'node:fs';

import { assertOutsideRepository, FileLock, writeFileAtomic } from '../admin/localFiles';
import { isObjectIdHex } from '../utils/objectId';
import { addDays, MAX_HOLD_DAYS, parseTimestamp } from './retentionPolicy';

/**
 * Documented preservation exceptions (docs/data-retention.md). A hold stops
 * one specific record from being removed by a retention cleanup, only for a
 * listed reason, and only until a review date at most MAX_HOLD_DAYS away.
 * An expired hold protects nothing; renewing it is a new, deliberate
 * decision. There is no indefinite hold.
 *
 * Kept in a local JSON file outside the repository, next to the case store.
 * It holds no personal data: a case ID or an issue-report ObjectId, a
 * reason code and dates. Free-text notes belong in the operator's private
 * records, not here.
 */

export const HOLD_REASONS = ['legal-obligation', 'dispute', 'security-investigation'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

/** `deletion-case` covers the case record and that case's audit entries; `issue-report` one report by id. */
export const HOLD_KINDS = ['deletion-case', 'issue-report'] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export type PreservationHold = {
  kind: HoldKind;
  ref: string;
  reason: HoldReason;
  placedAt: string;
  reviewBy: string;
};

type HoldFile = { formatVersion: 1; holds: Record<string, PreservationHold> };

export class HoldError extends Error {}

const CASE_ID = /^DEL-\d{8}-\d{2,4}$/;

function key(kind: HoldKind, ref: string): string {
  return `${kind}:${ref}`;
}

export function parseHoldKind(value: string | undefined): HoldKind {
  if (!HOLD_KINDS.includes(value as HoldKind)) throw new HoldError(`--kind must be one of: ${HOLD_KINDS.join(', ')}.`);
  return value as HoldKind;
}

export function parseHoldReason(value: string | undefined): HoldReason {
  if (!HOLD_REASONS.includes(value as HoldReason)) throw new HoldError(`--reason must be one of: ${HOLD_REASONS.join(', ')}.`);
  return value as HoldReason;
}

function assertRef(kind: HoldKind, ref: string): void {
  const ok = kind === 'deletion-case' ? CASE_ID.test(ref) : isObjectIdHex(ref);
  if (!ok) throw new HoldError(kind === 'deletion-case' ? 'A deletion-case hold needs a case ID like DEL-YYYYMMDD-NN.' : 'An issue-report hold needs a 24-character report id.');
}

/**
 * The rules every hold must meet, wherever it is stored (this file, or the
 * retentionholds collection): a listed reason, a valid reference, and a
 * review date in the future at most MAX_HOLD_DAYS away.
 */
export function assertValidHold(input: { kind: HoldKind; ref: string; reason: HoldReason; reviewBy: Date }, now: Date): void {
  assertRef(input.kind, input.ref);
  if (!HOLD_REASONS.includes(input.reason)) throw new HoldError(`The reason must be one of: ${HOLD_REASONS.join(', ')}.`);
  if (!Number.isFinite(input.reviewBy.getTime()) || input.reviewBy.getTime() <= now.getTime()) throw new HoldError('The review date must be in the future.');
  if (input.reviewBy.getTime() > addDays(now, MAX_HOLD_DAYS).getTime()) {
    throw new HoldError(`A hold may last at most ${MAX_HOLD_DAYS} days; renew it at its review date if it is still needed.`);
  }
}

/** A read-only view used by cleanups: is this record under an active hold at `now`? */
export interface HoldChecker {
  isHeld(kind: HoldKind, ref: string, now: Date): boolean;
}

export const NO_HOLDS: HoldChecker = { isHeld: () => false };

export class PreservationHoldStore implements HoldChecker {
  private readonly lock: FileLock;

  constructor(private readonly path: string, repositoryRoot?: string) {
    assertOutsideRepository(path, 'holds file', repositoryRoot);
    this.lock = new FileLock(path);
  }

  private read(): HoldFile {
    if (!existsSync(this.path)) return { formatVersion: 1, holds: {} };
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as HoldFile;
    if (parsed?.formatVersion !== 1 || typeof parsed.holds !== 'object' || parsed.holds === null) {
      throw new HoldError('Holds file has an unrecognized format; refusing to use it.');
    }
    return parsed;
  }

  private write(file: HoldFile): void {
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }

  /** Places (or renews) a hold. `reviewBy` must be in the future and at most MAX_HOLD_DAYS away. */
  place(input: { kind: HoldKind; ref: string; reason: HoldReason; reviewBy: Date }, now: Date): PreservationHold {
    assertValidHold(input, now);
    return this.lock.run(() => {
      const file = this.read();
      const hold: PreservationHold = { kind: input.kind, ref: input.ref, reason: input.reason, placedAt: now.toISOString(), reviewBy: input.reviewBy.toISOString() };
      file.holds[key(input.kind, input.ref)] = hold;
      this.write(file);
      return hold;
    });
  }

  /** Removes a hold. Returns whether one existed. */
  release(kind: HoldKind, ref: string): boolean {
    return this.lock.run(() => {
      const file = this.read();
      const existed = key(kind, ref) in file.holds;
      if (existed) {
        delete file.holds[key(kind, ref)];
        this.write(file);
      }
      return existed;
    });
  }

  list(): PreservationHold[] {
    return Object.values(this.read().holds);
  }

  isHeld(kind: HoldKind, ref: string, now: Date): boolean {
    const hold = this.read().holds[key(kind, ref)];
    const reviewBy = hold ? parseTimestamp(hold.reviewBy) : null;
    return reviewBy !== null && now.getTime() < reviewBy.getTime();
  }

  /** Removes holds whose review date has passed (they no longer protect anything). Dry run unless `apply`. */
  pruneExpired(now: Date, apply: boolean): number {
    return this.lock.run(() => {
      const file = this.read();
      const expired = Object.entries(file.holds).filter(([, hold]) => {
        const reviewBy = parseTimestamp(hold.reviewBy);
        return reviewBy !== null && now.getTime() >= reviewBy.getTime();
      });
      if (apply && expired.length > 0) {
        for (const [holdKey] of expired) delete file.holds[holdKey];
        this.write(file);
      }
      return expired.length;
    });
  }
}
