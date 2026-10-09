import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  AdminDeletionError,
  DELETION_COLLECTIONS,
  EXIT,
  applyDeletion,
  countIssueReportsForCase,
  deleteIssueReports,
  emailVerificationEligibility,
  finalConfirmationPhrase,
  lookupAccounts,
  planDeletion,
  startChallenge,
  type ApplyDeps,
  type ConfirmationPlan,
} from '../../src/admin/adminAccountDeletion';
import { DeletionAuditLog } from '../../src/admin/deletionAudit';
import { DeletionCaseStore } from '../../src/admin/deletionCases';
import { AppleCredentialModel } from '../../src/models/AppleCredential';
import { IssueReportModel } from '../../src/models/IssueReport';
import { SessionModel } from '../../src/models/Session';
import { UserModel } from '../../src/models/User';
import { UserFavoriteModel } from '../../src/models/UserFavorite';
import { UserPreferenceModel } from '../../src/models/UserPreference';
import { UserReflectionModel } from '../../src/models/UserReflection';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';
import { InMemoryAppleCredentialRepository, StubAppleRevocationClient } from '../account/fakes';
import { ALICE_APPLE_ID, ALICE_EMAIL, ALICE_ID, BOB_ID, FakeDeletionService, InMemoryAdminStore, RELAY_EMAIL, tempDir } from './adminFakes';

const TARGET = { environment: 'development', databaseName: 'quranheals_dev' };
const REPO_ROOT = resolve(__dirname, '../../..');
const ALICE = { userId: ALICE_ID, provider: 'google' as const };
const ALICE_APPLE = { userId: ALICE_APPLE_ID, provider: 'apple' as const };
const BOB_EMAIL = 'bob.synthetic@example.invalid';

let store: InMemoryAdminStore;
let deletion: FakeDeletionService;
let appleCredentials: InMemoryAppleCredentialRepository;
let apple: StubAppleRevocationClient;
let cases: DeletionCaseStore;
let audit: DeletionAuditLog;
let dir: string;
let order: string[];
let appleConfigured: boolean;
let shownPlans: ConfirmationPlan[];

function deps(): ApplyDeps {
  return {
    store, cases, audit, appleCredentialRepository: appleCredentials, appleRevocationClient: apple, accountDeletionService: deletion, target: TARGET,
    assertAppleRevocationConfigured: () => { if (!appleConfigured) throw new Error('Apple account-deletion revocation is not configured'); },
  };
}

/** The operator types the exact phrase for the account shown. */
const operatorConfirms = async (plan: ConfirmationPlan) => { shownPlans.push(plan); return true; };
const operatorTypes = (answer: string) => async (plan: ConfirmationPlan) => { shownPlans.push(plan); return answer === finalConfirmationPhrase(plan.userId); };
const confirmNotCalled = async () => { throw new Error('confirmation must not be reached'); };

/** Challenge + verify, exactly as the operator would after the owner replies with the code. */
async function verifiedCase(selected: typeof ALICE | typeof ALICE_APPLE, email: string, caseId: string) {
  const code = await startChallenge(store, cases, caseId, selected, email);
  cases.verify(caseId, code);
  return code;
}

async function expectRefusal(promise: Promise<unknown>, exitCode: number, message?: RegExp) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AdminDeletionError);
  expect((error as AdminDeletionError).exitCode).toBe(exitCode);
  if (message) expect((error as Error).message).toMatch(message);
}

