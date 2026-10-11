/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';

// constants/theme.ts reads Platform at module scope; the real package can't load under Node.
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios } }));

import { SHARE_CARD_THEMES, SHARE_CARD_THEMES_ORDER, DEFAULT_SHARE_CARD_THEME } from '@/constants/shareCardThemes';
import {
  arabicUnits,
  DEFAULT_SHARE_CARD_FORMAT,
  estimateScaleForLevel,
  MIN_ARABIC_FONT_SIZE,
  MIN_TRANSLATION_FONT_SIZE,
  planShareCards,
  SHARE_CARD_FORMAT_SPECS,
  SHARE_CARD_FORMATS,
  translationAttribution,
  type ShareCardPage,
} from '@/utils/shareCardLayout';

/** Share-card layout planning against the real bundled Quran text (assets/quran/quran.sqlite). */

const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
afterAll(() => db.close());
const verses = db.prepare('SELECT verse_key AS verseKey, arabic_text AS arabicText FROM verses ORDER BY surah, ayah').all() as { verseKey: string; arabicText: string }[];
const verse = (key: string) => verses.find((row) => row.verseKey === key)!.arabicText;

const PAUSE_MARK_START = /^[ۖ-ۜ۞۩]/;
const SENTENCE = 'O ye who believe! When ye contract a debt for a fixed term, record it in writing. ';
const LONG_TRANSLATION = SENTENCE.repeat(18).trim(); // ~1,500 characters, longer than any Pickthall ayah

const arabicOf = (pages: ShareCardPage[]) => pages.filter((page) => page.arabic !== null).map((page) => page.arabic).join(' ');
const translationOf = (pages: ShareCardPage[]) => pages.filter((page) => page.translation !== null).map((page) => page.translation).join(' ');

describe('formats', () => {
  it('exports at 1080 × 1920 (Story 9:16), 1080 × 1350 (Post 4:5) and 1080 × 1080 (Square 1:1), Story by default', () => {
    expect(SHARE_CARD_FORMATS).toEqual(['story', 'post', 'square']);
    expect(DEFAULT_SHARE_CARD_FORMAT).toBe('story');
    const sizes = SHARE_CARD_FORMATS.map((format) => [SHARE_CARD_FORMAT_SPECS[format].width, SHARE_CARD_FORMAT_SPECS[format].height]);
    expect(sizes).toEqual([[1080, 1920], [1080, 1350], [1080, 1080]]);
    expect(1920 / 1080).toBeCloseTo(16 / 9);
    expect(1350 / 1080).toBeCloseTo(5 / 4);
    expect(SHARE_CARD_FORMATS.map((format) => SHARE_CARD_FORMAT_SPECS[format].ratioLabel)).toEqual(['9:16', '4:5', '1:1']);
  });
});

describe('Quran text is preserved exactly on every card', () => {
  it.each(SHARE_CARD_FORMATS)('%s: all 6,236 ayahs rejoin to the exact original text, in order, with no card starting on a pause mark', (format) => {
    expect(verses).toHaveLength(6236);
    for (const { verseKey, arabicText } of verses) {
      for (const translation of [null, LONG_TRANSLATION]) {
        const pages = planShareCards({ arabicText, translation, format });
        expect(arabicOf(pages), verseKey).toBe(arabicText);
        if (translation) expect(translationOf(pages), verseKey).toBe(translation);
        for (const page of pages) {
          if (page.arabic !== null) {
            expect(PAUSE_MARK_START.test(page.arabic), `${verseKey} ${page.key}`).toBe(false);
            expect(page.arabicFontSize).toBeGreaterThanOrEqual(MIN_ARABIC_FONT_SIZE);
          }
          if (page.translation !== null) expect(page.translationFontSize).toBeGreaterThanOrEqual(MIN_TRANSLATION_FONT_SIZE);
        }
      }
    }
  });

  it('keeps each standalone pause mark with the word before it', () => {
    // 2:2 — "ذَٰلِكَ ٱلْكِتَـٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ"
    const units = arabicUnits(verse('2:2'));
    const words = units.map((unit) => verse('2:2').slice(unit.start, unit.end));
    expect(words.some((word) => PAUSE_MARK_START.test(word))).toBe(false);
    expect(words.filter((word) => word.endsWith('ۛ'))).toHaveLength(2);
  });
});

