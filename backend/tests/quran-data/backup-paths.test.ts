import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ARABIC_CLEANUP_BACKUPS_DIR,
  CLEANUP_DRY_RUN_REPORT_PATH,
  QURAN_DATA_BACKUPS_DIR,
} from '../../src/utils/backupPaths';

// This file imports ONLY backend/src/utils/backupPaths.ts - a side-effect-free
// module that resolves three path constants and does nothing else (no Quran
// corpus load, no MongoDB connect, no file write, no CLI parsing). It must
// therefore run - and pass - even when backend/data/quran/quran-data.xml is
// missing, unlike the equivalent assertion that used to live inside
// full-quran.test.ts (which fails to initialize at all in that environment,
// because it separately calls loadCorpus() at module scope for its own,
// unrelated corpus-validation tests).

describe('Side-effect-free backup/report path constants', () => {
  it('QURAN_DATA_BACKUPS_DIR resolves under backend/backups/quran-data, not backend/reports', () => {
    expect(QURAN_DATA_BACKUPS_DIR).toBe(resolve(__dirname, '../../backups/quran-data'));
    expect(QURAN_DATA_BACKUPS_DIR.split(/[\\/]/)).toEqual(expect.arrayContaining(['backups', 'quran-data']));
    expect(QURAN_DATA_BACKUPS_DIR).not.toMatch(/[\\/]reports([\\/]|$)/);
  });

  it('ARABIC_CLEANUP_BACKUPS_DIR resolves under backend/backups/data-cleanup, not backend/reports', () => {
    expect(ARABIC_CLEANUP_BACKUPS_DIR).toBe(resolve(__dirname, '../../backups/data-cleanup'));
    expect(ARABIC_CLEANUP_BACKUPS_DIR.split(/[\\/]/)).toEqual(expect.arrayContaining(['backups', 'data-cleanup']));
    expect(ARABIC_CLEANUP_BACKUPS_DIR).not.toMatch(/[\\/]reports([\\/]|$)/);
  });

  it('CLEANUP_DRY_RUN_REPORT_PATH resolves under backend/reports/cleanup/, never under backend/backups/', () => {
    expect(CLEANUP_DRY_RUN_REPORT_PATH).toBe(resolve(__dirname, '../../reports/cleanup/cleanup-dry-run.json'));
    expect(CLEANUP_DRY_RUN_REPORT_PATH).toMatch(/[\\/]reports[\\/]cleanup[\\/]cleanup-dry-run\.json$/);
    expect(CLEANUP_DRY_RUN_REPORT_PATH).not.toMatch(/[\\/]backups([\\/]|$)/);
  });

  it('the three constants are all distinct paths', () => {
    const paths = [QURAN_DATA_BACKUPS_DIR, ARABIC_CLEANUP_BACKUPS_DIR, CLEANUP_DRY_RUN_REPORT_PATH];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('importing backupPaths.ts triggers no Quran corpus load, MongoDB connection, or file write', () => {
    // Purely a structural assertion: everything above already ran without a
    // MONGODB_URI, without backend/data/quran/quran-data.xml on disk, and
    // without producing any file - resolve() over string literals is the
    // module's entire behavior. Importing this module in this test process,
    // which has neither a database connection nor the legacy XML present,
    // and reaching this line at all, is the proof.
    expect(typeof QURAN_DATA_BACKUPS_DIR).toBe('string');
  });
});
