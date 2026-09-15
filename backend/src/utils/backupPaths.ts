import { resolve } from 'node:path';

/**
 * Side-effect-free backup/report path constants shared by fullQuran.ts and
 * prepareArabicCleanup.ts. Importing this module must never load Quran data,
 * connect to MongoDB, write a file, or inspect CLI arguments — it only
 * resolves three absolute paths from this file's own location (never the
 * process CWD), so it stays importable and testable even when
 * backend/data/quran/quran-data.xml is missing.
 */

/** Pre-`--write` MongoDB snapshot backups for fullQuran.ts. Git-ignored. */
export const QURAN_DATA_BACKUPS_DIR = resolve(__dirname, '../../backups/quran-data');

/** Pre-`--destructive` MongoDB Arabic-field backups for prepareArabicCleanup.ts. Git-ignored. */
export const ARABIC_CLEANUP_BACKUPS_DIR = resolve(__dirname, '../../backups/data-cleanup');

/** The reproducible dry-run report — a report, never a backup, and never git-ignored. */
export const CLEANUP_DRY_RUN_REPORT_PATH = resolve(__dirname, '../../reports/data-cleanup/cleanup-dry-run.json');

/** Pre-`--destructive` MongoDB translation-field/document backups for prepareTranslationCleanup.ts (Phase 6A.8C). Git-ignored. */
export const TRANSLATION_CLEANUP_BACKUPS_DIR = resolve(__dirname, '../../backups/translation-cleanup');

/** The reproducible translation-cleanup dry-run report — a report, never a backup, and never git-ignored. */
export const TRANSLATION_CLEANUP_DRY_RUN_REPORT_PATH = resolve(
  __dirname,
  '../../reports/data-cleanup/translation-cleanup-dry-run.json',
);