beforeEach(() => {
  store = new InMemoryAdminStore();
  store.add({ userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL.toLowerCase(), emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z' });
  store.add({ userId: ALICE_APPLE_ID, provider: 'apple', email: RELAY_EMAIL, emailVerified: true }, { AppleCredential: 1 });
  store.add({ userId: BOB_ID, provider: 'google', email: BOB_EMAIL, emailVerified: true });
  order = [];
  shownPlans = [];
  appleConfigured = true;
  deletion = new FakeDeletionService(store);
  const originalDelete = deletion.deleteAccount.bind(deletion);
  deletion.deleteAccount = async (userId) => { order.push(`delete:${userId}`); await originalDelete(userId); };
  appleCredentials = new InMemoryAppleCredentialRepository();
  void appleCredentials.save(ALICE_APPLE_ID, 'apple-refresh-SECRET-1');
  apple = new StubAppleRevocationClient();
  const originalRevoke = apple.revokeRefreshToken.bind(apple);
  apple.revokeRefreshToken = async (token) => { order.push('revoke'); await originalRevoke(token); };
  dir = tempDir();
  cases = new DeletionCaseStore(join(dir, 'cases.json'));
  audit = new DeletionAuditLog(join(dir, 'audit.jsonl'));
});

describe('admin files', () => {
  it('refuses to keep the case store or audit log inside the repository', () => {
    expect(() => new DeletionCaseStore(join(REPO_ROOT, 'backend', 'cases.json'))).toThrow(/outside the QuranHeals repository/);
    expect(() => new DeletionAuditLog(join(REPO_ROOT, 'audit.jsonl'))).toThrow(/outside the QuranHeals repository/);
  });

  it('the deletion-only collection list matches the real model collections exactly', () => {
    const models = [UserModel, SessionModel, UserFavoriteModel, UserPreferenceModel, UserReflectionModel, UserSyncKeyModel, AppleCredentialModel, IssueReportModel];
    expect([...DELETION_COLLECTIONS].sort()).toEqual(models.map((m) => m.collection.collectionName).sort());
  });
});

describe('lookup and eligibility', () => {
  it('is case/whitespace-insensitive and lists every provider account for one email', async () => {
    store.add({ userId: 'dddddddddddddddddddddddd', provider: 'apple', email: ALICE_EMAIL.toLowerCase(), emailVerified: true });
    const all = await lookupAccounts(store, `  ${ALICE_EMAIL.toUpperCase()} `);
    expect(all.map((a) => a.provider).sort()).toEqual(['apple', 'google']);
    expect(await lookupAccounts(store, ALICE_EMAIL, 'google')).toHaveLength(1);
    expect(await lookupAccounts(store, 'nobody@example.invalid')).toEqual([]);
  });

  it('never returns the email itself', async () => {
    const [match] = await lookupAccounts(store, ALICE_EMAIL);
    expect(JSON.stringify(match).toLowerCase()).not.toContain('alice.synthetic');
    expect(match).toMatchObject({ userId: ALICE_ID, accountRef: ALICE_ID.slice(-6), provider: 'google', emailVerification: 'eligible' });
  });

  it('accepts Apple private-relay addresses; refuses no email, an unverified Google email, or an Apple email Apple marked unverified', () => {
    expect(emailVerificationEligibility({ userId: ALICE_APPLE_ID, provider: 'apple', email: RELAY_EMAIL })).toBe('eligible');
    expect(emailVerificationEligibility({ userId: ALICE_APPLE_ID, provider: 'apple', email: RELAY_EMAIL, emailVerified: true })).toBe('eligible');
    expect(emailVerificationEligibility({ userId: ALICE_APPLE_ID, provider: 'apple' })).toBe('no-email');
    expect(emailVerificationEligibility({ userId: ALICE_APPLE_ID, provider: 'apple', email: RELAY_EMAIL, emailVerified: false })).toBe('apple-email-unverified');
    expect(emailVerificationEligibility({ userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL })).toBe('google-email-unverified');
    expect(emailVerificationEligibility({ userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL, emailVerified: false })).toBe('google-email-unverified');
  });
});

describe('challenge: the code is bound to the exact account and its stored email', () => {
  it('refuses when the entered email is not the address stored on the chosen account', async () => {
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', ALICE, BOB_EMAIL), EXIT.mismatch, /not the address stored/);
    expect(cases.get('DEL-20261008-01')).toBeNull();
  });

  it('refuses a wrong provider, a missing or malformed account id', async () => {
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { ...ALICE, provider: 'apple' }, ALICE_EMAIL), EXIT.mismatch, /Provider/);
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { ...ALICE, userId: '0123456789abcdef01234567' }, ALICE_EMAIL), EXIT.refused, /No account/);
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { ...ALICE, userId: 'not-an-id' }, ALICE_EMAIL), EXIT.refused, /24-character/);
  });

  it('refuses email verification for an unverified Google email or an account without an email, directing to in-app deletion', async () => {
    store.add({ userId: 'ffffffffffffffffffffffff', provider: 'google', email: 'unverified@example.invalid', emailVerified: false });
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { userId: 'ffffffffffffffffffffffff', provider: 'google' }, 'unverified@example.invalid'), EXIT.refused, /delete in the app/);
    store.add({ userId: 'eeeeeeeeeeeeeeeeeeeeeeee', provider: 'apple' });
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-02', { userId: 'eeeeeeeeeeeeeeeeeeeeeeee', provider: 'apple' }, 'x@example.invalid'), EXIT.mismatch);
    expect(cases.get('DEL-20261008-01')).toBeNull();
  });

  it('works for an Apple private-relay account', async () => {
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    expect(cases.get('DEL-20261008-01')).toMatchObject({ status: 'verified', userId: ALICE_APPLE_ID, provider: 'apple' });
  });
});

