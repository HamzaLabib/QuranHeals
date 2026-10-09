import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdminDeletionError, EXIT } from '../../src/admin/adminAccountDeletion';
import { DeletionAuditLog } from '../../src/admin/deletionAudit';
import { DeletionCaseStore } from '../../src/admin/deletionCases';
import { assertScriptMayUseTarget, PRODUCTION_WRITE_CONFIRMATION_ENV, DatabaseConfigError } from '../../src/config/databaseTarget';
import { shouldLoadDotenv } from '../../src/config/env';
import {
  PRODUCTION_EMAIL_DELETION_ENABLED,
  assertEnvironmentAllowed,
  assertProfile,
  describePlan,
  isStrictDevelopmentProfile,
  needsTerminal,
  parseAdminArgs,
  runAdminDeleteAccount,
  scriptAccess,
  toExit,
  validateBeforeConnecting,
  writesDatabase,
} from '../../src/scripts/adminDeleteAccount';
import { AppError } from '../../src/errors/AppError';
import { revokeAppleThenDelete } from '../../src/services/revokeAppleThenDelete';
import { StubAppleRevocationClient } from '../account/fakes';
import { ALICE_EMAIL, ALICE_ID, FakeTerminal, tempDir, typed } from './adminFakes';

const CASE = ['--case', 'DEL-20261008-01'];
const PRODUCTION = { environment: 'production' as const, databaseName: 'quranheals_prod' };
const DEVELOPMENT = { environment: 'development' as const, databaseName: 'quranheals_dev' };

function refusal(fn: () => unknown): AdminDeletionError {
  let error: unknown;
  try { fn(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(AdminDeletionError);
  return error as AdminDeletionError;
}

const refused = (fn: () => unknown, message?: RegExp) => {
  const error = refusal(fn);
  if (message) expect(error.message).toMatch(message);
};

describe('argument parsing: no sensitive value is ever an argument', () => {
  it('refuses --email, --code, --user-id and --confirm on every command, explaining the prompt instead', () => {
    for (const [flag, reason] of [['--email', /hidden prompt/], ['--code', /hidden prompt/], ['--user-id', /never typed/], ['--confirm', /interactive prompt/]] as const) {
      for (const command of ['lookup', 'challenge', 'verify', 'delete', 'issue-reports']) {
        refused(() => parseAdminArgs([command, flag, 'x']), reason);
      }
    }
  });

  it('rejects unknown commands, flags not valid for the command, missing values and repeats', () => {
    refused(() => parseAdminArgs(['erase']), /First argument/);
    refused(() => parseAdminArgs(['lookup', '--case', 'DEL-20261008-01']), /not valid for "lookup"/);
    refused(() => parseAdminArgs(['delete', '--case']), /needs a value/);
    refused(() => parseAdminArgs(['delete', ...CASE, ...CASE]), /given twice/);
    refused(() => parseAdminArgs(['delete', ...CASE, '--apply', '--apply']), /given twice/);
  });

  it('final deletion takes only the case: required case store and audit log, checked before any connection', () => {
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', '--case-store', 'c.json'])), /--case is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...CASE])), /--case-store is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...CASE, '--case-store', 'c.json', '--apply'])), /--audit-log is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...CASE, '--case-store', 'c.json', '--acknowledge-no-apple-token'])), /only apply with --apply/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', '--case', 'DEL-1', '--case-store', 'c.json'])), /DEL-YYYYMMDD-NN/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['prune', '--case-store', 'c.json'])), /--holds is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['audit-prune', '--audit-log', 'a.jsonl'])), /--holds is required/);
  });

  it('only delete/issue-reports with --apply write; prompts and destructive steps need a terminal', () => {
    expect(writesDatabase(parseAdminArgs(['delete', ...CASE]))).toBe(false);
    expect(writesDatabase(parseAdminArgs(['delete', ...CASE, '--apply']))).toBe(true);
    expect(needsTerminal(parseAdminArgs(['delete', ...CASE]))).toBe(false);
    for (const args of [['lookup'], ['verify', ...CASE], ['challenge', ...CASE], ['delete', ...CASE, '--apply'], ['prune', '--apply'], ['audit-prune', '--apply'], ['issue-reports', ...CASE]]) {
      expect(needsTerminal(parseAdminArgs(args)), args.join(' ')).toBe(true);
    }
  });
});

