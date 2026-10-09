import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AdminDeletionError } from '../../src/admin/adminAccountDeletion';
import { assertScriptMayUseTarget, PRODUCTION_WRITE_CONFIRMATION_ENV, DatabaseConfigError } from '../../src/config/databaseTarget';
import { assertDevelopmentOnly, parseAdminArgs, scriptAccess, validateBeforeConnecting, writesDatabase } from '../../src/scripts/adminDeleteAccount';
import { AppError } from '../../src/errors/AppError';
import { revokeAppleThenDelete } from '../../src/services/revokeAppleThenDelete';
import { StubAppleRevocationClient } from '../account/fakes';

const ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const base = ['--case', 'DEL-20261008-01', '--user-id', ID, '--provider', 'google', '--email', 'a@example.invalid'];

const refused = (fn: () => unknown, message?: RegExp) => {
  let error: unknown;
  try { fn(); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(AdminDeletionError);
  if (message) expect((error as Error).message).toMatch(message);
};

describe('argument parsing', () => {
  it('rejects unknown commands, flags not valid for the command, missing values and repeats', () => {
    refused(() => parseAdminArgs([]), /First argument/);
    refused(() => parseAdminArgs(['wipe']), /First argument/);
    refused(() => parseAdminArgs(['lookup', '--apply']), /not valid for "lookup"/);
    refused(() => parseAdminArgs(['lookup', '--user-id', ID]), /not valid/);
    refused(() => parseAdminArgs(['lookup', '--email']), /needs a value/);
    refused(() => parseAdminArgs(['lookup', '--email', '--provider']), /needs a value/);
    refused(() => parseAdminArgs(['lookup', '--email', 'a', '--email', 'b']), /twice/);
  });

  it('delete is a dry run unless --apply is given', () => {
    expect(writesDatabase(parseAdminArgs(['delete', ...base]))).toBe(false);
    expect(writesDatabase(parseAdminArgs(['delete', ...base, '--apply']))).toBe(true);
    expect(writesDatabase(parseAdminArgs(['lookup', '--email', 'a@example.invalid']))).toBe(false);
  });

  it('apply needs a typed confirmation, a case store and an audit log before any connection', () => {
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...base, '--apply'])), /--confirm is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...base, '--apply', '--confirm', `delete-account:${ID}`])), /--case-store is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...base, '--apply', '--confirm', `delete-account:${ID}`, '--case-store', 'c.json'])), /--audit-log is required/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', ...base, '--confirm', `delete-account:${ID}`])), /only apply with --apply/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['delete', '--case', 'DEL-1', '--user-id', ID])), /DEL-YYYYMMDD-NN/);
    refused(() => validateBeforeConnecting(parseAdminArgs(['issue-reports', '--email', 'a@example.invalid', '--apply'])), /--case is required/);
  });
});

describe('production is hard-blocked in this phase', () => {
  const production = { environment: 'production' as const, databaseName: 'quranheals_prod' };

  it('declares no production support, so the shared script guard refuses production reads and writes', () => {
    for (const args of [['lookup', '--email', 'a@example.invalid'], ['delete', ...base], ['delete', ...base, '--apply']]) {
      const access = scriptAccess(parseAdminArgs(args));
      expect(access.productionSupported).toBe(false);
      expect(() => assertScriptMayUseTarget(production, access, { [PRODUCTION_WRITE_CONFIRMATION_ENV]: 'quranheals_prod' })).toThrow(DatabaseConfigError);
    }
  });

  it('refuses every environment except development, even with the production-write confirmation set', () => {
    refused(() => assertDevelopmentOnly(production), /only against the development database/);
    refused(() => assertDevelopmentOnly({ environment: 'test', databaseName: 'quranheals_test' }));
    expect(() => assertDevelopmentOnly({ environment: 'development', databaseName: 'quranheals_dev' })).not.toThrow();
  });

  it('checks the target before connecting, and again after', () => {
    const source = readFileSync(resolve(__dirname, '../../src/scripts/adminDeleteAccount.ts'), 'utf8');
    const before = source.indexOf('assertDevelopmentOnly(getDatabaseTarget())');
    const connect = source.indexOf('await connectScriptDatabase(');
    const after = source.indexOf('assertDevelopmentOnly(target)');
    expect(before).toBeGreaterThan(0);
    expect(connect).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(connect);
  });

  it('is not reachable over HTTP: no route or app module imports the admin tool', () => {
    const srcDir = resolve(__dirname, '../../src');
    const files = ['app.ts', 'server.ts', ...readdirSync(join(srcDir, 'routes')).map((f) => join('routes', f)), ...readdirSync(join(srcDir, 'controllers')).map((f) => join('controllers', f))];
    for (const file of files) {
      expect(readFileSync(join(srcDir, file), 'utf8'), file).not.toMatch(/admin\/|adminDeleteAccount|MongooseAdminAccountStore/);
    }
  });
});

describe('shared revokeAppleThenDelete helper', () => {
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
