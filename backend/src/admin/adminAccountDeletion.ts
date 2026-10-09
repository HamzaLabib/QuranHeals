import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AccountDeletionService } from '../services/AccountDeletionService';
import { revokeAppleThenDelete } from '../services/revokeAppleThenDelete';
import type { AuthProvider } from '../types/accountDomain';
import { isObjectIdHex } from '../utils/objectId';
import type { AppleRevocationOutcome, AuditResult, DeletionAuditLog } from './deletionAudit';
import { CaseError, normalizeEmail, type DeletionCase, type DeletionCaseStore } from './deletionCases';

/**
 * Administrative deletion for verified email requests
 * (scripts/adminDeleteAccount.ts is the CLI). Never decides identity on its
 * own and never accepts an account id from the requester:
 *  - the requester gives only a provider and an email; the operator picks
 *    the account from a lookup, and the challenge binds the case to that
 *    exact account (userId + provider + a fingerprint of its STORED email);
 *  - deletion takes only the case ID — the account comes from the verified
 *    case, and must still have the same provider and stored email;
 *  - the final step needs the operator's typed confirmation.
 * The deletion itself is the in-app path's own revokeAppleThenDelete +
 * AccountDeletionService — nothing re-implemented.
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

/**
 * MongoDB collections the deletion-only credential may find and remove in
 * (the account's own collections, plus issuereports for requested
 * issue-report deletion). Checked against the models in tests.
 */
export const DELETION_COLLECTIONS = [
  'users',
  'sessions',
  'userfavorites',
  'userpreferences',
  'userreflections',
  'usersynckeys',
  'applecredentials',
  'issuereports',
] as const;

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

/** The short reference shown to the operator and typed back: the last 6 characters of the user id. */
export function accountReference(userId: string): string {
  return userId.slice(-6);
}

/** What the operator must type, immediately before anything is deleted. */
export function finalConfirmationPhrase(userId: string): string {
  return `${accountReference(userId)} DELETE`;
}

export type EmailVerificationEligibility = 'eligible' | 'no-email' | 'google-email-unverified' | 'apple-email-unverified';

/**
 * Whether mailbox control can prove ownership of this account. Google:
 * only an email Google verified. Apple: the stored address (real or
 * private relay) unless Apple explicitly reported it unverified. No stored
 * email: never — those owners must delete in the app.
 */
export function emailVerificationEligibility(account: AdminAccount): EmailVerificationEligibility {
  if (!account.email) return 'no-email';
  if (account.provider === 'google' && account.emailVerified !== true) return 'google-email-unverified';
  if (account.provider === 'apple' && account.emailVerified === false) return 'apple-email-unverified';
  return 'eligible';
}

const INELIGIBLE_MESSAGE: Record<Exclude<EmailVerificationEligibility, 'eligible'>, string> = {
  'no-email': 'This account has no stored email address, so email verification cannot prove ownership. Ask the owner to delete in the app.',
  'google-email-unverified': 'Google has not verified this account\'s email, so email verification cannot prove ownership. Ask the owner to delete in the app.',
  'apple-email-unverified': 'Apple reported this account\'s email as unverified, so email verification cannot prove ownership. Ask the owner to delete in the app.',
};

/** Read-only. Several matches (the same email on an Apple and a Google account) are all listed; nothing is chosen for the operator. Never returns the email. */
export async function lookupAccounts(store: AdminAccountStore, email: string, provider?: AuthProvider) {
  const accounts = await store.findAccountsByEmail(normalizeEmail(email), provider);
  return Promise.all(accounts.map(async (account) => ({
    userId: account.userId,
    accountRef: accountReference(account.userId),
    provider: account.provider,
    emailVerified: account.emailVerified ?? false,
    emailVerification: emailVerificationEligibility(account),
    createdAt: account.createdAt ?? null,
    records: await store.countRecords(account.userId),
  })));
}

export type LookupMatch = Awaited<ReturnType<typeof lookupAccounts>>[number];

/**
 * Starts email verification for one exact account, picked by the operator
 * from a lookup of `requestEmail` + provider (never an id typed from the
 * request). Refuses unless the account still exists, has that provider,
 * its STORED email is exactly `requestEmail` (so the code goes to the
 * address on file), and it is eligible for email verification. Issuing a
 * code supersedes any earlier pending code for the account.
 */
