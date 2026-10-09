import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { completedCaseDeadline, isDue, parseTimestamp, uncompletedCaseDeadline } from '../retention/retentionPolicy';
import { NO_HOLDS, type HoldChecker } from '../retention/preservationHolds';
import type { AuthProvider } from '../types/accountDomain';
import { assertOutsideRepository, FileLock, writeFileAtomic } from './localFiles';

/**
 * Email-ownership verification for deletion requests received by email
 * (docs/account-deletion-requests.md). The operator emails a one-time code
 * to the address stored on the account — never to the request's From
 * address — and enters the code the owner sends back.
 *
 * Kept in a local JSON file outside the repository, never in MongoDB. The
 * file never holds the raw code or email: the code is stored as a scrypt
 * hash, the email as a salted scrypt fingerprint, and both are bound to one
 * exact account (userId + provider).
 *
 * Code rules:
 *  - generated with crypto.randomInt (CSPRNG), 12 symbols from a 30-letter
 *    alphabet (~59 bits);
 *  - valid for exactly CODE_TTL_MS (15 minutes) from issue: valid while
 *    now < expiresAt, expired from expiresAt on;
 *  - single use: a verified code can never verify again, and a case
 *    authorizes exactly one deletion run — once completed it authorizes
 *    nothing (replay refused);
 *  - locks after MAX_ATTEMPTS wrong entries;
 *  - issuing a new code for an account supersedes every earlier pending
 *    code for that same account.
 * Every read-modify-write holds an exclusive file lock (FileLock), so two
 * terminals can never verify or use the same case concurrently.
 */

export const CODE_TTL_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
// No 0/O, 1/I/L, U: unambiguous when read from an email and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 12;
const CASE_ID = /^DEL-\d{8}-\d{2,4}$/;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const FILE_FORMAT_VERSION = 1;

/**
 * pending → verified → completed, or pending → locked / superseded.
 * "Expired" is not stored: a pending case is expired once now >= expiresAt.
 */
export type CaseStatus = 'pending' | 'verified' | 'locked' | 'superseded' | 'completed';

export type DeletionCase = {
  caseId: string;
  userId: string;
  provider: AuthProvider;
  /** Salted scrypt of the account's normalized stored email — proves "same address" without storing it. */
  emailFingerprint: string;
  codeHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  status: CaseStatus;
  verifiedAt?: string;
  completedAt?: string;
  lockedAt?: string;
  supersededAt?: string;
};

type CaseFile = { formatVersion: typeof FILE_FORMAT_VERSION; cases: Record<string, DeletionCase> };

export class CaseError extends Error {}

/** Matches the User schema (trim + lowercase), so lookups and fingerprints agree with what is stored. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function assertCaseId(caseId: string): void {
  if (!CASE_ID.test(caseId)) throw new CaseError('Case ID must look like DEL-YYYYMMDD-NN.');
}

export function generateVerificationCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** Tolerates case, spaces and hyphens in what the owner typed back. */
export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

function hash(value: string, salt: string, purpose: 'code' | 'email'): string {
  return scryptSync(`${purpose}:${value}`, Buffer.from(salt, 'base64'), 32, SCRYPT_PARAMS).toString('base64');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  return left.length === right.length && timingSafeEqual(left, right);
}

function isExpired(entry: DeletionCase, now: number): boolean {
  const expiresAt = Date.parse(entry.expiresAt);
  const createdAt = Date.parse(entry.createdAt);
  // Both checks: a stored expiresAt can never stretch a code past 15 minutes from issue.
  return !(now < expiresAt) || !(now < createdAt + CODE_TTL_MS);
}

export type CasePruneCategory = 'completed' | 'expired-or-locked' | 'superseded' | 'verified-not-completed';