describe('TTY enforcement', () => {
  it('refuses a destructive or prompting command without an interactive terminal, before reading files or connecting', async () => {
    const dir = tempDir();
    const piped = new FakeTerminal([typed(`${ALICE_ID.slice(-6)} DELETE`)], { tty: false });
    for (const args of [
      ['delete', ...CASE, '--case-store', join(dir, 'c.json'), '--audit-log', join(dir, 'a.jsonl'), '--apply'],
      ['verify', ...CASE, '--case-store', join(dir, 'c.json')],
      ['lookup'],
    ]) {
      await expect(runAdminDeleteAccount(args, { io: piped.io })).rejects.toThrow(/interactive terminal/);
    }
    expect(existsSync(join(dir, 'c.json'))).toBe(false);
    expect(existsSync(join(dir, 'a.jsonl'))).toBe(false);
  });
});

describe('production stays disabled', () => {
  it('is off in code', () => {
    expect(PRODUCTION_EMAIL_DELETION_ENABLED).toBe(false);
  });

  it('refuses production even with the production-write confirmation and a correct profile', () => {
    for (const args of [['lookup'], ['delete', ...CASE], ['delete', ...CASE, '--apply']]) {
      const access = scriptAccess(parseAdminArgs(args));
      expect(access.productionSupported).toBe(false);
      expect(() => assertScriptMayUseTarget(PRODUCTION, access, { [PRODUCTION_WRITE_CONFIRMATION_ENV]: 'quranheals_prod' })).toThrow(DatabaseConfigError);
    }
    refused(() => assertEnvironmentAllowed(PRODUCTION), /not enabled/);
    refused(() => assertEnvironmentAllowed({ environment: 'test', databaseName: 'quranheals_test' }));
    expect(() => assertEnvironmentAllowed(DEVELOPMENT)).not.toThrow();
  });

  it('checks the environment before connecting, and again after', () => {
    const source = readFileSync(resolve(__dirname, '../../src/scripts/adminDeleteAccount.ts'), 'utf8');
    const before = source.indexOf('assertEnvironmentAllowed(preTarget, productionEnabled)');
    const profile = source.indexOf('assertProfile(parsed, preTarget, environment)');
    const connect = source.indexOf('await connectScriptDatabase(');
    const after = source.indexOf('assertEnvironmentAllowed(target, productionEnabled)');
    expect(before).toBeGreaterThan(0);
    expect(profile).toBeGreaterThan(before);
    expect(connect).toBeGreaterThan(profile);
    expect(after).toBeGreaterThan(connect);
  });
});

describe('once production is enabled (simulated): credentials and environment isolation', () => {
  const read = parseAdminArgs(['delete', ...CASE]);
  const write = parseAdminArgs(['delete', ...CASE, '--apply']);
  const profile = (name: string) => ({ QURAN_HEALS_SKIP_DOTENV: '1', QURAN_HEALS_ADMIN_PROFILE: name });

  it('read-only steps must use the read profile; writes must use the deletion profile', () => {
    expect(() => assertProfile(read, PRODUCTION, profile('production-read'))).not.toThrow();
    expect(() => assertProfile(write, PRODUCTION, profile('production-delete'))).not.toThrow();
    refused(() => assertProfile(read, PRODUCTION, profile('production-delete')), /production-read profile/);
    refused(() => assertProfile(write, PRODUCTION, profile('production-read')), /production-delete profile/);
    refused(() => assertProfile(write, PRODUCTION, { QURAN_HEALS_SKIP_DOTENV: '1' }), /got none/);
  });

  it('a production run must never read backend/.env', () => {
    refused(() => assertProfile(read, PRODUCTION, { QURAN_HEALS_ADMIN_PROFILE: 'production-read' }), /QURAN_HEALS_SKIP_DOTENV=1/);
    expect(shouldLoadDotenv({ QURAN_HEALS_SKIP_DOTENV: '1' })).toBe(false);
    expect(shouldLoadDotenv({})).toBe(true);
  });

  it('a production profile cannot be used against development', () => {
    refused(() => assertProfile(read, DEVELOPMENT, profile('production-read')), /production profile/);
    expect(() => assertProfile(read, DEVELOPMENT, {})).not.toThrow();
  });

  it('every run enforces the credential scope; only writes require the deletion-only user; writes still need the confirmation variable', () => {
    const readAccess = scriptAccess(read, true);
    const writeAccess = scriptAccess(write, true);
    expect(readAccess).toMatchObject({ productionSupported: true, writes: false, enforceCredentialScope: true });
    expect(readAccess.deletionOnlyCollections).toBeUndefined();
    expect(writeAccess).toMatchObject({ productionSupported: true, writes: true, enforceCredentialScope: true });
    expect(writeAccess.deletionOnlyCollections).toContain('users');
    expect(() => assertScriptMayUseTarget(PRODUCTION, readAccess, {})).not.toThrow();
    expect(() => assertScriptMayUseTarget(PRODUCTION, writeAccess, {})).toThrow(/QURAN_HEALS_CONFIRM_PRODUCTION_WRITE/);
    expect(() => assertScriptMayUseTarget(PRODUCTION, writeAccess, { [PRODUCTION_WRITE_CONFIRMATION_ENV]: 'quranheals_prod' })).not.toThrow();
    expect(() => assertEnvironmentAllowed(PRODUCTION, true)).not.toThrow();
  });
});

