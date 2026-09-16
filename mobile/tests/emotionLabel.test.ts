import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { formatEmotionKeyAsLabel, resolveEmotionLabel, resolveEmotionDisplayName, resolveLocalizedEmotionName } from '../src/utils/emotionLabel';
import type { LocalizedText } from '../src/types/domain';

describe('formatEmotionKeyAsLabel', () => {
  it('formats an underscore-separated key into a readable Title Case label', () => {
    expect(formatEmotionKeyAsLabel('want_to_cry')).toBe('Want To Cry');
    expect(formatEmotionKeyAsLabel('forgiveness_struggle')).toBe('Forgiveness Struggle');
    expect(formatEmotionKeyAsLabel('seeking_guidance')).toBe('Seeking Guidance');
    expect(formatEmotionKeyAsLabel('closer_to_allah')).toBe('Closer To Allah');
  });

  it('still formats a hyphen-separated key correctly (existing behavior preserved)', () => {
    expect(formatEmotionKeyAsLabel('help-circle')).toBe('Help Circle');
  });

  it('formats a single-word key unchanged apart from capitalization', () => {
    expect(formatEmotionKeyAsLabel('sad')).toBe('Sad');
    expect(formatEmotionKeyAsLabel('guilty')).toBe('Guilty');
  });

  it('handles a mix of hyphens and underscores in the same key', () => {
    expect(formatEmotionKeyAsLabel('foo-bar_baz')).toBe('Foo Bar Baz');
  });

  it('collapses repeated separators without producing empty words', () => {
    expect(formatEmotionKeyAsLabel('foo__bar--baz')).toBe('Foo Bar Baz');
  });
});

describe('resolveEmotionLabel', () => {
  it('prefers the authoritative API-provided name over any key-derived formatting', () => {
    expect(resolveEmotionLabel('want_to_cry', 'I Want to Cry')).toBe('I Want to Cry');
    expect(resolveEmotionLabel('forgiveness_struggle', "I Can't Forgive")).toBe("I Can't Forgive");
    expect(resolveEmotionLabel('closer_to_allah', 'I Want to Be Closer to Allah')).toBe('I Want to Be Closer to Allah');
  });

  it('falls back to key formatting when no API name is available (e.g. a stale deep link)', () => {
    expect(resolveEmotionLabel('seeking_guidance', undefined)).toBe('Seeking Guidance');
  });

  it('falls back to key formatting when the API name is an empty/whitespace string', () => {
    expect(resolveEmotionLabel('seeking_guidance', '')).toBe('Seeking Guidance');
    expect(resolveEmotionLabel('seeking_guidance', '   ')).toBe('Seeking Guidance');
  });

  it('returns a generic placeholder when neither a key nor a name is available', () => {
    expect(resolveEmotionLabel(undefined, undefined)).toBe('Emotion');
  });

  it('existing single-word keys still resolve correctly through the full preference chain', () => {
    expect(resolveEmotionLabel('sad', 'Sad')).toBe('Sad');
    expect(resolveEmotionLabel('sad', undefined)).toBe('Sad');
  });
});

