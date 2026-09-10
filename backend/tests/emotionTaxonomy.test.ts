import { describe, expect, it } from 'vitest';

import { seedEmotions } from '../src/seed/emotions';
import {
  buildAliasIndex,
  findAliasCollisions,
  normalizeAliasPhrase,
  resolveAlias,
} from '../src/taxonomy/aliasResolver';
import {
  discoveryModes,
  emotionFamilies,
  emotionTaxonomyCandidates,
  LIVE_EMOTION_KEY_PATTERN,
  phase5aTaxonomy,
  recommendedVisibleKeys,
  TAXONOMY_KEY_PATTERN,
} from '../src/taxonomy/emotionTaxonomy';

describe('Phase 5A emotion taxonomy', () => {
  it('carries the full 32-candidate working set (31 emotional + 1 discovery)', () => {
    expect(emotionTaxonomyCandidates).toHaveLength(31);
    expect(discoveryModes).toHaveLength(1);
    expect(phase5aTaxonomy).toHaveLength(32);
  });

  it('has unique, well-formed, language-independent keys', () => {
    const keys = phase5aTaxonomy.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);

    for (const entry of phase5aTaxonomy) {
      expect(entry.key, entry.key).toMatch(TAXONOMY_KEY_PATTERN);
      // Keys never encode the display text.
      expect(entry.key).not.toBe(entry.arabic);
      expect(entry.english.length).toBeGreaterThan(0);
      expect(entry.arabic.length).toBeGreaterThan(0);
      expect(emotionFamilies).toContain(entry.family);
    }
  });

  it('keeps the discovery mode out of the emotion set', () => {
    expect(discoveryModes[0].key).toBe('quran_message');
    expect(discoveryModes[0].kind).toBe('discovery');
    expect(emotionTaxonomyCandidates.every((entry) => entry.kind === 'emotion')).toBe(true);
    expect(emotionTaxonomyCandidates.some((entry) => entry.key === 'quran_message')).toBe(false);
  });

  it('preserves every shipped emotion, unchanged, as a "main" candidate', () => {
    for (const seeded of seedEmotions) {
      const entry = phase5aTaxonomy.find((candidate) => candidate.key === seeded.key);
      expect(entry, `taxonomy is missing shipped emotion "${seeded.key}"`).toBeDefined();
      expect(entry?.shipped).toBe(true);
      expect(entry?.recommendation).toBe('main');
      // Shipped keys already satisfy the live pattern and must not be renamed.
      expect(seeded.key).toMatch(LIVE_EMOTION_KEY_PATTERN);
    }
  });

  it('recommends 30 visible choices including the discovery mode', () => {
    expect(recommendedVisibleKeys).toContain('quran_message');
    expect(recommendedVisibleKeys.length).toBe(30);
  });

  it('keeps `overwhelmed` and `content` as main, with no resolvesTo', () => {
    for (const key of ['overwhelmed', 'content']) {
      const entry = phase5aTaxonomy.find((candidate) => candidate.key === key);
      expect(entry?.recommendation, key).toBe('main');
      expect(entry?.resolvesTo, key).toBeUndefined();
      expect(recommendedVisibleKeys).toContain(key);
    }
  });

  it('flags exactly two emotional candidates for demotion (regretful, frustrated)', () => {
    const demoted = phase5aTaxonomy
      .filter((entry) => entry.recommendation === 'merge_candidate')
      .map((entry) => entry.key)
      .sort();
    expect(demoted).toEqual(['frustrated', 'regretful']);
  });

  it('points every demoted candidate at a real main key (never a shipped demotion)', () => {
    const mainKeys = new Set(
      phase5aTaxonomy
        .filter((entry) => entry.recommendation === 'main')
        .map((entry) => entry.key),
    );
    const shippedKeys = new Set(seedEmotions.map((emotion) => emotion.key));

    for (const entry of phase5aTaxonomy) {
      if (entry.recommendation === 'main' || entry.recommendation === 'discovery_mode') {
        continue;
      }

      expect(entry.resolvesTo, `${entry.key} has no resolvesTo`).toBeTruthy();
      expect(mainKeys, `${entry.key} -> ${entry.resolvesTo}`).toContain(entry.resolvesTo);
      expect(entry.shipped, `shipped emotion "${entry.key}" must not be demoted`).toBe(false);
    }
  });
});

describe('Phase 5A alias resolution', () => {
  it('normalizes English casing and Arabic tashkeel', () => {
    expect(normalizeAliasPhrase('  Really   SAD ')).toBe('really sad');
    expect(normalizeAliasPhrase('حَزِين')).toBe(normalizeAliasPhrase('حزين'));
  });

  it('resolves labels, keys and aliases to a stable main key', () => {
    expect(resolveAlias('sad')?.mainKey).toBe('sad');
    expect(resolveAlias('feeling low')?.mainKey).toBe('sad');
    expect(resolveAlias('زعلان')?.mainKey).toBe('sad');
    expect(resolveAlias('عايز أعيط')?.mainKey).toBe('want_to_cry');
    expect(resolveAlias('عندي غل')?.mainKey).toBe('forgiveness_struggle');
  });

  it('sends a demoted candidate alias to its main key', () => {
    const resolution = resolveAlias('fed up');
    expect(resolution?.key).toBe('frustrated');
    expect(resolution?.mainKey).toBe('angry');
  });

  it('resolves a retained candidate to itself', () => {
    expect(resolveAlias('too much')?.mainKey).toBe('overwhelmed');
    expect(resolveAlias('qana‘ah')?.mainKey).toBe('content');
  });

  it('returns null for unknown or empty input', () => {
    expect(resolveAlias('')).toBeNull();
    expect(resolveAlias('   ')).toBeNull();
    expect(resolveAlias('this is not a known feeling phrase')).toBeNull();
  });

  it('has no ambiguous alias phrases shared between two entries', () => {
    expect(findAliasCollisions()).toEqual([]);
  });

  it('builds an index that covers every key', () => {
    const index = buildAliasIndex();
    for (const entry of phase5aTaxonomy) {
      expect(index.get(entry.key)?.key).toBe(entry.key);
    }
  });
});