describe('local commands end to end (no database)', () => {
  it('verify reads the code at a hidden prompt; neither the terminal nor the JSON report contains it', async () => {
    const dir = tempDir();
    const cases = new DeletionCaseStore(join(dir, 'cases.json'));
    const code = cases.create({ caseId: 'DEL-20261008-01', userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL });
    const terminal = new FakeTerminal([typed(code)]);
    const report = await runAdminDeleteAccount(['verify', ...CASE, '--case-store', join(dir, 'cases.json')], { io: terminal.io });
    expect(report).toEqual({ command: 'verify', case: 'DEL-20261008-01', status: 'verified', accountRef: ALICE_ID.slice(-6), provider: 'google' });
    for (const text of [terminal.written, JSON.stringify(report), readFileSync(join(dir, 'cases.json'), 'utf8')]) {
      expect(text).not.toContain(code);
      expect(text).not.toContain(code.replace(/-/g, ''));
      expect(text.toLowerCase()).not.toContain(ALICE_EMAIL.toLowerCase());
    }
  });

  it('prune --apply removes only after the exact typed count, records the pruning in the audit log, and cancels otherwise', async () => {
    const dir = tempDir();
    const cases = new DeletionCaseStore(join(dir, 'cases.json'));
    cases.create({ caseId: 'DEL-20261008-01', userId: ALICE_ID, provider: 'google', email: ALICE_EMAIL }, Date.parse('2026-01-01T00:00:00Z'));
    const args = ['prune', '--case-store', join(dir, 'cases.json'), '--holds', join(dir, 'holds.json'), '--audit-log', join(dir, 'audit.jsonl'), '--apply'];
    const now = () => Date.parse('2026-06-01T00:00:00Z');

    await expect(runAdminDeleteAccount(args, { io: new FakeTerminal([typed('PRUNE 2')]).io, now })).rejects.toThrow(/did not match/);
    expect(cases.get('DEL-20261008-01')).not.toBeNull();

    const report = await runAdminDeleteAccount(args, { io: new FakeTerminal([typed('PRUNE 1')]).io, now });
    expect(report).toMatchObject({ command: 'prune', removed: 1 });
    expect(cases.get('DEL-20261008-01')).toBeNull();
    expect(new DeletionAuditLog(join(dir, 'audit.jsonl')).entries()).toEqual([expect.objectContaining({ action: 'prune-cases', result: 'cases-pruned', deleted: { DeletionCase: 1 } })]);
  });

  it('hold accepts only listed reasons and bounded review dates', async () => {
    const dir = tempDir();
    const holds = ['--holds', join(dir, 'holds.json')];
    const now = () => Date.parse('2026-10-08T00:00:00Z');
    await expect(runAdminDeleteAccount(['hold', ...holds, '--kind', 'deletion-case', '--ref', 'DEL-20261008-01', '--reason', 'just-in-case', '--review-by', '2027-01-01'], { now })).rejects.toThrow(/--reason must be one of/);
    await expect(runAdminDeleteAccount(['hold', ...holds, '--kind', 'deletion-case', '--ref', 'DEL-20261008-01', '--reason', 'dispute', '--review-by', '2028-01-01'], { now })).rejects.toThrow(/at most 365 days/);
    const report = await runAdminDeleteAccount(['hold', ...holds, '--kind', 'deletion-case', '--ref', 'DEL-20261008-01', '--reason', 'dispute', '--review-by', '2027-01-01'], { now });
    expect(report).toMatchObject({ hold: { kind: 'deletion-case', ref: 'DEL-20261008-01', reason: 'dispute', reviewBy: '2027-01-01T00:00:00.000Z' } });
  });
});

