import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AccountDeletionService } from '../services/AccountDeletionService';
import { revokeAppleThenDelete } from '../services/revokeAppleThenDelete';
import type { AuthProvider } from '../types/accountDomain';
import { isObjectIdHex } from '../utils/objectId';
import type { AppleRevocationOutcome, AuditResult, DeletionAuditLog } from './deletionAudit';
import { CaseError, normalizeEmail, type DeletionCaseStore } from './deletionCases';

/**
 * Development-only administrative deletion for verified email requests
 * (scripts/adminDeleteAccount.ts is the CLI). Never decides identity on its
 * own: deletion needs a verified case (deletionCases.ts) bound to the exact
 * account, plus an exact user id, provider and email, plus a typed
 * confirmation. The deletion itself is the in-app path's own
 * revokeAppleThenDelete + AccountDeletionService — nothing re-implemented.
 */

export type AdminAccount = {
  userId: string;
  provider: AuthProvider;
  email?: string;
  emailVerified?: boolean;
  createdAt?: string;
};

/** Per-collection document counts for one user id. Tombstones are counted within their collection's total and also shown separately. */
export type RecordCounts = {
  User: number;
  Session: number;
  UserFavorite: number;
  UserPreference: number;
  UserReflection: number;
  UserSyncKey: number;
  AppleCredential: number;
  tombstones: { UserFavorite: number; UserReflection: number };
};

export interface AdminAccountStore {
  findAccountsByEmail(email: string, provider?: AuthProvider): Promise<AdminAccount[]>;
  findAccountById(userId: string): Promise<AdminAccount | null>;
  countRecords(userId: string): Promise<RecordCounts>;
  countIssueReportsByEmail(email: string): Promise<number>;
  deleteIssueReportsByEmail(email: string): Promise<number>;
}

/** `exitCode` lets the CLI tell "refused, nothing done" (1/2) from a failure partway (3/4/5). */
export class AdminDeletionError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

export const EXIT = { refused: 1, mismatch: 2, apple: 3, verify: 4, delete: 5 } as const;

export type AccountIdentity = { userId: string; provider: AuthProvider; email: string };

export function parseProvider(value: string | undefined): AuthProvider {
  if (value !== 'apple' && value !== 'google') throw new AdminDeletionError('Provider must be "apple" or "google".', EXIT.refused);
  return value;
}

export function totalRecords(counts: RecordCounts): number {
  return counts.User + counts.Session + counts.UserFavorite + counts.UserPreference + counts.UserReflection + counts.UserSyncKey + counts.AppleCredential;
}

/** Counts only — never contents. */
export function deletedCounts(counts: RecordCounts): Record<string, number> {
  const { tombstones: _tombstones, ...rest } = counts;
  return rest;
}

export function confirmationFor(userId: string): string {
  return `delete-account:${userId}`;
}

/** Read-only. Several matches (the same email on an Apple and a Google account) are all listed; nothing is chosen for the operator. */
export async function lookupAccounts(store: AdminAccountStore, email: string, provider?: AuthProvider) {
  const accounts = await store.findAccountsByEmail(normalizeEmail(email), provider);
  return Promise.all(accounts.map(async (account) => ({
    userId: account.userId,
    provider: account.provider,
    emailVerified: account.emailVerified ?? false,
    createdAt: account.createdAt ?? null,
    records: await store.countRecords(account.userId),
  })));
}

/**
 * Loads the account by its exact id and refuses unless provider AND email
 * match what the operator expects — so a mistyped id can never resolve to
 * a different person's account. Returns null if no account has this id.
 */
export async function loadExpectedAccount(store: AdminAccountStore, identity: AccountIdentity): Promise<AdminAccount | null> {
  if (!isObjectIdHex(identity.userId)) throw new AdminDeletionError('User id must be a 24-character hex id.', EXIT.refused);
  const account = await store.findAccountById(identity.userId);
  if (!account) return null;
  if (account.provider !== identity.provider) {
    throw new AdminDeletionError('Provider does not match this account. Nothing was changed.', EXIT.mismatch);
  }
  if (!account.email || normalizeEmail(account.email) !== normalizeEmail(identity.email)) {
    throw new AdminDeletionError('Email does not match this account. Nothing was changed.', EXIT.mismatch);
  }
  return account;
}