describe('dry run', () => {
  it('takes the account from the verified case and reports counts and the Apple action, changing nothing', async () => {
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    const plan = await planDeletion(store, cases, 'DEL-20261008-01');
    expect(plan).toMatchObject({ status: 'found', userId: ALICE_APPLE_ID, accountRef: 'bbbbbb', apple: 'revoke-stored-token', records: { User: 1, Session: 2, UserReflection: 4 } });
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-02');
    expect((await planDeletion(store, cases, 'DEL-20261008-02')).apple).toBe('not-applicable');
    expect(deletion.calls).toEqual([]);
    expect(order).toEqual([]);
    expect(audit.entries()).toEqual([]);
  });

  it('refuses an unverified case', async () => {
    await startChallenge(store, cases, 'DEL-20261008-01', ALICE, ALICE_EMAIL);
    await expectRefusal(planDeletion(store, cases, 'DEL-20261008-01'), EXIT.refused, /pending/);
  });
});

describe('apply: refusals and cancellation happen before anything changes', () => {
  it('never deletes on an unverified request: no case, or a case still pending', async () => {
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.refused, /Verify ownership/);
    await startChallenge(store, cases, 'DEL-20261008-02', ALICE, ALICE_EMAIL);
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-02', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.refused, /pending/);
    expect(deletion.calls).toEqual([]);
    expect(audit.entries()).toEqual([]);
  });

  it('a wrong account suffix, a missing phrase, or a cancelled prompt deletes nothing', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    for (const answer of ['', 'DELETE', 'cccccc DELETE', 'aaaaaa delete', 'yes']) {
      await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorTypes(answer)), EXIT.refused, /Nothing was deleted/);
    }
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, async () => { throw new Error('Cancelled'); }), EXIT.refused);
    expect(deletion.calls).toEqual([]);
    expect(order).toEqual([]);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries()).toEqual([]);
  });

  it('shows the database, account reference, provider, counts and Apple handling before confirming', async () => {
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorTypes('bbbbbb DELETE'));
    expect(shownPlans).toEqual([expect.objectContaining({ database: 'quranheals_dev', environment: 'development', userId: ALICE_APPLE_ID, accountRef: 'bbbbbb', provider: 'apple', apple: 'revoke-stored-token', records: expect.objectContaining({ User: 1 }) })]);
    expect(finalConfirmationPhrase(ALICE_APPLE_ID)).toBe('bbbbbb DELETE');
  });

  it('a case verified for one account can only ever delete that account', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms);
    expect(deletion.calls).toEqual([ALICE_ID]);
    expect(store.accounts.has(BOB_ID)).toBe(true);
    expect(store.accounts.has(ALICE_APPLE_ID)).toBe(true);
  });

  it('refuses if the account\'s stored email or provider changed since verification', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    store.accounts.get(ALICE_ID)!.email = 'changed@example.invalid';
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.mismatch, /changed since verification/);
    store.accounts.get(ALICE_ID)!.email = ALICE_EMAIL.toLowerCase();
    store.accounts.get(ALICE_ID)!.provider = 'apple';
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.mismatch, /provider/);
    expect(deletion.calls).toEqual([]);
  });

  it('missing Apple configuration is caught before the confirmation', async () => {
    appleConfigured = false;
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.apple, /not configured/);
    expect(order).toEqual([]);
  });

  it('an unreadable stored Apple token is caught before the confirmation, Apple or the database', async () => {
    appleCredentials.get = async () => { throw new Error('Unsupported state or unable to authenticate data'); };
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.apple, /could not be read/);
    expect(order).toEqual([]);
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:apple-credential']);
  });

  it('an Apple account without a stored token needs explicit acknowledgement', async () => {
    await appleCredentials.delete(ALICE_APPLE_ID);
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.refused, /acknowledge-no-apple-token/);
    expect(deletion.calls).toEqual([]);

    const report = await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: true }, operatorConfirms);
    expect(report).toMatchObject({ result: 'deleted', appleRevocation: 'no-token-acknowledged' });
    expect(shownPlans[0].apple).toBe('no-stored-token');
    expect(order).toEqual([`delete:${ALICE_APPLE_ID}`]);
  });

  it('refuses before anything if the audit log is locked by another run', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'audit.jsonl.lock'), 'other run');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.refused, /audit log is not writable/);
    expect(deletion.calls).toEqual([]);
  });
});