describe('operator-facing output', () => {
  it('the pre-confirmation summary shows database, account reference, provider, counts and Apple handling, never an email', () => {
    const text = describePlan({
      status: 'found', caseId: 'DEL-20261008-01', userId: ALICE_ID, accountRef: ALICE_ID.slice(-6), provider: 'apple', apple: 'revoke-stored-token',
      database: 'quranheals_dev', environment: 'development',
      records: { User: 1, Session: 2, UserFavorite: 3, UserPreference: 1, UserReflection: 4, UserSyncKey: 1, AppleCredential: 1, tombstones: { UserFavorite: 1, UserReflection: 1 } },
    });
    for (const expected of ['quranheals_dev (development)', ALICE_ID, `reference ${ALICE_ID.slice(-6)}`, 'apple', 'sessions 2', 'userreflections 4', 'applecredentials 1', 'FIRST']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('@');
  });

  it('known refusals map to "nothing done" exit codes; unknown errors are scrubbed', () => {
    expect(toExit(new AdminDeletionError('x', EXIT.apple))).toEqual({ message: 'x', exitCode: EXIT.apple });
    expect(toExit(new Error('connect failed mongodb+srv://user:pw@cluster.example.net/db')).message).not.toContain('pw@');
  });

  it('is not reachable over HTTP: no route or app module imports the admin tools', () => {
    const srcDir = resolve(__dirname, '../../src');
    const files = ['app.ts', 'server.ts', ...readdirSync(join(srcDir, 'routes')).map((f) => join('routes', f)), ...readdirSync(join(srcDir, 'controllers')).map((f) => join('controllers', f))];
    for (const file of files) {
      expect(readFileSync(join(srcDir, file), 'utf8'), file).not.toMatch(/admin\/|adminDeleteAccount|MongooseAdminAccountStore|issueReportRetention|retention\//);
    }
  });
});

describe('shared revokeAppleThenDelete helper (unchanged, used by in-app and admin deletion)', () => {
  it('revokes before deleting, deletes without revoking when there is no token, and never deletes after a failed revocation', async () => {
    const order: string[] = [];
    const apple = new StubAppleRevocationClient();
    const original = apple.revokeRefreshToken.bind(apple);
    apple.revokeRefreshToken = async (token) => { order.push(`revoke:${token}`); await original(token); };
    const accountDeletionService = { deleteAccount: async (id: string) => { order.push(`delete:${id}`); } };

    await revokeAppleThenDelete({ appleRevocationClient: apple, accountDeletionService }, 'u1', 't1');
    await revokeAppleThenDelete({ appleRevocationClient: apple, accountDeletionService }, 'u2', null);
    apple.failingTokens.add('t3');
    const error = await revokeAppleThenDelete({ appleRevocationClient: apple, accountDeletionService }, 'u3', 't3').catch((e: unknown) => e);

    expect(order).toEqual(['revoke:t1', 'delete:u1', 'delete:u2', 'revoke:t3']);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).statusCode).toBe(502);
  });
});