/**
 * Starts email verification for one exact account. Refuses accounts whose
 * email the provider never verified (Google), since mailbox control would
 * prove nothing; those owners must delete in the app instead.
 */
export async function startChallenge(store: AdminAccountStore, cases: DeletionCaseStore, caseId: string, identity: AccountIdentity, now?: number) {
  const account = await loadExpectedAccount(store, identity);
  if (!account) throw new AdminDeletionError('No account has this id. Nothing was created.', EXIT.refused);
  if (account.provider === 'google' && account.emailVerified !== true) {
    throw new AdminDeletionError('Google has not verified this account\'s email, so email verification cannot prove ownership. Ask the owner to delete in the app.', EXIT.refused);
  }
  return cases.create({ caseId, userId: account.userId, provider: account.provider, email: identity.email }, now);
}

export type DeletionPlan = {
  status: 'found' | 'not-found';
  userId: string;
  provider: AuthProvider;
  records: RecordCounts | null;
  apple: 'revoke-stored-token' | 'no-stored-token' | 'not-applicable';
};

/** Read-only plan for `delete` without --apply. */
export async function planDeletion(store: AdminAccountStore, identity: AccountIdentity): Promise<DeletionPlan> {
  const account = await loadExpectedAccount(store, identity);
  if (!account) return { status: 'not-found', userId: identity.userId, provider: identity.provider, records: null, apple: 'not-applicable' };
  const records = await store.countRecords(account.userId);
  const apple = account.provider !== 'apple' ? 'not-applicable' : records.AppleCredential > 0 ? 'revoke-stored-token' : 'no-stored-token';
  return { status: 'found', userId: account.userId, provider: account.provider, records, apple };
}

export type ApplyDeps = {
  store: AdminAccountStore;
  cases: DeletionCaseStore;
  audit: DeletionAuditLog;
  appleCredentialRepository: AppleCredentialRepository;
  appleRevocationClient: AppleRevocationClient;
  accountDeletionService: AccountDeletionService;
  target: { environment: string; databaseName: string };
  now?: () => number;
};

export type ApplyInput = AccountIdentity & {
  caseId: string;
  confirm: string | undefined;
  acknowledgeNoAppleToken: boolean;
};

export type ApplyReport = {
  result: AuditResult;
  userId: string;
  provider: AuthProvider;
  appleRevocation: AppleRevocationOutcome;
  deleted: Record<string, number>;
};

/**
 * Deletes one verified account. Order: confirmation → verified case bound
 * to this account → exact account match → Apple token (or explicit
 * acknowledgement) → revoke then delete (shared helper) → recount (all 0)
 * → case completed + audit line. Every refusal happens before anything is
 * changed; every outcome after that point is audited.
 */