describe('apply: deletion', () => {
  it('deletes a verified Google account through the shared deletion service, completes the case, and audits counts only', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    const report = await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms);
    expect(report).toEqual({
      result: 'deleted', caseId: 'DEL-20261008-01', userId: ALICE_ID, provider: 'google', appleRevocation: 'not-applicable',
      deleted: { User: 1, Session: 2, UserFavorite: 3, UserPreference: 1, UserReflection: 4, UserSyncKey: 1, AppleCredential: 0 },
    });
    expect(store.accounts.has(ALICE_ID)).toBe(false);
    expect(cases.get('DEL-20261008-01')!.status).toBe('completed');
    expect(audit.entries()).toEqual([expect.objectContaining({ case: 'DEL-20261008-01', action: 'delete-account', result: 'deleted', userId: ALICE_ID, environment: 'development' })]);
  });

  it('revokes Apple first, then deletes', async () => {
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    const report = await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms);
    expect(report.appleRevocation).toBe('revoked');
    expect(order).toEqual(['revoke', `delete:${ALICE_APPLE_ID}`]);
    expect(apple.revokedTokens).toEqual(['apple-refresh-SECRET-1']);
  });

  it('a completed case can never authorize another run (replay refused)', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms);
    store.add({ userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL.toLowerCase(), emailVerified: true });
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled), EXIT.refused, /already completed/);
    expect(deletion.calls).toEqual([ALICE_ID]);
  });

  it('an account already deleted in the app completes the case as not-found, without Apple or confirmation', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    store.accounts.delete(ALICE_ID);
    expect((await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, confirmNotCalled)).result).toBe('not-found');
    expect(cases.get('DEL-20261008-01')!.status).toBe('completed');
  });
});

describe('apply: partial failures are safe and retryable', () => {
  it('Apple revocation failure deletes nothing, is audited, and a retry succeeds', async () => {
    apple.failingTokens.add('apple-refresh-SECRET-1');
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms), EXIT.apple, /Nothing was deleted/);
    expect(deletion.calls).toEqual([]);
    expect(store.accounts.has(ALICE_APPLE_ID)).toBe(true);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:apple-revocation']);

    apple.failingTokens.clear();
    expect((await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms)).result).toBe('deleted');
  });

  it('a database transaction failure leaves the account intact, is audited, and a retry succeeds', async () => {
    deletion.fail = true;
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms), EXIT.delete, /rolled back/);
    expect(store.accounts.has(ALICE_ID)).toBe(true);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    deletion.fail = false;
    expect((await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms)).result).toBe('deleted');
  });

  it('Apple revoked but the database failed: the retry revokes again harmlessly and deletes', async () => {
    deletion.fail = true;
    await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms), EXIT.delete);
    apple.alreadyRevokedTokens.add('apple-refresh-SECRET-1');
    deletion.fail = false;
    expect((await applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms)).result).toBe('deleted');
  });

  it('records left behind after deletion fail verification', async () => {
    deletion.leaveBehind = true;
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms), EXIT.verify);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:verify']);
  });

  it('two runs with the same case cannot overlap: the second is refused by the case-store lock', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const first = applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, async () => { await gate; return true; });
    await new Promise((r) => setImmediate(r));
    // A second process has its own store instance on the same file.
    const otherProcessCases = new DeletionCaseStore(join(dir, 'cases.json'));
    const second = applyDeletion({ ...deps(), cases: otherProcessCases }, { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms);
    await expect(second).rejects.toThrow(/another run/);
    release();
    expect((await first).result).toBe('deleted');
    expect(deletion.calls).toEqual([ALICE_ID]);
  });
});