export async function startChallenge(
  store: AdminAccountStore,
  cases: DeletionCaseStore,
  caseId: string,
  selected: { userId: string; provider: AuthProvider },
  requestEmail: string,
  now?: number,
): Promise<string> {
  if (!isObjectIdHex(selected.userId)) throw new AdminDeletionError('User id must be a 24-character hex id.', EXIT.refused);
  const account = await store.findAccountById(selected.userId);
  if (!account) throw new AdminDeletionError('No account has this id. Nothing was created.', EXIT.refused);
  if (account.provider !== selected.provider) throw new AdminDeletionError('Provider does not match this account. Nothing was created.', EXIT.mismatch);
  if (!account.email || normalizeEmail(account.email) !== normalizeEmail(requestEmail)) {
    throw new AdminDeletionError('The email entered is not the address stored on this account. Nothing was created.', EXIT.mismatch);
  }
  const eligibility = emailVerificationEligibility(account);
  if (eligibility !== 'eligible') throw new AdminDeletionError(INELIGIBLE_MESSAGE[eligibility], EXIT.refused);
  try {
    return cases.create({ caseId, userId: account.userId, provider: account.provider, email: account.email }, now);
  } catch (error) {
    if (error instanceof CaseError) throw new AdminDeletionError(error.message, EXIT.refused);
    throw error;
  }
}

function authorizedCase(cases: DeletionCaseStore, caseId: string): DeletionCase {
  try {
    return cases.assertAuthorizes(caseId);
  } catch (error) {
    throw new AdminDeletionError(error instanceof CaseError ? error.message : 'The case store could not be read.', EXIT.refused);
  }
}

/**
 * The account a verified case is bound to, re-checked against the
 * database: same provider, and its stored email still the verified one.
 * Null when the account no longer exists.
 */
async function loadCaseAccount(store: AdminAccountStore, cases: DeletionCaseStore, entry: DeletionCase): Promise<AdminAccount | null> {
  const account = await store.findAccountById(entry.userId);
  if (!account) return null;
  if (account.userId !== entry.userId || account.provider !== entry.provider) {
    throw new AdminDeletionError('The account no longer matches the verified case (provider). Nothing was changed.', EXIT.mismatch);
  }
  if (!account.email || !cases.matchesEmail(entry, account.email)) {
    throw new AdminDeletionError('The account\'s stored email changed since verification. Nothing was changed; start a new case.', EXIT.mismatch);
  }
  return account;
}

export type AppleHandling = 'revoke-stored-token' | 'no-stored-token' | 'not-applicable';

export type DeletionPlan = {
  status: 'found' | 'not-found';
  caseId: string;
  userId: string;
  accountRef: string;
  provider: AuthProvider;
  records: RecordCounts | null;
  apple: AppleHandling;
};

/** Read-only plan for `delete` without --apply: the account comes from the verified case. */
export async function planDeletion(store: AdminAccountStore, cases: DeletionCaseStore, caseId: string): Promise<DeletionPlan> {
  const entry = authorizedCase(cases, caseId);
  const base = { caseId, userId: entry.userId, accountRef: accountReference(entry.userId), provider: entry.provider };
  const account = await loadCaseAccount(store, cases, entry);
  if (!account) return { status: 'not-found', ...base, records: null, apple: 'not-applicable' };
  const records = await store.countRecords(account.userId);
  const apple: AppleHandling = account.provider !== 'apple' ? 'not-applicable' : records.AppleCredential > 0 ? 'revoke-stored-token' : 'no-stored-token';
  return { status: 'found', ...base, records, apple };
}

export type ApplyDeps = {
  store: AdminAccountStore;
  cases: DeletionCaseStore;
  audit: DeletionAuditLog;
  appleCredentialRepository: AppleCredentialRepository;
  appleRevocationClient: AppleRevocationClient;
  accountDeletionService: AccountDeletionService;
  /** Throws if Apple revocation is not configured (env.ts requireAppleRevocationConfig). */
  assertAppleRevocationConfigured: () => void;
  target: { environment: string; databaseName: string };
  now?: () => number;
};

export type ApplyInput = { caseId: string; acknowledgeNoAppleToken: boolean };

/** Shown to the operator immediately before the final confirmation. Never contains an email or token. */
export type ConfirmationPlan = DeletionPlan & { status: 'found'; records: RecordCounts; database: string; environment: string };

/** Returns true only if the operator typed the exact confirmation phrase. */
export type ConfirmDeletion = (plan: ConfirmationPlan) => Promise<boolean>;

export type ApplyReport = {
  result: AuditResult;
  caseId: string;
  userId: string;
  provider: AuthProvider;
  appleRevocation: AppleRevocationOutcome;
  deleted: Record<string, number>;
};

/**
 * Deletes the one account a verified case is bound to. The whole run holds
 * the case store's exclusive lock, so the same case can never be used by
 * two runs at once. Order:
 *   verified case → audit log writable → account re-checked against the
 *   case → record counts → Apple preflight (configuration, stored token
 *   decrypts, or explicit acknowledgement) → operator's typed confirmation
 *   → revoke then delete (shared helper) → recount (all 0) → case
 *   completed + audit line.
 * Every refusal and the confirmation happen before anything is changed;
 * every outcome after the confirmation is audited.
 */