export async function applyDeletion(deps: ApplyDeps, input: ApplyInput): Promise<ApplyReport> {
  const now = deps.now ?? Date.now;
  if (input.confirm !== confirmationFor(input.userId)) {
    throw new AdminDeletionError(`Type --confirm ${confirmationFor(input.userId)} exactly to delete this account.`, EXIT.refused);
  }

  let caseEntry;
  try {
    caseEntry = deps.cases.assertAuthorizes(input.caseId, input);
  } catch (error) {
    throw new AdminDeletionError(error instanceof CaseError ? error.message : 'The case store could not be read.', EXIT.refused);
  }

  const audit = (result: AuditResult, extra: Partial<ApplyReport> = {}) =>
    deps.audit.append({
      case: input.caseId,
      at: new Date(now()).toISOString(),
      environment: deps.target.environment,
      database: deps.target.databaseName,
      action: 'delete-account',
      result,
      userId: input.userId,
      provider: input.provider,
      ...(extra.appleRevocation ? { appleRevocation: extra.appleRevocation } : {}),
      ...(extra.deleted ? { deleted: extra.deleted } : {}),
    });

  const account = await loadExpectedAccount(deps.store, input);
  if (!account) {
    // Already gone (deleted in the app, or by an earlier run): nothing to do, and the case is done.
    deps.cases.markCompleted(input.caseId, now());
    audit('not-found');
    return { result: 'not-found', userId: input.userId, provider: input.provider, appleRevocation: 'not-applicable', deleted: {} };
  }

  const before = await deps.store.countRecords(account.userId);

  let appleRefreshToken: string | null = null;
  let appleRevocation: AppleRevocationOutcome = 'not-applicable';
  if (account.provider === 'apple') {
    try {
      appleRefreshToken = await deps.appleCredentialRepository.get(account.userId);
    } catch {
      audit('failed:apple-credential');
      throw new AdminDeletionError('The stored Apple token could not be read (check APPLE_REFRESH_TOKEN_ENCRYPTION_KEY). Nothing was deleted.', EXIT.apple);
    }
    if (appleRefreshToken === null && !input.acknowledgeNoAppleToken) {
      throw new AdminDeletionError(
        'This Apple account has no stored token, so its Apple access cannot be revoked from here. Re-run with --acknowledge-no-apple-token and send the owner the manual-removal instructions. Nothing was deleted.',
        EXIT.refused,
      );
    }
    appleRevocation = appleRefreshToken === null ? 'no-token-acknowledged' : 'revoked';
  }

  let revoked = false;
  const trackingClient: AppleRevocationClient = {
    exchangeAuthorizationCode: (code, options) => deps.appleRevocationClient.exchangeAuthorizationCode(code, options),
    revokeRefreshToken: async (token) => {
      await deps.appleRevocationClient.revokeRefreshToken(token);
      revoked = true;
    },
  };

  try {
    await revokeAppleThenDelete({ appleRevocationClient: trackingClient, accountDeletionService: deps.accountDeletionService }, account.userId, appleRefreshToken);
  } catch {
    if (appleRefreshToken !== null && !revoked) {
      audit('failed:apple-revocation');
      throw new AdminDeletionError('Apple revocation failed. Nothing was deleted; it is safe to retry.', EXIT.apple);
    }
    audit('failed:delete', { appleRevocation });
    throw new AdminDeletionError('Deleting the account data failed and was rolled back. It is safe to retry.', EXIT.delete);
  }

  const after = await deps.store.countRecords(account.userId);
  if (totalRecords(after) !== 0) {
    audit('failed:verify', { appleRevocation });
    throw new AdminDeletionError('Records remain after deletion; investigate before retrying.', EXIT.verify);
  }

  const result: AuditResult = caseEntry.status === 'completed' ? 'deleted-again' : 'deleted';
  deps.cases.markCompleted(input.caseId, now());
  const deleted = deletedCounts(before);
  audit(result, { appleRevocation, deleted });
  return { result, userId: account.userId, provider: account.provider, appleRevocation, deleted };
}

/**
 * Issue reports have no userId; they can only be matched by the email the
 * reporter typed. Allowed only for a case whose verified account email is
 * that same address, and only with the exact current count typed back.
 */
export async function deleteIssueReports(
  deps: Pick<ApplyDeps, 'store' | 'cases' | 'audit' | 'target' | 'now'>,
  input: { caseId: string; email: string; confirm: string | undefined },
): Promise<{ deleted: number }> {
  const now = deps.now ?? Date.now;
  const entry = deps.cases.get(input.caseId);
  if (!entry || (entry.status !== 'verified' && entry.status !== 'completed')) {
    throw new AdminDeletionError(`Case ${input.caseId} is not verified.`, EXIT.refused);
  }
  if (!deps.cases.matchesEmail(entry, input.email)) {
    throw new AdminDeletionError('This email is not the verified address for this case.', EXIT.mismatch);
  }
  const count = await deps.store.countIssueReportsByEmail(normalizeEmail(input.email));
  if (input.confirm !== `delete-issue-reports:${count}`) {
    throw new AdminDeletionError(`Type --confirm delete-issue-reports:${count} exactly to delete these reports.`, EXIT.refused);
  }
  const deleted = count === 0 ? 0 : await deps.store.deleteIssueReportsByEmail(normalizeEmail(input.email));
  deps.audit.append({
    case: input.caseId,
    at: new Date(now()).toISOString(),
    environment: deps.target.environment,
    database: deps.target.databaseName,
    action: 'delete-issue-reports',
    result: 'issue-reports-deleted',
    deleted: { IssueReport: deleted },
  });
  return { deleted };
}

/** Read-only: accounts the audit log says were deleted but that exist again (e.g. after a backup restore). */
export async function restoreCheck(store: AdminAccountStore, audit: DeletionAuditLog) {
  const recorded = audit.deletedUserIds();
  const reappeared: { userId: string; case: string }[] = [];
  for (const entry of recorded) {
    if (await store.findAccountById(entry.userId)) reappeared.push(entry);
  }
  return { checked: recorded.length, reappeared };
}
