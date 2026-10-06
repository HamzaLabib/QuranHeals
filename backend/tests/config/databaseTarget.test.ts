import { describe, expect, it } from 'vitest';

import {
  assertScriptMayUseTarget,
  databaseNameFromUri,
  DatabaseConfigError,
  describeTarget,
  resolveDatabaseTarget,
} from '../../src/config/databaseTarget';

// Obviously fake connection strings — never a real host or credential.
const SRV = 'mongodb+srv://user:secret-password@cluster.example.invalid/?retryWrites=true&w=majority';
const target = (nodeEnv: 'development' | 'test' | 'production', dbName?: string, uri = SRV) => resolveDatabaseTarget({ nodeEnv, uri, dbName });

describe('database target: the seven environment cases', () => {
  it('1. production + quranheals_prod → accepted', () => {
    expect(target('production', 'quranheals_prod')).toEqual({ environment: 'production', databaseName: 'quranheals_prod' });
  });

  it('2. production + missing database name → rejected', () => {
    expect(() => target('production')).toThrow(/MONGODB_DB_NAME is required \(NODE_ENV=production\); expected "quranheals_prod"/);
    expect(() => target('production', '  ')).toThrow(DatabaseConfigError);
  });

  it('3. production + test → rejected (MongoDB default)', () => {
    expect(() => target('production', 'test')).toThrow(/default\/reserved database/);
  });

  it('4. production + development database → rejected', () => {
    expect(() => target('production', 'quranheals_dev')).toThrow(/NODE_ENV=production may not use database "quranheals_dev"/);
  });

  it('5. development + quranheals_dev → accepted (and suffixed personal copies)', () => {
    expect(target('development', 'quranheals_dev')).toEqual({ environment: 'development', databaseName: 'quranheals_dev' });
    expect(target('development', 'quranheals_dev_alex').databaseName).toBe('quranheals_dev_alex');
  });

  it('6. development + production database → rejected', () => {
    expect(() => target('development', 'quranheals_prod')).toThrow(/NODE_ENV=development may not use database "quranheals_prod"/);
  });

  it('7. test environment is isolated to quranheals_test databases', () => {
    expect(target('test', 'quranheals_test').databaseName).toBe('quranheals_test');
    expect(() => target('test', 'quranheals_dev')).toThrow(/NODE_ENV=test may not use/);
    expect(() => target('test', 'quranheals_prod')).toThrow(/NODE_ENV=test may not use/);
    expect(() => target('test', 'test')).toThrow(/reserved/);
  });
});

describe('database target: other guards', () => {
  it('requires MONGODB_URI', () => {
    expect(() => resolveDatabaseTarget({ nodeEnv: 'production', dbName: 'quranheals_prod' })).toThrow(/MONGODB_URI is required/);
  });

  it('rejects an ambiguous URI path that disagrees with MONGODB_DB_NAME', () => {
    expect(() => target('production', 'quranheals_prod', 'mongodb+srv://u:p@cluster.example.invalid/test?w=majority')).toThrow(/names database "test"/);
    expect(target('production', 'quranheals_prod', 'mongodb+srv://u:p@cluster.example.invalid/quranheals_prod').databaseName).toBe('quranheals_prod');
  });

  it('rejects every reserved name and malformed names, in every environment', () => {
    for (const name of ['test', 'TEST', 'admin', 'local', 'config']) expect(() => target('development', name), name).toThrow(/reserved/);
    expect(() => target('development', 'quranheals dev')).toThrow(/not a valid database name/);
  });

  it('never puts the URI, credentials or host into an error message', () => {
    for (const run of [() => target('production'), () => target('production', 'test'), () => target('development', 'quranheals_prod')]) {
      let message = '';
      try {
        run();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toMatch(/secret-password|cluster\.example\.invalid|mongodb\+srv/);
    }
  });
});

describe('databaseNameFromUri', () => {
  it.each([
    ['mongodb+srv://u:p@cluster.example.invalid/?retryWrites=true', null],
    ['mongodb+srv://u:p@cluster.example.invalid', null],
    ['mongodb://localhost:27017/quranheals_dev', 'quranheals_dev'],
    ['mongodb://h1.invalid:27017,h2.invalid:27017/quranheals_prod?replicaSet=rs0', 'quranheals_prod'],
    ['mongodb://u:p%2Fq@localhost/quranheals_dev', 'quranheals_dev'],
  ])('%s → %s', (uri, expected) => {
    expect(databaseNameFromUri(uri)).toBe(expected);
  });

  it('rejects a non-MongoDB string', () => {
    expect(() => databaseNameFromUri('quranheals_prod')).toThrow(/not a mongodb/);
  });
});

describe('script access to production', () => {
  const prod = { environment: 'production' as const, databaseName: 'quranheals_prod' };
  const dev = { environment: 'development' as const, databaseName: 'quranheals_dev' };

  it('development targets are always allowed', () => {
    expect(() => assertScriptMayUseTarget(dev, { script: 'seed', writes: true }, {})).not.toThrow();
  });

  it('refuses production for scripts that do not support it, even read-only', () => {
    expect(() => assertScriptMayUseTarget(prod, { script: 'seed', writes: true }, {})).toThrow(/seed does not support the production database/);
    expect(() => assertScriptMayUseTarget(prod, { script: 'quran:regression', writes: false }, {})).toThrow(/does not support/);
  });

  it('a production write needs the exact confirmation variable', () => {
    const access = { script: 'mapping:deactivate', writes: true, productionSupported: true };
    expect(() => assertScriptMayUseTarget(prod, access, {})).toThrow(/QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod/);
    expect(() => assertScriptMayUseTarget(prod, access, { QURAN_HEALS_CONFIRM_PRODUCTION_WRITE: 'yes' })).toThrow();
    expect(() => assertScriptMayUseTarget(prod, access, { QURAN_HEALS_CONFIRM_PRODUCTION_WRITE: 'quranheals_prod' })).not.toThrow();
    expect(() => assertScriptMayUseTarget(prod, { ...access, writes: false }, {})).not.toThrow();
  });

  it('prints only environment, database name and mode', () => {
    expect(describeTarget(dev, { script: 'seed', writes: true })).toBe('[seed] environment=development database=quranheals_dev mode=WRITE');
  });
});
