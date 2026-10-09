import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
  AdminDeletionError,
  EXIT,
  applyDeletion,
  confirmationFor,
  deleteIssueReports,
  loadExpectedAccount,
  lookupAccounts,
  planDeletion,
  restoreCheck,
  startChallenge,
  type ApplyDeps,
  type ApplyInput,
} from '../../src/admin/adminAccountDeletion';
import { DeletionAuditLog } from '../../src/admin/deletionAudit';
import { CODE_TTL_MS, DeletionCaseStore, MAX_ATTEMPTS, generateVerificationCode } from '../../src/admin/deletionCases';
import { InMemoryAppleCredentialRepository, StubAppleRevocationClient } from '../account/fakes';
import { ALICE_APPLE_ID, ALICE_EMAIL, ALICE_ID, BOB_ID, FakeDeletionService, InMemoryAdminStore, RELAY_EMAIL, tempDir } from './adminFakes';

const TARGET = { environment: 'development', databaseName: 'quranheals_dev' };
const REPO_ROOT = resolve(__dirname, '../../..');

let store: InMemoryAdminStore;
let deletion: FakeDeletionService;
let appleCredentials: InMemoryAppleCredentialRepository;
let apple: StubAppleRevocationClient;
let cases: DeletionCaseStore;
let audit: DeletionAuditLog;
let dir: string;
let order: string[];

function deps(): ApplyDeps {
  return { store, cases, audit, appleCredentialRepository: appleCredentials, appleRevocationClient: apple, accountDeletionService: deletion, target: TARGET };
}

const alice = { userId: ALICE_ID, provider: 'google' as const, email: ALICE_EMAIL };
const aliceApple = { userId: ALICE_APPLE_ID, provider: 'apple' as const, email: RELAY_EMAIL };

function input(identity: { userId: string; provider: 'apple' | 'google'; email: string }, caseId: string, extra: Partial<ApplyInput> = {}): ApplyInput {
  return { ...identity, caseId, confirm: confirmationFor(identity.userId), acknowledgeNoAppleToken: false, ...extra };
}

/** Challenge + verify, exactly as the operator would after the owner replies with the code. */
async function verifiedCase(identity: typeof alice | typeof aliceApple, caseId: string) {
  const code = await startChallenge(store, cases, caseId, identity);
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
  store.add({ userId: BOB_ID, provider: 'google', email: 'bob.synthetic@example.invalid', emailVerified: true });
  order = [];
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

describe('verification codes (case store)', () => {
  it('generates unambiguous 12-character codes, never the same twice', () => {
    const codes = new Set(Array.from({ length: 500 }, generateVerificationCode));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}-[A-HJKMNP-TV-Z2-9]{4}$/);
  });

  it('stores neither the code nor the email in readable form', async () => {
    const code = await startChallenge(store, cases, 'DEL-20261008-01', alice);
    const file = readFileSync(join(dir, 'cases.json'), 'utf8');
    expect(file).not.toContain(code);
    expect(file).not.toContain(code.replace(/-/g, ''));
    expect(file.toLowerCase()).not.toContain(ALICE_EMAIL.toLowerCase());
  });

  it('accepts the code once, ignoring case, spaces and hyphens, then refuses reuse', async () => {
    const code = await startChallenge(store, cases, 'DEL-20261008-01', alice);
    expect(cases.verify('DEL-20261008-01', ` ${code.replace(/-/g, ' ').toLowerCase()} `).status).toBe('verified');
    expect(() => cases.verify('DEL-20261008-01', code)).toThrow(/already used/);
  });

  it(`locks after ${MAX_ATTEMPTS} wrong codes, even if the right code comes next`, async () => {
    const code = await startChallenge(store, cases, 'DEL-20261008-01', alice);
    for (let i = 1; i < MAX_ATTEMPTS; i++) expect(() => cases.verify('DEL-20261008-01', 'AAAA-AAAA-AAAA')).toThrow(/attempts left/);
    expect(() => cases.verify('DEL-20261008-01', 'AAAA-AAAA-AAAA')).toThrow(/now locked/);
    expect(() => cases.verify('DEL-20261008-01', code)).toThrow(/locked/);
    expect(cases.get('DEL-20261008-01')!.status).toBe('locked');
  });

  it('expires after 14 days', async () => {
    const created = Date.parse('2026-10-08T00:00:00Z');
    const code = await startChallenge(store, cases, 'DEL-20261008-01', alice, created);
    expect(() => cases.verify('DEL-20261008-01', code, created + CODE_TTL_MS + 1)).toThrow(/expired/);
  });

  it('refuses a duplicate or malformed case ID', async () => {
    await startChallenge(store, cases, 'DEL-20261008-01', alice);
    await expect(startChallenge(store, cases, 'DEL-20261008-01', alice)).rejects.toThrow(/already exists/);
    await expect(startChallenge(store, cases, 'case-1', alice)).rejects.toThrow(/DEL-YYYYMMDD-NN/);
  });

  it('refuses to keep the case store or audit log inside the repository', () => {
    expect(() => new DeletionCaseStore(join(REPO_ROOT, 'backend', 'cases.json'))).toThrow(/outside the QuranHeals repository/);
    expect(() => new DeletionAuditLog(join(REPO_ROOT, 'audit.jsonl'))).toThrow(/outside the QuranHeals repository/);
  });
});