describe('development rehearsal profiles (development-read / development-delete)', () => {
  const read = parseAdminArgs(['delete', ...CASE]);
  const write = parseAdminArgs(['delete', ...CASE, '--apply']);
  const profile = (name: string) => ({ QURAN_HEALS_SKIP_DOTENV: '1', QURAN_HEALS_ADMIN_PROFILE: name });

  it('with no profile (or "development"), development keeps the normal development user and no strict checks', () => {
    expect(assertProfile(read, DEVELOPMENT, {})).toBeUndefined();
    expect(assertProfile(write, DEVELOPMENT, { QURAN_HEALS_ADMIN_PROFILE: 'development' })).toBe('development');
    expect(scriptAccess(write, false, undefined).strictCredentialScope).toBeUndefined();
    expect(scriptAccess(write, false, 'development').strictCredentialScope).toBeUndefined();
  });

  it('read steps need development-read, writes need development-delete', () => {
    expect(assertProfile(read, DEVELOPMENT, profile('development-read'))).toBe('development-read');
    expect(assertProfile(write, DEVELOPMENT, profile('development-delete'))).toBe('development-delete');
    refused(() => assertProfile(read, DEVELOPMENT, profile('development-delete')), /development-read profile/);
    refused(() => assertProfile(write, DEVELOPMENT, profile('development-read')), /development-delete profile/);
  });

  it('a rehearsal profile must come from an env file that never reads backend/.env', () => {
    refused(() => assertProfile(read, DEVELOPMENT, { QURAN_HEALS_ADMIN_PROFILE: 'development-read' }), /QURAN_HEALS_SKIP_DOTENV=1/);
  });

  it('rehearsal profiles turn on the strict read-only / deletion-only checks', () => {
    expect(isStrictDevelopmentProfile('development-read')).toBe(true);
    expect(isStrictDevelopmentProfile('development-delete')).toBe(true);
    expect(isStrictDevelopmentProfile('production-delete')).toBe(false);
    expect(scriptAccess(read, false, 'development-read')).toMatchObject({ writes: false, strictCredentialScope: true, enforceCredentialScope: true });
    expect(scriptAccess(read, false, 'development-read').deletionOnlyCollections).toBeUndefined();
    expect(scriptAccess(write, false, 'development-delete')).toMatchObject({ writes: true, strictCredentialScope: true, deletionOnlyCollections: expect.arrayContaining(['users', 'issuereports']) });
  });

  it('unknown profiles are refused in every environment', () => {
    for (const target of [DEVELOPMENT, PRODUCTION]) {
      for (const name of ['dev-delete', 'development_delete', 'Production-Delete', 'admin', '']) {
        refused(() => assertProfile(write, target, profile(name)), /not a known profile/);
      }
    }
  });

  it('development profiles can never be used against production, and production profiles never against development', () => {
    for (const name of ['development', 'development-read', 'development-delete']) {
      refused(() => assertProfile(write, PRODUCTION, profile(name)), /development profile, but the target is production/);
    }
    for (const name of ['production-read', 'production-delete']) {
      refused(() => assertProfile(read, DEVELOPMENT, profile(name)), /production profile/);
    }
  });

  it('production gates are unchanged: still disabled in code, and still strict when enabled', () => {
    expect(PRODUCTION_EMAIL_DELETION_ENABLED).toBe(false);
    refused(() => assertEnvironmentAllowed(PRODUCTION), /not enabled/);
    expect(() => assertProfile(write, PRODUCTION, profile('production-delete'))).not.toThrow();
    refused(() => assertProfile(write, PRODUCTION, { QURAN_HEALS_ADMIN_PROFILE: 'production-delete' }), /QURAN_HEALS_SKIP_DOTENV=1/);
    const access = scriptAccess(write, true, 'production-delete');
    expect(access).toMatchObject({ productionSupported: true, enforceCredentialScope: true, deletionOnlyCollections: expect.any(Array) });
    expect(() => assertScriptMayUseTarget(PRODUCTION, access, {})).toThrow(/QURAN_HEALS_CONFIRM_PRODUCTION_WRITE/);
  });
});

describe('production profiles use the same strict, fail-closed credential checks', () => {
  it('production-read and production-delete set strict mode; production stays disabled', () => {
    const read = parseAdminArgs(['delete', ...CASE]);
    const write = parseAdminArgs(['delete', ...CASE, '--apply']);
    expect(scriptAccess(read, true, 'production-read').strictCredentialScope).toBe(true);
    expect(scriptAccess(write, true, 'production-delete').strictCredentialScope).toBe(true);
    expect(scriptAccess(write, false, 'production-delete').productionSupported).toBe(false);
    expect(PRODUCTION_EMAIL_DELETION_ENABLED).toBe(false);
  });
});
