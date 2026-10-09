import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import type { AuthProvider } from '../types/accountDomain';
import { assertOutsideRepository } from './localFiles';

/**
 * Email-ownership verification for deletion requests received by email
 * (see the private ACCOUNT-DELETION-WORKFLOW.md). The operator emails a
 * one-time code to the address stored on the account — never to the
 * request's From address — and enters the code the owner sends back.
 *
 * Kept in a local JSON file outside the repository, never in MongoDB: no
 * new production collection, and nothing here is needed by the app.
 * The file never holds the raw code or email: the code is stored as a
 * scrypt hash, the email as a salted fingerprint, and both are bound to
 * one exact account (userId + provider).
 *
 * A code is single-use (a verified case authorizes deletion of that one
 * account and nothing else), expires after CODE_TTL_MS, and locks after
 * MAX_ATTEMPTS wrong entries. ~60 bits of entropy, so with five attempts
 * guessing is not a practical attack.
 */

export const CODE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
// No 0/O, 1/I/L, U: unambiguous when read from an email and retyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 12;
const CASE_ID = /^DEL-\d{8}-\d{2,4}$/;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const FILE_FORMAT_VERSION = 1;

export type CaseStatus = 'pending' | 'verified' | 'locked' | 'completed';

export type DeletionCase = {
  caseId: string;
  userId: string;
  provider: AuthProvider;
  /** Salted scrypt of the normalized account email — proves "same address" without storing it. */
  emailFingerprint: string;
  codeHash: string;
  salt: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  status: CaseStatus;
  verifiedAt?: string;
  completedAt?: string;
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

export class DeletionCaseStore {
  constructor(private readonly path: string, repositoryRoot?: string) {
    assertOutsideRepository(path, 'case store', repositoryRoot);
  }

  private read(): CaseFile {
    if (!existsSync(this.path)) return { formatVersion: FILE_FORMAT_VERSION, cases: {} };
    const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as CaseFile;
    if (parsed?.formatVersion !== FILE_FORMAT_VERSION || typeof parsed.cases !== 'object') {
      throw new CaseError('Case store has an unrecognized format; refusing to use it.');
    }
    return parsed;
  }

  /** Write-then-rename, so an interrupted write never leaves a truncated store. */
  private write(file: CaseFile): void {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
  }

  get(caseId: string): DeletionCase | null {
    return this.read().cases[caseId] ?? null;
  }

  /** Creates the case and returns the one-time code. The code is shown once and never stored in readable form. */
  create(input: { caseId: string; userId: string; provider: AuthProvider; email: string }, now = Date.now()): string {
    assertCaseId(input.caseId);
    const file = this.read();
    if (file.cases[input.caseId]) throw new CaseError(`Case ${input.caseId} already exists; use a new case ID.`);
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
  }

  /** Checks a code the owner sent back. Every wrong entry counts; the case locks at MAX_ATTEMPTS. */
  verify(caseId: string, code: string, now = Date.now()): DeletionCase {
    const file = this.read();
    const entry = file.cases[caseId];
    if (!entry) throw new CaseError(`No case ${caseId}.`);
    if (entry.status === 'verified' || entry.status === 'completed') throw new CaseError('This code was already used.');
    if (entry.status === 'locked') throw new CaseError('This case is locked after too many wrong codes; start a new case.');
    if (now > Date.parse(entry.expiresAt)) throw new CaseError('This code has expired; start a new case.');

    if (!sameHash(hash(normalizeCode(code), entry.salt, 'code'), entry.codeHash)) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_ATTEMPTS) entry.status = 'locked';
      this.write(file);
      throw new CaseError(entry.status === 'locked' ? 'Wrong code. The case is now locked.' : `Wrong code (${MAX_ATTEMPTS - entry.attempts} attempts left).`);
    }

    entry.status = 'verified';
    entry.verifiedAt = new Date(now).toISOString();
    this.write(file);
    return entry;
  }

  /**
   * The case may authorize deleting this exact account: verified (or
   * already completed, for re-applying after a backup restore), and bound
   * to the same userId, provider and email.
   */
  assertAuthorizes(caseId: string, account: { userId: string; provider: AuthProvider; email: string }): DeletionCase {
    const entry = this.get(caseId);
    if (!entry) throw new CaseError(`No case ${caseId}. Verify ownership first (challenge, then verify).`);
    if (entry.status !== 'verified' && entry.status !== 'completed') {
      throw new CaseError(`Case ${caseId} is ${entry.status}; ownership has not been verified.`);
    }
    if (entry.userId !== account.userId || entry.provider !== account.provider || !this.matchesEmail(entry, account.email)) {
      throw new CaseError(`Case ${caseId} was verified for a different account.`);
    }
    return entry;
  }

  matchesEmail(entry: DeletionCase, email: string): boolean {
    return sameHash(hash(normalizeEmail(email), entry.salt, 'email'), entry.emailFingerprint);
  }

  markCompleted(caseId: string, now = Date.now()): void {
    const file = this.read();
    const entry = file.cases[caseId];
    if (!entry) throw new CaseError(`No case ${caseId}.`);
    entry.status = 'completed';
    entry.completedAt ??= new Date(now).toISOString();
    this.write(file);
  }
}