describe('account matching', () => {
  it('lookup is case/whitespace-insensitive and lists every provider account for one email', async () => {
    store.add({ userId: 'dddddddddddddddddddddddd', provider: 'apple', email: ALICE_EMAIL.toLowerCase(), emailVerified: true });
    const all = await lookupAccounts(store, `  ${ALICE_EMAIL.toUpperCase()} `);
    expect(all.map((a) => a.provider).sort()).toEqual(['apple', 'google']);
    expect(await lookupAccounts(store, ALICE_EMAIL, 'google')).toHaveLength(1);
    expect(await lookupAccounts(store, 'nobody@example.invalid')).toEqual([]);
  });

  it('lookup never returns the email itself', async () => {
    const [match] = await lookupAccounts(store, ALICE_EMAIL);
    expect(JSON.stringify(match).toLowerCase()).not.toContain('alice.synthetic');
    expect(match).toMatchObject({ userId: ALICE_ID, provider: 'google', emailVerified: true });
  });

  it('handles an Apple private-relay address like any other stored email', async () => {
    expect((await lookupAccounts(store, RELAY_EMAIL)).map((a) => a.userId)).toEqual([ALICE_APPLE_ID]);
    expect(await loadExpectedAccount(store, aliceApple)).toMatchObject({ userId: ALICE_APPLE_ID });
  });

  it('refuses a wrong provider, a wrong email, a malformed id, or an account without an email', async () => {
    await expectRefusal(loadExpectedAccount(store, { ...alice, provider: 'apple' }), EXIT.mismatch, /Provider/);
    await expectRefusal(loadExpectedAccount(store, { ...alice, email: 'bob.synthetic@example.invalid' }), EXIT.mismatch, /Email/);
    await expectRefusal(loadExpectedAccount(store, { ...alice, userId: 'not-an-id' }), EXIT.refused);
    store.add({ userId: 'eeeeeeeeeeeeeeeeeeeeeeee', provider: 'google' });
    await expectRefusal(loadExpectedAccount(store, { userId: 'eeeeeeeeeeeeeeeeeeeeeeee', provider: 'google', email: 'x@example.invalid' }), EXIT.mismatch);
  });

  it('will not start email verification for a Google account whose email Google never verified', async () => {
    store.add({ userId: 'ffffffffffffffffffffffff', provider: 'google', email: 'unverified@example.invalid', emailVerified: false });
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { userId: 'ffffffffffffffffffffffff', provider: 'google', email: 'unverified@example.invalid' }), EXIT.refused, /delete in the app/);
    expect(cases.get('DEL-20261008-01')).toBeNull();
  });

  it('will not start verification for a missing account', async () => {
    await expectRefusal(startChallenge(store, cases, 'DEL-20261008-01', { ...alice, userId: '0123456789abcdef01234567' }), EXIT.refused, /No account/);
  });
});

