import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Meanings and Surah Preview in release builds (owner decision, 2026-10-24; docs/content-datasets-release.md):
 * - both datasets are bundled in every build (no __DEV__ guard), still required lazily inside one function;
 * - the real functions, run with vitest's __DEV__ false (as in a release bundle), report the data bundled;
 * - EAS Build may upload the two git-ignored dataset files and nothing else that git ignores: the repository's
 *   .easignore repeats every .gitignore rule (nested ones with their folder prefixed), except those two files, and
 *   repeats each folder rule without its trailing slash (EAS's copy tests a folder's own path that way).
 */
const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const read = (path: string) => readFileSync(repo(path), 'utf8');
const SHIPPED = ['mobile/assets/word-meanings/ghareeb.json', 'mobile/assets/surah-preview/surah-preview.json'];
const rules = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));

describe('Meanings and Surah Preview: bundled in release builds', () => {
  it.each([
    ['wordMeanings', 'bundledWordMeanings', 'isWordMeaningsBundled', 'word-meanings/ghareeb.json'],
    ['surahPreview', 'bundledSurahPreview', 'isSurahPreviewBundled', 'surah-preview/surah-preview.json'],
  ])('%s: no __DEV__ guard; one lazy require inside %s; %s is true', (folder, loader, flag, asset) => {
    const source = read(`mobile/src/${folder}/bundledDataset.ts`);
    expect(source).not.toMatch(/__DEV__/);
    expect(source.match(/require\(/g)).toHaveLength(1);
    expect(source).toMatch(new RegExp(`export function ${loader}\\(\\): unknown \\{\\s*(//[^\\n]*\\n\\s*)*return require\\('\\.\\./\\.\\./assets/${asset.replace(/[.]/g, '\\.')}'\\);\\s*\\}`));
    expect(source).toMatch(new RegExp(`export function ${flag}\\(\\): boolean \\{\\s*return true;\\s*\\}`));
  });

  it('the real flags, as a release bundle runs them (__DEV__ false): both datasets bundled', async () => {
    expect(__DEV__).toBe(false);
    expect((await import('@/wordMeanings/bundledDataset')).isWordMeaningsBundled()).toBe(true);
    expect((await import('@/surahPreview/bundledDataset')).isSurahPreviewBundled()).toBe(true);
    // The rollback switches are unchanged (on).
    expect((await import('@/wordMeanings/config')).WORD_MEANINGS_ENABLED).toBe(true);
    expect((await import('@/surahPreview/config')).SURAH_PREVIEW_ENABLED).toBe(true);
  });

  it('both dataset files stay out of Git', () => {
    const gitignore = rules(read('.gitignore'));
    for (const path of SHIPPED) expect(gitignore).toContain(path);
  });
});

describe('.easignore: EAS Build uploads the two datasets and nothing else that Git ignores', () => {
  const easignore = rules(read('.easignore'));

  it('repeats every root .gitignore rule except the two dataset files, which it leaves out', () => {
    const expected = rules(read('.gitignore')).filter((rule) => !SHIPPED.includes(rule));
    expect(expected.filter((rule) => !easignore.includes(rule))).toEqual([]);
    for (const path of SHIPPED) expect(easignore).not.toContain(path);
    // Their partial downloads stay out of the upload.
    expect(easignore).toEqual(expect.arrayContaining(['mobile/assets/word-meanings/*.partial', 'mobile/assets/surah-preview/*.partial']));
  });

  it.each(['mobile', 'backend/backups', 'unicode-experiments'])('repeats %s/.gitignore with its folder prefixed', (dir) => {
    const missing = rules(read(`${dir}/.gitignore`)).map((rule) => {
      const negated = rule.startsWith('!');
      const body = negated ? rule.slice(1) : rule;
      const anchored = body.replace(/\/$/, '').includes('/');
      return (negated ? '!' : '') + (anchored ? `${dir}/${body.replace(/^\//, '')}` : `${dir}/**/${body}`);
    }).filter((rule) => !easignore.includes(rule));
    expect(missing).toEqual([]);
  });

  it('every folder rule is also there without its trailing slash (or EAS uploads the folder whole)', () => {
    const folders = easignore.filter((rule) => !rule.startsWith('!') && rule.endsWith('/') && rule.length > 1);
    expect(folders.length).toBeGreaterThan(10);
    expect(folders.map((rule) => rule.slice(0, -1)).filter((rule) => !easignore.includes(rule))).toEqual([]);
    // The folders it mattered for (found in a local `eas build:inspect --stage archive`, 2026-10-24).
    for (const folder of ['backend/data/mushaf-sync', 'backend/backups', 'tools/word-meanings/source', 'tools/surah-preview/source']) {
      expect(easignore).toContain(folder);
    }
  });

  it('secrets and other git-ignored content stay out: no rule of .easignore un-ignores anything .gitignore ignores', () => {
    const negations = easignore.filter((rule) => rule.startsWith('!'));
    const gitNegations = [...rules(read('.gitignore')), ...rules(read('mobile/.gitignore')), ...rules(read('backend/backups/.gitignore')), ...rules(read('unicode-experiments/.gitignore'))]
      .filter((rule) => rule.startsWith('!'));
    // Only the .gitignore files' own negations, carried over (prefixed for nested ones).
    expect(negations.length).toBe(gitNegations.length);
  });
});
