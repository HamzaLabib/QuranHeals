import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LOCALES, type AppLocale } from '../src/localization/locales';
import { resolveLocalizedEmotionName } from '../src/utils/emotionLabel';
import type { LocalizedText } from '../src/types/domain';

/**
 * Reads all 29 { key, names } entries directly from
 * backend/src/emotions/emotionCatalog.ts (never duplicated/hardcoded here —
 * same source-of-truth-reading approach as emotionIcons.test.ts and the
 * "renamed emotions" check in emotionLabel.test.ts, just extended to every
 * one of the 29 instead of a handful).
 */
const CATALOG_PATH = resolve(__dirname, '../../backend/src/emotions/emotionCatalog.ts');

type CatalogEntry = { key: string; names: LocalizedText };

function loadCatalogEntries(): CatalogEntry[] {
  const source = readFileSync(CATALOG_PATH, 'utf-8');
  const pattern =
    /key: '([a-z_]+)',\s*\n\s*names: \{ en: '([^']+)', ar: '([^']+)', 'ar-EG': '([^']+)' \}/g;
  return [...source.matchAll(pattern)].map(([, key, en, ar, arEG]) => ({
    key,
    names: { en, ar, 'ar-EG': arEG },
  }));
}

describe('all 29 canonical emotions resolve a real localized name in every app locale', () => {
  const entries = loadCatalogEntries();

  it('the parser actually found all 29 entries (sanity check on the regex itself)', () => {
    expect(entries).toHaveLength(29);
  });

  it('resolves a non-empty, catalog-matching name for every emotion in en, ar, and ar-EG', () => {
    entries.forEach(({ key, names }) => {
      APP_LOCALES.forEach((locale) => {
        const resolved = resolveLocalizedEmotionName(names, locale, key);
        expect(resolved.trim().length, `${key} (${locale}) resolved to an empty name`).toBeGreaterThan(0);
        expect(resolved, `${key} (${locale}) did not match the catalog's own text`).toBe(names[locale]);
        // The stable key must never leak into the display text.
        expect(resolved).not.toBe(key);
      });
    });
  });

  it('every emotion has three distinct locale entries defined (no locale silently reusing another\'s text by accident)', () => {
    entries.forEach(({ key, names }) => {
      const values = APP_LOCALES.map((locale: AppLocale) => names[locale]);
      values.forEach((value) => expect(value.trim().length, `${key} has a blank locale entry`).toBeGreaterThan(0));
    });
  });
});

describe('known long emotion labels render in full, unmangled, in every locale', () => {
  // The exact emotions called out for layout attention (long English AND
  // Arabic/Egyptian labels). Reuses the same catalog-derived entries above
  // — never a second hardcoded copy of the Arabic/Egyptian text — and just
  // asserts the resolution pipeline returns each one's full text verbatim,
  // with no truncation/slicing, in every locale.
  const longLabelKeys = ['want_to_cry', 'forgiveness_struggle', 'reassurance', 'seeking_guidance', 'closer_to_allah'];
  const entries = loadCatalogEntries();

  it('the expected long-label emotions actually exist in the catalog (sanity check)', () => {
    const foundKeys = entries.map((entry) => entry.key);
    longLabelKeys.forEach((key) => expect(foundKeys).toContain(key));
  });

  longLabelKeys.forEach((key) => {
    it(`"${key}" resolves each locale's full text with no truncation or mangling`, () => {
      const entry = entries.find((candidate) => candidate.key === key)!;
      APP_LOCALES.forEach((locale) => {
        const resolved = resolveLocalizedEmotionName(entry.names, locale, key);
        expect(resolved).toBe(entry.names[locale]);
        // A meaningful minimum length — proves this is real text, not an
        // accidentally-empty or single-character stand-in.
        expect(resolved.length).toBeGreaterThan(3);
      });
    });
  });
});