describe('dry run', () => {
  it('reports per-collection counts and the Apple action, and changes nothing', async () => {
    const plan = await planDeletion(store, aliceApple);
    expect(plan).toMatchObject({ status: 'found', apple: 'revoke-stored-token', records: { User: 1, Session: 2, UserReflection: 4, tombstones: { UserReflection: 1 } } });
    expect((await planDeletion(store, alice)).apple).toBe('not-applicable');
    store.records.get(ALICE_APPLE_ID)!.AppleCredential = 0;
    expect((await planDeletion(store, aliceApple)).apple).toBe('no-stored-token');
    expect(deletion.calls).toEqual([]);
    expect(order).toEqual([]);
    expect(audit.entries()).toEqual([]);
  });

  it('reports a missing account as not-found', async () => {
    expect((await planDeletion(store, { ...alice, userId: '0123456789abcdef01234567' })).status).toBe('not-found');
  });
});

describe('apply: refusals happen before anything changes', () => {
  it('requires the exact typed confirmation', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    for (const confirm of [undefined, 'yes', `delete-account:${BOB_ID}`, `delete-account:${ALICE_ID} `]) {
      await expectRefusal(applyDeletion(deps(), input(alice, 'DEL-20261008-01', { confirm })), EXIT.refused, /--confirm/);
    }
    expect(deletion.calls).toEqual([]);
  });

  it('never deletes on an unverified request: no case, or a case still pending', async () => {
    await expectRefusal(applyDeletion(deps(), input(alice, 'DEL-20261008-01')), EXIT.refused, /Verify ownership/);
    await startChallenge(store, cases, 'DEL-20261008-02', alice);
    await expectRefusal(applyDeletion(deps(), input(alice, 'DEL-20261008-02')), EXIT.refused, /pending/);
    expect(deletion.calls).toEqual([]);
    expect(audit.entries()).toEqual([]);
  });

  it('a case verified for one account cannot delete another (different id, or same id with a different email)', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input({ userId: BOB_ID, provider: 'google', email: 'bob.synthetic@example.invalid' }, 'DEL-20261008-01')), EXIT.refused, /different account/);
    await expectRefusal(applyDeletion(deps(), input({ ...alice, email: 'bob.synthetic@example.invalid' }, 'DEL-20261008-01')), EXIT.refused, /different account/);
    expect(deletion.calls).toEqual([]);
    expect(store.accounts.has(BOB_ID)).toBe(true);
  });

  it('an Apple account without a stored token needs explicit acknowledgement', async () => {
    await appleCredentials.delete(ALICE_APPLE_ID);
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01')), EXIT.refused, /acknowledge-no-apple-token/);
    expect(deletion.calls).toEqual([]);

    const report = await applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01', { acknowledgeNoAppleToken: true }));
    expect(report).toMatchObject({ result: 'deleted', appleRevocation: 'no-token-acknowledged' });
    expect(order).toEqual([`delete:${ALICE_APPLE_ID}`]);
  });
});

