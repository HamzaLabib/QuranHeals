import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Proves the docs/report reorganization moved these seven files correctly:
// three machine-readable Quran-runtime audit reports (now under
// backend/reports/quran-data/runtime/) and, indirectly, that the generator
// scripts which produce them target the new location. This suite never
// executes those generators (each needs a live browser-driver session, an
// Expo export bundle, or a MongoDB connection) - it only inspects their
// already-written output and their source-level output path.

const REPO_ROOT = resolve(__dirname, '../../..');
const RUNTIME_REPORTS_DIR = resolve(REPO_ROOT, 'backend/reports/quran-data/runtime');

const OLD_DOCS_JSON_PATHS = [
  resolve(REPO_ROOT, 'docs/quran-runtime-browser-report.json'),
  resolve(REPO_ROOT, 'docs/quran-runtime-export-report.json'),
  resolve(REPO_ROOT, 'docs/quran-runtime-live-audit.json'),
];
const OLD_DOCS_MD_PATHS = [
  resolve(REPO_ROOT, 'docs/phase-5a-emotion-taxonomy.md'),
  resolve(REPO_ROOT, 'docs/quran-runtime-migration.md'),
  resolve(REPO_ROOT, 'docs/quran-runtime-compatibility.md'),
  resolve(REPO_ROOT, 'docs/quran-sqlite-migration.md'),
];

describe('Runtime audit reports live under backend/reports/quran-data/runtime/', () => {
  it('all three new report paths exist', () => {
    expect(existsSync(resolve(RUNTIME_REPORTS_DIR, 'browser-validation.json'))).toBe(true);
    expect(existsSync(resolve(RUNTIME_REPORTS_DIR, 'export-validation.json'))).toBe(true);
    expect(existsSync(resolve(RUNTIME_REPORTS_DIR, 'live-audit.json'))).toBe(true);
  });

  it('none of the seven old docs/ paths exist any more', () => {
    [...OLD_DOCS_JSON_PATHS, ...OLD_DOCS_MD_PATHS].forEach((oldPath) => {
      expect(existsSync(oldPath), `old path should be gone: ${oldPath}`).toBe(false);
    });
  });

  it('browser-validation.json parses and has non-null required fields', () => {
    const report = JSON.parse(readFileSync(resolve(RUNTIME_REPORTS_DIR, 'browser-validation.json'), 'utf-8'));
    expect(report.environment).toBeTypeOf('string');
    expect(Array.isArray(report.emotions)).toBe(true);
    expect(report.emotions.length).toBeGreaterThan(0);
    report.emotions.forEach((row: unknown) => {
      const entry = row as { emotion?: unknown; verseKey?: unknown; exactArabic?: unknown };
      expect(entry.emotion).toBeTypeOf('string');
      expect(entry.verseKey).toBeTypeOf('string');
      expect(entry.exactArabic).not.toBeUndefined();
      expect(entry.exactArabic).not.toBeNull();
    });
    expect(report.checks).not.toBeNull();
  });

  it('export-validation.json parses and has non-null required fields', () => {
    const report = JSON.parse(readFileSync(resolve(RUNTIME_REPORTS_DIR, 'export-validation.json'), 'utf-8'));
    expect(report.sqliteSha256).toBe('c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b');
    expect(report.platforms.ios).not.toBeNull();
    expect(report.platforms.android).not.toBeNull();
    expect(report.platforms.web).not.toBeNull();
    expect(report.limitation).toBeTypeOf('string');
  });

  it('live-audit.json parses and has non-null required fields', () => {
    const report = JSON.parse(readFileSync(resolve(RUNTIME_REPORTS_DIR, 'live-audit.json'), 'utf-8'));
    expect(report.sqlite).not.toBeNull();
    expect(report.sqlite.sha256).toBe('c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b');
    expect(report.seeded).not.toBeNull();
    expect(report.live).not.toBeNull();
    expect(report.sqliteUnchanged).toBe(true);
    // The one path-shaped field in this report is unrelated to this
    // migration (the SQLite asset itself, not one of the seven moved files)
    // and must remain exactly as generated.
    expect(report.sqlite.path).toBe('mobile/assets/quran/quran.sqlite');
  });
});

describe('Report generators target the new runtime-reports location', () => {
  it('auditSqliteReferences.ts writes live-audit.json under backend/reports/quran-data/runtime/, never docs/', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'backend/src/scripts/auditSqliteReferences.ts'), 'utf-8');
    expect(source).toContain("resolve(repoRoot, 'backend/reports/quran-data/runtime/live-audit.json')");
    expect(source).not.toMatch(/docs\/quran-runtime-live-audit\.json/);
  });

  it('browser-check.mjs writes browser-validation.json under backend/reports/quran-data/runtime/, never docs/, and creates the directory recursively', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'tools/quran-runtime/browser-check.mjs'), 'utf-8');
    expect(source).toContain('../../backend/reports/quran-data/runtime/browser-validation.json');
    expect(source).toMatch(/mkdirSync\(dirname\(outputPath\), \{ ?recursive: ?true ?\}\)/);
    expect(source).not.toMatch(/docs\/quran-runtime-browser-report\.json/);
  });

  it('verify-export.mjs writes export-validation.json under backend/reports/quran-data/runtime/, never docs/, and creates the directory recursively', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'tools/quran-runtime/verify-export.mjs'), 'utf-8');
    expect(source).toContain("resolve(root, 'backend/reports/quran-data/runtime/export-validation.json')");
    expect(source).toMatch(/mkdirSync\(dirname\(outputPath\), \{ ?recursive: ?true ?\}\)/);
    expect(source).not.toMatch(/docs\/quran-runtime-export-report\.json/);
  });
});

describe('Moved documentation exists at its new path', () => {
  it('the emotion-mapping taxonomy document exists under docs/emotion-mappings/', () => {
    const taxonomyPath = resolve(REPO_ROOT, 'docs/emotion-mappings/taxonomy.md');
    expect(existsSync(taxonomyPath)).toBe(true);
    const content = readFileSync(taxonomyPath, 'utf-8');
    expect(content.startsWith('# Emotion taxonomy')).toBe(true);
  });

  it('the three quran-data documents exist under docs/quran-data/', () => {
    ['runtime-architecture.md', 'runtime-compatibility.md', 'sqlite-integration.md'].forEach((file) => {
      expect(existsSync(resolve(REPO_ROOT, 'docs/quran-data', file))).toBe(true);
    });
  });

  it('the runtime-architecture document does not falsely claim Phase 4C MongoDB cleanup is complete', () => {
    const content = readFileSync(resolve(REPO_ROOT, 'docs/quran-data/runtime-architecture.md'), 'utf-8');
    expect(content).toMatch(/cleanup[\s\S]{0,80}pending/i);
    expect(content).toMatch(/Phase 4C has \*\*not\*\*\s+been executed/);
    expect(content).toMatch(/has not been executed destructively/);
  });
});