describe('short and long ayahs', () => {
  it('a short ayah is one card with the Arabic, translation and reference together, at the largest size', () => {
    for (const format of SHARE_CARD_FORMATS) {
      const pages = planShareCards({ arabicText: verse('1:1'), translation: 'In the name of Allah, the Beneficent, the Merciful.', format });
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({ pageNumber: 1, pageCount: 1, arabic: verse('1:1'), translation: 'In the name of Allah, the Beneficent, the Merciful.' });
      expect(pages[0].arabicFontSize).toBe(SHARE_CARD_FORMAT_SPECS[format].maxArabicFontSize);
    }
  });

  it('the longest ayah (2:282) continues across numbered cards: Arabic first, then its translation', () => {
    for (const format of SHARE_CARD_FORMATS) {
      const pages = planShareCards({ arabicText: verse('2:282'), translation: LONG_TRANSLATION, format });
      expect(pages.length).toBeGreaterThan(2);
      expect(pages.map((page) => page.pageNumber)).toEqual(pages.map((_, index) => index + 1));
      expect(pages.every((page) => page.pageCount === pages.length)).toBe(true);
      const firstTranslation = pages.findIndex((page) => page.translation !== null);
      expect(pages.slice(0, firstTranslation).every((page) => page.arabic !== null && page.translation === null)).toBe(true);
      expect(pages.slice(firstTranslation).every((page) => page.arabic === null && page.translation !== null)).toBe(true);
      // One consistent Arabic size across that ayah's cards.
      expect(new Set(pages.filter((page) => page.arabic).map((page) => page.arabicFontSize)).size).toBe(1);
    }
  });

  it('hiding the translation leaves only Arabic cards', () => {
    const pages = planShareCards({ arabicText: verse('2:255'), translation: null, format: 'story' });
    expect(pages.every((page) => page.translation === null)).toBe(true);
    expect(planShareCards({ arabicText: verse('2:255'), translation: '   ', format: 'story' }).every((page) => page.translation === null)).toBe(true);
  });

  it('a larger estimate (after a card measured too tall) never gives bigger text or fewer cards', () => {
    for (const key of ['2:255', '2:282', '24:31', '112:1']) {
      for (const format of SHARE_CARD_FORMATS) {
        let previous: ShareCardPage[] | null = null;
        for (let level = 0; level <= 6; level += 1) {
          const pages = planShareCards({ arabicText: verse(key), translation: LONG_TRANSLATION, format, estimateScale: estimateScaleForLevel(level) });
          expect(arabicOf(pages)).toBe(verse(key));
          if (previous) {
            const arabicSize = (list: ShareCardPage[]) => list.find((page) => page.arabic)!.arabicFontSize;
            expect(pages.length >= previous.length || arabicSize(pages) <= arabicSize(previous), `${key} ${format} level ${level}`).toBe(true);
          }
          previous = pages;
        }
      }
    }
  });
});

describe('themes', () => {
  // WCAG 2.x relative luminance / contrast ratio.
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  it('offers Sage, Cream and Dark, Sage by default', () => {
    expect(SHARE_CARD_THEMES_ORDER).toEqual(['sage', 'cream', 'dark']);
    expect(DEFAULT_SHARE_CARD_THEME).toBe('sage');
  });

  it.each(SHARE_CARD_THEMES_ORDER)('%s: Quran and translation text reach AAA (7:1); reference and branding reach AA (4.5:1)', (name) => {
    const theme = SHARE_CARD_THEMES[name];
    expect(contrast(theme.arabic, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.translation, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.reference, theme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.branding, theme.background)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('translation credit', () => {
  it("takes the translator's name from the ayah's own translationSource", () => {
    expect(translationAttribution('Marmaduke Pickthall — The Meaning of the Glorious Koran — Project Gutenberg eBook #16955')).toBe('Marmaduke Pickthall');
    expect(translationAttribution('Existing translation source')).toBe('Existing translation source');
    expect(translationAttribution('')).toBeNull();
    expect(translationAttribution(undefined)).toBeNull();
  });
});