describe('apply: deletion', () => {
  it('deletes a verified Google account through the shared deletion service, completes the case, and audits counts only', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    const report = await applyDeletion(deps(), input(alice, 'DEL-20261008-01'));
    expect(report).toEqual({
      result: 'deleted', userId: ALICE_ID, provider: 'google', appleRevocation: 'not-applicable',
      deleted: { User: 1, Session: 2, UserFavorite: 3, UserPreference: 1, UserReflection: 4, UserSyncKey: 1, AppleCredential: 0 },
    });
    expect(deletion.calls).toEqual([ALICE_ID]);
    expect(store.accounts.has(ALICE_ID)).toBe(false);
    expect(store.accounts.has(BOB_ID)).toBe(true);
    expect(cases.get('DEL-20261008-01')!.status).toBe('completed');
    expect(audit.entries()).toEqual([expect.objectContaining({ case: 'DEL-20261008-01', action: 'delete-account', result: 'deleted', userId: ALICE_ID, environment: 'development' })]);
  });

  it('revokes Apple first, then deletes', async () => {
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    const report = await applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01'));
    expect(report.appleRevocation).toBe('revoked');
    expect(order).toEqual(['revoke', `delete:${ALICE_APPLE_ID}`]);
    expect(apple.revokedTokens).toEqual(['apple-refresh-SECRET-1']);
  });

  it('a token Apple already considers revoked still counts as revoked', async () => {
    apple.alreadyRevokedTokens.add('apple-refresh-SECRET-1');
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    expect((await applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01'))).result).toBe('deleted');
  });

  it('is idempotent: a repeated request finds nothing and deletes nothing', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    await applyDeletion(deps(), input(alice, 'DEL-20261008-01'));
    const again = await applyDeletion(deps(), input(alice, 'DEL-20261008-01'));
    expect(again.result).toBe('not-found');
    expect(deletion.calls).toEqual([ALICE_ID]);
    expect(audit.entries().map((e) => e.result)).toEqual(['deleted', 'not-found']);
  });

  it('an account already deleted in the app completes the case as not-found', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    store.accounts.delete(ALICE_ID);
    expect((await applyDeletion(deps(), input(alice, 'DEL-20261008-01'))).result).toBe('not-found');
    expect(cases.get('DEL-20261008-01')!.status).toBe('completed');
  });

  it('after a backup restore brings the account back, the completed case deletes it again', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    await applyDeletion(deps(), input(alice, 'DEL-20261008-01'));
    store.add({ userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL.toLowerCase(), emailVerified: true });
    expect(await restoreCheck(store, audit)).toEqual({ checked: 1, reappeared: [{ userId: ALICE_ID, case: 'DEL-20261008-01' }] });
    expect((await applyDeletion(deps(), input(alice, 'DEL-20261008-01'))).result).toBe('deleted-again');
    expect((await restoreCheck(store, audit)).reappeared).toEqual([]);
  });
});