describe('issue reports', () => {
  beforeEach(() => {
    store.issueReports.push({ email: ALICE_EMAIL.toLowerCase() }, { email: ALICE_EMAIL.toLowerCase() }, { email: BOB_EMAIL }, {});
  });

  it('counts, then deletes only reports with the verified case email after the exact count is confirmed', async () => {
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    const issueDeps = { store, cases, audit, target: TARGET };
    expect(await countIssueReportsForCase(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL })).toBe(2);
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL }, async () => false), EXIT.refused);
    expect(store.issueReports).toHaveLength(4);
    expect(await deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL }, async (n) => n === 2)).toEqual({ deleted: 2 });
    expect(store.issueReports).toHaveLength(2);
    expect(audit.entries()).toEqual([expect.objectContaining({ action: 'delete-issue-reports', deleted: { IssueReport: 2 } })]);
  });

  it('refuses an unverified case or an email that is not the verified one', async () => {
    const issueDeps = { store, cases, audit, target: TARGET };
    await startChallenge(store, cases, 'DEL-20261008-01', ALICE, ALICE_EMAIL);
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL }, async () => true), EXIT.refused, /not verified/);
    await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-02');
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-02', email: BOB_EMAIL }, async () => true), EXIT.mismatch);
    expect(store.issueReports).toHaveLength(4);
  });
});

describe('no sensitive information leaks', () => {
  it('reports, errors, the audit log and the case store never contain emails, codes, tokens or database URIs', async () => {
    const outputs: string[] = [];
    const capture = async (promise: Promise<unknown>) => {
      try { outputs.push(JSON.stringify(await promise)); } catch (error) { outputs.push((error as Error).message); }
    };
    outputs.push(JSON.stringify(await lookupAccounts(store, ALICE_EMAIL)));
    const codeA = await verifiedCase(ALICE, ALICE_EMAIL, 'DEL-20261008-01');
    const codeB = await verifiedCase(ALICE_APPLE, RELAY_EMAIL, 'DEL-20261008-02');
    outputs.push(JSON.stringify(await planDeletion(store, cases, 'DEL-20261008-02')));
    deletion.fail = true;
    await capture(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms));
    deletion.fail = false;
    apple.failingTokens.add('apple-refresh-SECRET-1');
    await capture(applyDeletion(deps(), { caseId: 'DEL-20261008-02', acknowledgeNoAppleToken: false }, operatorConfirms));
    apple.failingTokens.clear();
    await capture(applyDeletion(deps(), { caseId: 'DEL-20261008-01', acknowledgeNoAppleToken: false }, operatorConfirms));
    await capture(applyDeletion(deps(), { caseId: 'DEL-20261008-02', acknowledgeNoAppleToken: false }, operatorConfirms));
    outputs.push(JSON.stringify(shownPlans));

    const everything = [...outputs, readFileSync(join(dir, 'audit.jsonl'), 'utf8'), readFileSync(join(dir, 'cases.json'), 'utf8')].join('\n').toLowerCase();
    for (const secret of [ALICE_EMAIL, RELAY_EMAIL, codeA, codeB, codeA.replace(/-/g, ''), 'apple-refresh-secret', 'mongodb', 'pw@']) {
      expect(everything, secret).not.toContain(secret.toLowerCase());
    }
  });

  it('the audit log only ever writes allowlisted fields', () => {
    audit.append({ case: 'DEL-20261008-01', at: 'now', environment: 'development', database: 'quranheals_dev', action: 'delete-account', result: 'deleted', ...({ email: ALICE_EMAIL, token: 'x', code: 'y', ip: '1.2.3.4' } as object) } as never);
    const [line] = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n');
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(['action', 'at', 'case', 'database', 'environment', 'result']);
  });
});