describe('resolveLocalizedEmotionName / resolveEmotionDisplayName (locale-aware display, stable key never affected)', () => {
  const names: LocalizedText = { en: 'At Peace', ar: 'مطمئن', 'ar-EG': 'مطمّن' };

  it('returns the requested locale`s own name when present', () => {
    expect(resolveLocalizedEmotionName(names, 'en', 'peaceful')).toBe('At Peace');
    expect(resolveLocalizedEmotionName(names, 'ar', 'peaceful')).toBe('مطمئن');
    expect(resolveLocalizedEmotionName(names, 'ar-EG', 'peaceful')).toBe('مطمّن');
  });

  it('falls back to English when the requested locale`s entry is missing from a partial/stale names map', () => {
    const partial: LocalizedText = { en: 'At Peace', ar: '', 'ar-EG': '   ' };
    expect(resolveLocalizedEmotionName(partial, 'ar', 'peaceful')).toBe('At Peace');
    expect(resolveLocalizedEmotionName(partial, 'ar-EG', 'peaceful')).toBe('At Peace');
  });

  it('falls back to a formatted key when no localized name is available at all (e.g. a stale deep link)', () => {
    expect(resolveLocalizedEmotionName(undefined, 'en', 'want_to_cry')).toBe('Want To Cry');
    expect(resolveLocalizedEmotionName({} as LocalizedText, 'ar', 'closer_to_allah')).toBe('Closer To Allah');
  });

  it('returns the generic placeholder only when neither a names map nor a key is available', () => {
    expect(resolveLocalizedEmotionName(undefined, 'en', undefined)).toBe('Emotion');
  });

  it('never uses the stable key itself as display text when a localized name exists — the key stays internal-only', () => {
    const label = resolveLocalizedEmotionName(names, 'en', 'peaceful');
    expect(label).not.toBe('peaceful');
  });

  it('resolveEmotionDisplayName is a thin per-locale wrapper over the same resolution logic', () => {
    expect(resolveEmotionDisplayName({ key: 'peaceful', names }, 'ar')).toBe('مطمئن');
    expect(resolveEmotionDisplayName({ key: 'peaceful', names }, 'en')).toBe('At Peace');
  });

  it('matches the exact approved wording for the explicitly renamed emotions (verbatim from backend/src/emotions/emotionCatalog.ts)', () => {
    const catalogSource = readFileSync(resolve(__dirname, '../../backend/src/emotions/emotionCatalog.ts'), 'utf-8');
    const extractNames = (key: string): LocalizedText => {
      const block = catalogSource.match(new RegExp(`key: '${key}',\\s*\\n\\s*names: \\{ en: '([^']+)', ar: '([^']+)', 'ar-EG': '([^']+)' \\}`));
      expect(block, `could not locate names block for "${key}" in emotionCatalog.ts`).not.toBeNull();
      const [, en, ar, arEG] = block!;
      return { en, ar, 'ar-EG': arEG };
    };

    const expected: Record<string, LocalizedText> = {
      peaceful: { en: 'At Peace', ar: 'مطمئن', 'ar-EG': 'مطمّن' },
      want_to_cry: { en: 'I Feel Like Crying', ar: 'أريد أن أبكي', 'ar-EG': 'عايز أعيط' },
      forgiveness_struggle: { en: 'Struggling to Forgive', ar: 'لا أستطيع المسامحة', 'ar-EG': 'مش قادر أسامح' },
      closer_to_allah: { en: 'I Want to Feel Closer to Allah', ar: 'أريد أن أتقرب إلى الله', 'ar-EG': 'عايز أقرب من ربنا' },
    };

    Object.entries(expected).forEach(([key, expectedNames]) => {
      const catalogNames = extractNames(key);
      expect(catalogNames).toEqual(expectedNames);
      (['en', 'ar', 'ar-EG'] as const).forEach((locale) => {
        expect(resolveLocalizedEmotionName(catalogNames, locale, key)).toBe(expectedNames[locale]);
      });
      // The stable key itself must never change even though the display name did.
      expect(key).toBe(key);
    });
  });
});

describe('Emotion cards show only the selected-locale name — descriptions are data-ready but never rendered (source-scan)', () => {
  const EMOTION_CARD_PATH = resolve(__dirname, '../src/components/EmotionCard.tsx');
  const source = readFileSync(EMOTION_CARD_PATH, 'utf-8');

  it('renders resolveEmotionDisplayName for the current locale, and never renders emotion.description or a second (e.g. Arabic) name simultaneously', () => {
    expect(source).toMatch(/resolveEmotionDisplayName\(emotion, locale\)/);
    expect(source).not.toMatch(/emotion\.description/);
    expect(source).not.toMatch(/emotion\.arabicName/);
    expect(source).not.toMatch(/emotion\.descriptions/);
  });
});

describe('Result screen resolves the display label from emotion.names[currentAppLocale] with locale->en->key fallback (source-scan)', () => {
  // The emotion-name resolution logic lives in the shared AyahExperience
  // component (both app/ayah/[emotion].tsx and app/ayah/general.tsx render
  // it) since the general-Quran-flow follow-up extracted it — see
  // AyahExperience.tsx's own doc comment.
  const AYAH_EXPERIENCE_PATH = resolve(__dirname, '../src/components/AyahExperience.tsx');
  const source = readFileSync(AYAH_EXPERIENCE_PATH, 'utf-8');

  it('computes headerTitle via resolveLocalizedEmotionName(source.names, locale, source.emotionKey) in emotion mode, never a single passed English name', () => {
    expect(source).toMatch(/resolveLocalizedEmotionName\(source\.names, locale, source\.emotionKey\)/);
  });

  it('never renders emotion.descriptions on this screen (descriptions are data-ready only, not yet in the UI)', () => {
    expect(source).not.toMatch(/\.descriptions/);
  });
});