export async function applyDeletion(deps: ApplyDeps, input: ApplyInput, confirm: ConfirmDeletion): Promise<ApplyReport> {
  const now = deps.now ?? Date.now;
  return deps.cases.exclusive(async () => {
    const entry = authorizedCase(deps.cases, input.caseId);
    try {
      deps.audit.preflight();
    } catch (error) {
      throw new AdminDeletionError(`The audit log is not writable (${(error as Error).message}). Nothing was changed.`, EXIT.refused);
    }

    const audit = (result: AuditResult, extra: { appleRevocation?: AppleRevocationOutcome; deleted?: Record<string, number> } = {}) =>
      deps.audit.append({
        case: input.caseId,
        at: new Date(now()).toISOString(),
        environment: deps.target.environment,
        database: deps.target.databaseName,
        action: 'delete-account',
        result,
        userId: entry.userId,
        provider: entry.provider,
        ...extra,
      });

    const account = await loadCaseAccount(deps.store, deps.cases, entry);
    if (!account) {
      // Already gone (deleted in the app meanwhile): nothing to do, and the case is done.
      deps.cases.markCompleted(input.caseId, now());
      audit('not-found');
      return { result: 'not-found', caseId: input.caseId, userId: entry.userId, provider: entry.provider, appleRevocation: 'not-applicable', deleted: {} };
    }

    const before = await deps.store.countRecords(account.userId);

    let appleRefreshToken: string | null = null;
    let appleRevocation: AppleRevocationOutcome = 'not-applicable';
    let apple: AppleHandling = 'not-applicable';
    if (account.provider === 'apple') {
      try {
        deps.assertAppleRevocationConfigured();
      } catch {
        throw new AdminDeletionError('Apple revocation is not configured (APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY, APPLE_CLIENT_ID). Nothing was deleted.', EXIT.apple);
      }
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
      apple = appleRefreshToken === null ? 'no-stored-token' : 'revoke-stored-token';
      appleRevocation = appleRefreshToken === null ? 'no-token-acknowledged' : 'revoked';
    }

    const confirmed = await confirm({
      status: 'found',
      caseId: input.caseId,
      userId: account.userId,
      accountRef: accountReference(account.userId),
      provider: account.provider,
      records: before,
      apple,
      database: deps.target.databaseName,
      environment: deps.target.environment,
    }).catch(() => false);
    if (!confirmed) throw new AdminDeletionError('Confirmation was cancelled or did not match. Nothing was deleted.', EXIT.refused);

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

    deps.cases.markCompleted(input.caseId, now());
    const deleted = deletedCounts(before);
    audit('deleted', { appleRevocation, deleted });
    return { result: 'deleted', caseId: input.caseId, userId: account.userId, provider: account.provider, appleRevocation, deleted };
  });
}

/**
 * Issue reports have no userId; they can only be matched by the email the
 * reporter typed. Allowed only for a verified (or completed, within its
 * retention) case whose verified account email is that same address, and
 * only after the operator types the exact live count back.
 */
/** Read-only: how many issue reports carry the case's verified email (the dry run for deleteIssueReports). */
export async function countIssueReportsForCase(
  deps: Pick<ApplyDeps, 'store' | 'cases'>,
  input: { caseId: string; email: string },
): Promise<number> {
  const entry = deps.cases.get(input.caseId);
  if (!entry || (entry.status !== 'verified' && entry.status !== 'completed')) {
    throw new AdminDeletionError(`Case ${input.caseId} is not verified.`, EXIT.refused);
  }
  if (!deps.cases.matchesEmail(entry, input.email)) {
    throw new AdminDeletionError('This email is not the verified address for this case.', EXIT.mismatch);
  }
  return deps.store.countIssueReportsByEmail(normalizeEmail(input.email));
}

export async function deleteIssueReports(
  deps: Pick<ApplyDeps, 'store' | 'cases' | 'audit' | 'target' | 'now'>,
  input: { caseId: string; email: string },
  confirm: (count: number) => Promise<boolean>,
): Promise<{ deleted: number }> {
  const now = deps.now ?? Date.now;
  const count = await countIssueReportsForCase(deps, input);
  if (count === 0) return { deleted: 0 };
  if (!(await confirm(count).catch(() => false))) {
    throw new AdminDeletionError('Confirmation was cancelled or did not match. Nothing was deleted.', EXIT.refused);
  }
  deps.audit.preflight();
  const deleted = await deps.store.deleteIssueReportsByEmail(normalizeEmail(input.email));
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