export type CasePruneReport = {
  mode: 'dry-run' | 'apply';
  eligible: Record<CasePruneCategory, number>;
  /** Eligible by age but under an active preservation hold. */
  held: number;
  /** Not yet due (including every active, unexpired case). */
  retained: number;
  /** Missing or invalid timestamps: never removed automatically. */
  undatable: number;
  removed: number;
};

export class DeletionCaseStore {
  private readonly lock: FileLock;

  constructor(private readonly path: string, repositoryRoot?: string) {
    assertOutsideRepository(path, 'case store', repositoryRoot);
    this.lock = new FileLock(path);
  }

  private read(): CaseFile {
    if (!existsSync(this.path)) return { formatVersion: FILE_FORMAT_VERSION, cases: {} };
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CaseFile;
    if (parsed?.formatVersion !== FILE_FORMAT_VERSION || typeof parsed.cases !== 'object' || parsed.cases === null) {
      throw new CaseError('Case store has an unrecognized format; refusing to use it.');
    }
    return parsed;
  }

  private write(file: CaseFile): void {
    writeFileAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`);
  }

  /** Runs `fn` while holding this store's exclusive lock (used to make a whole deletion run one critical section). */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.lock.runAsync(fn);
  }

  get(caseId: string): DeletionCase | null {
    return this.lock.run(() => this.read().cases[caseId] ?? null);
  }

  /**
   * Creates the case for one exact account and returns the one-time code,
   * which is never stored in readable form. `email` must be the address
   * stored on the account. Supersedes every earlier pending case for the
   * same account, so only the newest code can ever verify.
   */
  create(input: { caseId: string; userId: string; provider: AuthProvider; email: string }, now = Date.now()): string {
    assertCaseId(input.caseId);
    return this.lock.run(() => {
      const file = this.read();
      if (file.cases[input.caseId]) throw new CaseError(`Case ${input.caseId} already exists; use a new case ID.`);
      for (const other of Object.values(file.cases)) {
        if (other.status === 'pending' && other.userId === input.userId && other.provider === input.provider) {
          other.status = 'superseded';
          other.supersededAt = new Date(now).toISOString();
        }
      }
      const code = generateVerificationCode();
      const salt = randomBytes(16).toString('base64');
      file.cases[input.caseId] = {
        caseId: input.caseId,
        userId: input.userId,
        provider: input.provider,
        emailFingerprint: hash(normalizeEmail(input.email), salt, 'email'),
        codeHash: hash(normalizeCode(code), salt, 'code'),
        salt,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
        attempts: 0,
        status: 'pending',
      };
      this.write(file);
      return code;
    });
  }

  /** Checks a code the owner sent back. Every wrong entry counts; the case locks at MAX_ATTEMPTS. */
  verify(caseId: string, code: string, now = Date.now()): DeletionCase {
    return this.lock.run(() => {
      const file = this.read();
      const entry = file.cases[caseId];
      if (!entry) throw new CaseError(`No case ${caseId}.`);
      if (entry.status === 'verified' || entry.status === 'completed') throw new CaseError('This code was already used.');
      if (entry.status === 'locked') throw new CaseError('This case is locked after too many wrong codes; start a new case.');
      if (entry.status === 'superseded') throw new CaseError('A newer code was issued for this account; this one can no longer be used.');
      if (isExpired(entry, now)) throw new CaseError('This code has expired; start a new case.');

      if (!sameHash(hash(normalizeCode(code), entry.salt, 'code'), entry.codeHash)) {
        entry.attempts += 1;
        if (entry.attempts >= MAX_ATTEMPTS) {
          entry.status = 'locked';
          entry.lockedAt = new Date(now).toISOString();
        }
        this.write(file);
        throw new CaseError(entry.status === 'locked' ? 'Wrong code. The case is now locked.' : `Wrong code (${MAX_ATTEMPTS - entry.attempts} attempts left).`);
      }

      entry.status = 'verified';
      entry.verifiedAt = new Date(now).toISOString();
      this.write(file);
      return entry;
    });
  }

  /**
   * The case that authorizes one deletion run: verified, never yet
   * completed. A completed case authorizes nothing (replay refused).
   */
  assertAuthorizes(caseId: string): DeletionCase {
    const entry = this.get(caseId);
    if (!entry) throw new CaseError(`No case ${caseId}. Verify ownership first (challenge, then verify).`);
    if (entry.status === 'completed') throw new CaseError(`Case ${caseId} is already completed; it cannot authorize another deletion.`);
    if (entry.status !== 'verified') throw new CaseError(`Case ${caseId} is ${entry.status}; ownership has not been verified.`);
    return entry;
  }

  /** Whether `email` (normalized) is the address the case was verified for. */
  matchesEmail(entry: DeletionCase, email: string): boolean {
    return sameHash(hash(normalizeEmail(email), entry.salt, 'email'), entry.emailFingerprint);
  }

  markCompleted(caseId: string, now = Date.now()): void {
    this.lock.run(() => {
      const file = this.read();
      const entry = file.cases[caseId];
      if (!entry) throw new CaseError(`No case ${caseId}.`);
      if (entry.status !== 'verified' && entry.status !== 'completed') throw new CaseError(`Case ${caseId} is ${entry.status}; it cannot be completed.`);
      entry.status = 'completed';
      entry.completedAt ??= new Date(now).toISOString();
      this.write(file);
    });
  }

  /**
   * Retention cleanup (docs/data-retention.md). Completed cases are
   * removed 60 days after completion; every other case 30 days after its
   * code expired. Never removes an active (unexpired) case, a case under an
   * active preservation hold, or a case it cannot date. Dry run unless
   * `apply`; repeated runs are safe.
   */
  prune(now: Date, options: { apply: boolean; holds?: HoldChecker; expectedCount?: number }): CasePruneReport {
    const holds = options.holds ?? NO_HOLDS;
    return this.lock.run(() => {
      const file = this.read();
      const report: CasePruneReport = {
        mode: options.apply ? 'apply' : 'dry-run',
        eligible: { completed: 0, 'expired-or-locked': 0, superseded: 0, 'verified-not-completed': 0 },
        held: 0,
        retained: 0,
        undatable: 0,
        removed: 0,
      };
      const toRemove: string[] = [];

      for (const entry of Object.values(file.cases)) {
        let deadline: Date | null;
        let category: CasePruneCategory;
        if (entry.status === 'completed') {
          const completedAt = parseTimestamp(entry.completedAt);
          deadline = completedAt && completedCaseDeadline(completedAt);
          category = 'completed';
        } else {
          const expiresAt = parseTimestamp(entry.expiresAt);
          deadline = expiresAt && uncompletedCaseDeadline(expiresAt);
          category = entry.status === 'superseded' ? 'superseded' : entry.status === 'verified' ? 'verified-not-completed' : 'expired-or-locked';
        }

        if (!deadline) report.undatable++;
        else if (entry.status === 'pending' && !isExpired(entry, now.getTime())) report.retained++;
        else if (!isDue(deadline, now)) report.retained++;
        else if (holds.isHeld('deletion-case', entry.caseId, now)) report.held++;
        else {
          report.eligible[category]++;
          toRemove.push(entry.caseId);
        }
      }

      if (options.apply && options.expectedCount !== undefined && toRemove.length !== options.expectedCount) {
        throw new CaseError(`The number of eligible cases changed (${toRemove.length}, confirmed ${options.expectedCount}). Nothing was removed; run the dry run again.`);
      }
      if (options.apply && toRemove.length > 0) {
        for (const caseId of toRemove) delete file.cases[caseId];
        this.write(file);
        report.removed = toRemove.length;
      }
      return report;
    });
  }

  /** Number of eligible cases in a report (what an apply would remove). */
  static eligibleCount(report: CasePruneReport): number {
    return Object.values(report.eligible).reduce((sum, n) => sum + n, 0);
  }
}
