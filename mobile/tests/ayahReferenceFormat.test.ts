import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { getAllSurahNames, getSurahName } from '@/services/surahNames';
import { formatAyahReference } from '@/utils/ayahReference';

const MIDDLE_DOT = '·';

describe('surahNames: the local, verified 114-surah mapping', () => {
  it('has exactly 114 entries, ordered by surahNumber ascending starting at 1', () => {
    const all = getAllSurahNames();
    expect(all).toHaveLength(114);
    all.forEach((surah, index) => {
      expect(surah.surahNumber).toBe(index + 1);
    });
  });

  it('every entry has a non-empty English name and a non-empty Arabic name', () => {
    for (const surah of getAllSurahNames()) {
      expect(surah.nameEnglish.trim().length).toBeGreaterThan(0);
      expect(surah.nameArabic.trim().length).toBeGreaterThan(0);
    }
  });

  it('getSurahName resolves the exact verified name for representative surahs 1, 2, and 114', () => {
    expect(getSurahName(1)).toEqual({ surahNumber: 1, nameEnglish: 'Al-Faatiha', nameArabic: 'الفاتحة' });
    expect(getSurahName(2)).toEqual({ surahNumber: 2, nameEnglish: 'Al-Baqara', nameArabic: 'البقرة' });
    expect(getSurahName(114)).toEqual({ surahNumber: 114, nameEnglish: 'An-Naas', nameArabic: 'الناس' });
  });

  it('throws for an out-of-range surah number rather than returning a fabricated/blank name', () => {
    expect(() => getSurahName(0)).toThrow();
    expect(() => getSurahName(115)).toThrow();
    expect(() => getSurahName(-1)).toThrow();
  });
});

describe('formatAyahReference: English Surah name · Surah:Ayah · Arabic Surah name', () => {
  it('surah 1 (Al-Fatihah): correct English name, number in the middle, correct Arabic name', () => {
    const result = formatAyahReference(1, 1);
    expect(result).toBe(`Al-Faatiha ${MIDDLE_DOT} 1:1 ${MIDDLE_DOT} الفاتحة`);
  });

  it('surah 2 (Al-Baqarah), ayah 286: correct English name, number in the middle, correct Arabic name', () => {
    const result = formatAyahReference(2, 286);
    expect(result).toBe(`Al-Baqara ${MIDDLE_DOT} 2:286 ${MIDDLE_DOT} البقرة`);
  });

  it('surah 114 (An-Nas): correct English name, number in the middle, correct Arabic name', () => {
    const result = formatAyahReference(114, 6);
    expect(result).toBe(`An-Naas ${MIDDLE_DOT} 114:6 ${MIDDLE_DOT} الناس`);
  });

  it('the Surah:Ayah number always uses plain Western/Latin digits, never Arabic-Indic digits', () => {
    const result = formatAyahReference(2, 286);
    expect(result).toMatch(/2:286/);
    // Arabic-Indic digit block (U+0660–U+0669) must never appear anywhere
    // in the formatted reference.
    expect(result).not.toMatch(/[٠-٩]/);
  });

  it('the order is always English name, then number, then Arabic name — the number is physically in the middle', () => {
    const result = formatAyahReference(3, 8);
    const englishIndex = result.indexOf('Aal-i-Imraan');
    const numberIndex = result.indexOf('3:8');
    const arabicIndex = result.indexOf('آل عمران');

    expect(englishIndex).toBeGreaterThanOrEqual(0);
    expect(numberIndex).toBeGreaterThan(englishIndex);
    expect(arabicIndex).toBeGreaterThan(numberIndex);
  });

  it('the formatter is locale-independent — it never accepts or branches on the app locale, so the order is identical in English, Arabic, and Egyptian Arabic', () => {
    // formatAyahReference's signature is (surahNumber, ayahNumber) only —
    // there's structurally nowhere to pass a locale, so the exact same
    // string is produced regardless of which app language is active.
    expect(formatAyahReference.length).toBe(2);
    for (const locale of APP_LOCALES) {
      void locale; // no locale parameter exists to vary the result by
      expect(formatAyahReference(2, 286)).toBe(`Al-Baqara ${MIDDLE_DOT} 2:286 ${MIDDLE_DOT} البقرة`);
    }
  });
});

describe('AyahCard: renders the shared formatter with an explicit LTR order, immune to RTL layout reversal', () => {
  const ayahCardSource = readFileSync(resolve(__dirname, '../src/components/AyahCard.tsx'), 'utf-8');

  it('uses the shared formatAyahReference helper — never a duplicated/ad hoc reference string', () => {
    expect(ayahCardSource).toMatch(/from '@\/utils\/ayahReference'/);
    expect(ayahCardSource).toMatch(/\{formatAyahReference\(ayah\.surahNumber, ayah\.ayahNumber\)\}/);
    // The old two-part ("English • number", no Arabic name) format must be
    // gone entirely, not merely supplemented.
    expect(ayahCardSource).not.toMatch(/ayah\.surahNameEnglish\}.*•/);
  });

  it('forces writingDirection: "ltr" on the reference Text style, so an RTL app locale can never reorder English/number/Arabic', () => {
    const referenceStyleBlock = ayahCardSource.match(/reference: \{[\s\S]*?\},/)?.[0] ?? '';
    expect(referenceStyleBlock.length).toBeGreaterThan(0);
    expect(referenceStyleBlock).toMatch(/writingDirection:\s*'ltr'/);
  });

  it('the reference row is never marked RTL via getDirectionStyle/isRtl — no per-locale direction prop is applied to the reference Text at all', () => {
    // The reference Text is deliberately NOT `[styles.reference, direction]`
    // (unlike other locale-sensitive Text elements in this app) — locale
    // direction must never influence this specific line's layout order.
    expect(ayahCardSource).not.toMatch(/style=\{\[styles\.reference,/);
  });
});

describe('Every other place an ayah reference is built also uses the shared formatter (no duplicated formatting logic)', () => {
  const ayahExperienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');
  const favoritesSource = readFileSync(resolve(__dirname, '../src/app/favorites.tsx'), 'utf-8');

  it('AyahExperience\'s share text uses formatAyahReference (covers emotion mode, general mode, and "Another ayah" results — all render through this one component)', () => {
    expect(ayahExperienceSource).toMatch(/from '@\/utils\/ayahReference'/);
    expect(ayahExperienceSource).toMatch(/formatAyahReference\(ayah\.surahNumber, ayah\.ayahNumber\)/);
    expect(ayahExperienceSource).not.toMatch(/\$\{ayah\.surahNameEnglish\} \$\{ayah\.surahNumber\}/);
  });

  it('Favorites\' share text uses formatAyahReference too', () => {
    expect(favoritesSource).toMatch(/from '@\/utils\/ayahReference'/);
    expect(favoritesSource).toMatch(/formatAyahReference\(favorite\.surahNumber, favorite\.ayahNumber\)/);
    expect(favoritesSource).not.toMatch(/\$\{favorite\.surahNameEnglish\} \$\{favorite\.surahNumber\}/);
  });
});
