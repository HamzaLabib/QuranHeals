/**
 * Phase 5A alias resolution — REFERENCE / DESIGN CODE.
 *
 * Turns free-text user input ("really sad", "زعلان أوي", "عايز أعيط") into a
 * stable emotion key. Not wired into the API yet; it exists so the alias design
 * in `docs/phase-5a-emotion-taxonomy.md` is executable and testable.
 *
 * Resolution is deliberately simple: exact/normalized match against the label
 * and alias lists in the taxonomy. Fuzzy matching, stemming and embeddings are
 * out of scope for Phase 5A.
 */

import {
  phase5aTaxonomy,
  type EmotionTaxonomyEntry,
  type TaxonomyRecommendation,
} from './emotionTaxonomy';

/**
 * Normalizes a phrase for comparison:
 * - trims and lowercases (harmless for Arabic; needed for English)
 * - collapses internal whitespace
 * - strips Arabic tashkeel/tatweel so "حَزين" and "حزين" match
 * - removes a small set of punctuation
 *
 * It does NOT touch Quran text — only user-supplied emotion phrases.
 */
export function normalizeAliasPhrase(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/[ـ]/g, '') // tatweel
    .replace(/[ً-ْٰ]/g, '') // tashkeel
    .replace(/[.,!؟?"'`ـ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type AliasResolution = {
  key: string;
  /** The main key this resolves to (same as `key` unless the match is a demoted candidate). */
  mainKey: string;
  matchedOn: 'key' | 'english' | 'arabic' | 'englishAlias' | 'arabicAlias';
  recommendation: TaxonomyRecommendation;
};

type IndexRow = {
  phrase: string;
  entry: EmotionTaxonomyEntry;
  matchedOn: AliasResolution['matchedOn'];
};

function buildRows(taxonomy: EmotionTaxonomyEntry[]): IndexRow[] {
  const rows: IndexRow[] = [];

  for (const entry of taxonomy) {
    rows.push({ phrase: normalizeAliasPhrase(entry.key), entry, matchedOn: 'key' });
    rows.push({ phrase: normalizeAliasPhrase(entry.english), entry, matchedOn: 'english' });
    rows.push({ phrase: normalizeAliasPhrase(entry.arabic), entry, matchedOn: 'arabic' });

    for (const alias of entry.englishAliases) {
      rows.push({ phrase: normalizeAliasPhrase(alias), entry, matchedOn: 'englishAlias' });
    }

    for (const alias of entry.arabicAliases) {
      rows.push({ phrase: normalizeAliasPhrase(alias), entry, matchedOn: 'arabicAlias' });
    }
  }

  return rows;
}

const specificity: Record<AliasResolution['matchedOn'], number> = {
  key: 5,
  english: 4,
  arabic: 4,
  englishAlias: 2,
  arabicAlias: 2,
};

/**
 * Builds a phrase -> resolution map. If two taxonomy entries claim the same
 * phrase, the more specific match (key/label over alias) wins; genuine
 * alias/alias collisions are returned by `findAliasCollisions` so they can be
 * cleaned up in review rather than silently resolved.
 */
export function buildAliasIndex(
  taxonomy: EmotionTaxonomyEntry[] = phase5aTaxonomy,
): Map<string, AliasResolution> {
  const rows = buildRows(taxonomy);
  const best = new Map<string, IndexRow>();

  for (const row of rows) {
    const current = best.get(row.phrase);

    if (!current || specificity[row.matchedOn] > specificity[current.matchedOn]) {
      best.set(row.phrase, row);
    }
  }

  const index = new Map<string, AliasResolution>();

  for (const [phrase, row] of best) {
    index.set(phrase, {
      key: row.entry.key,
      mainKey: row.entry.resolvesTo ?? row.entry.key,
      matchedOn: row.matchedOn,
      recommendation: row.entry.recommendation,
    });
  }

  return index;
}

/** Alias/alias phrases claimed by more than one taxonomy entry. */
export function findAliasCollisions(
  taxonomy: EmotionTaxonomyEntry[] = phase5aTaxonomy,
): { phrase: string; keys: string[] }[] {
  const byPhrase = new Map<string, Set<string>>();

  for (const row of buildRows(taxonomy)) {
    if (row.matchedOn !== 'englishAlias' && row.matchedOn !== 'arabicAlias') {
      continue;
    }

    const keys = byPhrase.get(row.phrase) ?? new Set<string>();
    keys.add(row.entry.key);
    byPhrase.set(row.phrase, keys);
  }

  return [...byPhrase.entries()]
    .filter(([, keys]) => keys.size > 1)
    .map(([phrase, keys]) => ({ phrase, keys: [...keys].sort() }));
}

/**
 * Resolves one free-text phrase to a taxonomy entry, or null when nothing
 * matches. Callers that only care about the card to open should use `.mainKey`.
 */
export function resolveAlias(
  input: string,
  index: Map<string, AliasResolution> = buildAliasIndex(),
): AliasResolution | null {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }

  return index.get(normalizeAliasPhrase(input)) ?? null;
}