describe('apply: partial failures are safe and retryable', () => {
  it('Apple revocation failure deletes nothing, is audited, and a retry succeeds', async () => {
    apple.failingTokens.add('apple-refresh-SECRET-1');
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01')), EXIT.apple, /Nothing was deleted/);
    expect(deletion.calls).toEqual([]);
    expect(store.accounts.has(ALICE_APPLE_ID)).toBe(true);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:apple-revocation']);

    apple.failingTokens.clear();
    expect((await applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01'))).result).toBe('deleted');
  });

  it('an unreadable stored Apple token aborts before Apple or the database', async () => {
    appleCredentials.get = async () => { throw new Error('Unsupported state or unable to authenticate data'); };
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01')), EXIT.apple, /could not be read/);
    expect(order).toEqual([]);
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:apple-credential']);
  });

  it('a database transaction failure leaves the account intact, is audited, and a retry succeeds', async () => {
    deletion.fail = true;
    await verifiedCase(alice, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(alice, 'DEL-20261008-01')), EXIT.delete, /rolled back/);
    expect(store.accounts.has(ALICE_ID)).toBe(true);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:delete']);

    deletion.fail = false;
    expect((await applyDeletion(deps(), input(alice, 'DEL-20261008-01'))).result).toBe('deleted');
  });

  it('Apple revoked but the database failed: the retry revokes again harmlessly and deletes', async () => {
    deletion.fail = true;
    await verifiedCase(aliceApple, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01')), EXIT.delete);
    expect(apple.revokedTokens).toEqual(['apple-refresh-SECRET-1']);
    apple.alreadyRevokedTokens.add('apple-refresh-SECRET-1');
    deletion.fail = false;
    expect((await applyDeletion(deps(), input(aliceApple, 'DEL-20261008-01'))).result).toBe('deleted');
  });

  it('records left behind after deletion fail verification', async () => {
    deletion.leaveBehind = true;
    await verifiedCase(alice, 'DEL-20261008-01');
    await expectRefusal(applyDeletion(deps(), input(alice, 'DEL-20261008-01')), EXIT.verify);
    expect(cases.get('DEL-20261008-01')!.status).toBe('verified');
    expect(audit.entries().map((e) => e.result)).toEqual(['failed:verify']);
  });
});

describe('issue reports', () => {
  beforeEach(() => {
    store.issueReports.push({ email: ALICE_EMAIL.toLowerCase() }, { email: ALICE_EMAIL.toLowerCase() }, { email: 'bob.synthetic@example.invalid' }, {});
  });

  it('deletes only reports with the verified case email, after the exact count is typed', async () => {
    await verifiedCase(alice, 'DEL-20261008-01');
    const issueDeps = { store, cases, audit, target: TARGET };
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL, confirm: 'delete-issue-reports:3' }), EXIT.refused);
    expect(await deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL, confirm: 'delete-issue-reports:2' })).toEqual({ deleted: 2 });
    expect(store.issueReports).toHaveLength(2);
    expect(audit.entries()).toEqual([expect.objectContaining({ action: 'delete-issue-reports', deleted: { IssueReport: 2 } })]);
  });

  it('refuses an unverified case or an email that is not the verified one', async () => {
    const issueDeps = { store, cases, audit, target: TARGET };
    await startChallenge(store, cases, 'DEL-20261008-01', alice);
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-01', email: ALICE_EMAIL, confirm: 'delete-issue-reports:2' }), EXIT.refused, /not verified/);
    await verifiedCase(alice, 'DEL-20261008-02');
    await expectRefusal(deleteIssueReports(issueDeps, { caseId: 'DEL-20261008-02', email: 'bob.synthetic@example.invalid', confirm: 'delete-issue-reports:1' }), EXIT.mismatch);
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
    const codeA = await verifiedCase(alice, 'DEL-20261008-01');
    const codeB = await verifiedCase(aliceApple, 'DEL-20261008-02');
    outputs.push(JSON.stringify(await planDeletion(store, aliceApple)));
    deletion.fail = true;
    await capture(applyDeletion(deps(), input(alice, 'DEL-20261008-01')));
    deletion.fail = false;
    apple.failingTokens.add('apple-refresh-SECRET-1');
    await capture(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-02')));
    apple.failingTokens.clear();
    await capture(applyDeletion(deps(), input(alice, 'DEL-20261008-01')));
    await capture(applyDeletion(deps(), input(aliceApple, 'DEL-20261008-02')));

    const everything = [...outputs, readFileSync(join(dir, 'audit.jsonl'), 'utf8'), readFileSync(join(dir, 'cases.json'), 'utf8')].join('\n').toLowerCase();
    for (const secret of [ALICE_EMAIL, RELAY_EMAIL, codeA, codeB, codeA.replace(/-/g, ''), 'apple-refresh-secret', 'mongodb', 'pw@']) {
      expect(everything, secret).not.toContain(secret.toLowerCase());
    }
  });

  it('the audit log only ever writes whitelisted fields', () => {
    audit.append({ case: 'DEL-20261008-01', at: 'now', environment: 'development', database: 'quranheals_dev', action: 'delete-account', result: 'deleted', ...({ email: ALICE_EMAIL, token: 'x' } as object) } as never);
    const [line] = readFileSync(join(dir, 'audit.jsonl'), 'utf8').trim().split('\n');
    expect(Object.keys(JSON.parse(line)).sort()).toEqual(['action', 'at', 'case', 'database', 'environment', 'result']);
  });
});
