import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_QURAN_FONT_SIZE,
  MAX_COMPACT_QURAN_FONT_SIZE,
  MAX_QURAN_FONT_SIZE,
  MIN_COMPACT_QURAN_FONT_SIZE,
  MIN_QURAN_FONT_SIZE,
  QURAN_FONT_SIZES,
  QURAN_FONT_SIZE_STEP,
  computeCompactQuranFontSize,
  computeLengthAdjustment,
  computeMainQuranFontSize,
  computeQuranLineHeight,
  countArabicWords,
  isValidQuranFontSize,
  parseQuranFontSizePreference,
  stepQuranFontSize,
} from '@/localization/quranFontSizePreference';
import { MESSAGES } from '@/localization/messages';
import { APP_LOCALES } from '@/localization/locales';

const asyncStorageState = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageState.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageState.set(key, value);
    }),
  },
}));

/** Builds a fake ayah of `count` heavily-diacritized words, to prove word counting ignores tashkeel character bulk. */
function fakeAyah(count: number): string {
  const word = 'بِسْمِ'; // heavily diacritized single word
  return Array.from({ length: count }, () => word).join(' ');
}

describe('Quran font-size preference: constants', () => {
  it('defaults the preferred main-screen size to 26', () => {
    expect(DEFAULT_QURAN_FONT_SIZE).toBe(26);
  });

  it('exposes exactly the six allowed preferred main-screen sizes, step 2 apart', () => {
    expect(QURAN_FONT_SIZES).toEqual([22, 24, 26, 28, 30, 32]);
    expect(QURAN_FONT_SIZE_STEP).toBe(2);
  });

  it('main size range is [22, 32] and compact size range is [18, 27]', () => {
    expect(MIN_QURAN_FONT_SIZE).toBe(22);
    expect(MAX_QURAN_FONT_SIZE).toBe(32);
    expect(MIN_COMPACT_QURAN_FONT_SIZE).toBe(18);
    expect(MAX_COMPACT_QURAN_FONT_SIZE).toBe(27);
  });
});

describe('isValidQuranFontSize / parseQuranFontSizePreference: safe validation of an arbitrary stored payload', () => {
  it('accepts every value on the approved ladder', () => {
    QURAN_FONT_SIZES.forEach((size) => {
      expect(isValidQuranFontSize(size)).toBe(true);
      expect(parseQuranFontSizePreference(size)).toBe(size);
    });
  });

  it('falls back to the default for a value off the ladder, without throwing', () => {
    expect(parseQuranFontSizePreference(23)).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(0)).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(-26)).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(1000)).toBe(DEFAULT_QURAN_FONT_SIZE);
  });

  it('falls back to the default for a non-numeric / malformed payload (string, object, null, undefined, array, NaN)', () => {
    expect(parseQuranFontSizePreference('26')).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference({ size: 26 })).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(null)).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(undefined)).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference([26])).toBe(DEFAULT_QURAN_FONT_SIZE);
    expect(parseQuranFontSizePreference(Number.NaN)).toBe(DEFAULT_QURAN_FONT_SIZE);
  });
});

describe('AsyncStorage-backed load/save round trip', () => {
  beforeEach(() => asyncStorageState.clear());

  it('loadQuranFontSizePreference returns the default when nothing has been stored yet', async () => {
    const { loadQuranFontSizePreference } = await import('@/localization/quranFontSizePreference');
    expect(await loadQuranFontSizePreference()).toBe(DEFAULT_QURAN_FONT_SIZE);
  });

  it('saveQuranFontSizePreference persists, and a subsequent load reads exactly what was saved', async () => {
    const { loadQuranFontSizePreference, saveQuranFontSizePreference } = await import('@/localization/quranFontSizePreference');
    await saveQuranFontSizePreference(30);
    expect(await loadQuranFontSizePreference()).toBe(30);
  });

  it('loadQuranFontSizePreference recovers safely (returns the default) from corrupted stored JSON', async () => {
    asyncStorageState.set('quran-heals:quran-font-size-preference:v1', '{not valid json');
    const { loadQuranFontSizePreference } = await import('@/localization/quranFontSizePreference');
    expect(await loadQuranFontSizePreference()).toBe(DEFAULT_QURAN_FONT_SIZE);
  });

  it('loadQuranFontSizePreference recovers safely (returns the default) from a validly-parsed but out-of-range stored number', async () => {
    asyncStorageState.set('quran-heals:quran-font-size-preference:v1', JSON.stringify(19));
    const { loadQuranFontSizePreference } = await import('@/localization/quranFontSizePreference');
    expect(await loadQuranFontSizePreference()).toBe(DEFAULT_QURAN_FONT_SIZE);
  });

  it('uses a versioned/namespaced storage key distinct from the translation-preference and app-locale keys', async () => {
    const { saveQuranFontSizePreference } = await import('@/localization/quranFontSizePreference');
    await saveQuranFontSizePreference(28);
    expect(asyncStorageState.has('quran-heals:quran-font-size-preference:v1')).toBe(true);
    expect(asyncStorageState.has('quran-heals:quran-translation-preference:v1')).toBe(false);
    expect(asyncStorageState.has('quran-heals:app-locale:v1')).toBe(false);
  });
});

describe('stepQuranFontSize: A-/A+ stepping with clamping at both ends', () => {
  it('A+ increases by the step size', () => {
    expect(stepQuranFontSize(26, 1)).toBe(28);
  });

  it('A- decreases by the step size', () => {
    expect(stepQuranFontSize(26, -1)).toBe(24);
  });

  it('A+ never exceeds the maximum', () => {
    expect(stepQuranFontSize(32, 1)).toBe(32);
    expect(stepQuranFontSize(30, 1)).toBe(32);
  });

  it('A- never goes below the minimum', () => {
    expect(stepQuranFontSize(22, -1)).toBe(22);
    expect(stepQuranFontSize(24, -1)).toBe(22);
  });

  it('reset via Auto returns to the default regardless of the current step position', () => {
    // Auto itself is a plain re-assignment to DEFAULT_QURAN_FONT_SIZE in the
    // provider (see useQuranFontSizePreference.tsx) rather than a step — this
    // proves the destination value is on the ladder and matches the default.
    expect(DEFAULT_QURAN_FONT_SIZE).toBe(26);
    expect(isValidQuranFontSize(DEFAULT_QURAN_FONT_SIZE)).toBe(true);
  });
});

describe('computeLengthAdjustment: every automatic word-count threshold', () => {
  it('0-40 words: no reduction', () => {
    expect(computeLengthAdjustment(0)).toBe(0);
    expect(computeLengthAdjustment(1)).toBe(0);
    expect(computeLengthAdjustment(40)).toBe(0);
  });

  it('41-80 words: -2', () => {
    expect(computeLengthAdjustment(41)).toBe(-2);
    expect(computeLengthAdjustment(60)).toBe(-2);
    expect(computeLengthAdjustment(80)).toBe(-2);
  });

  it('more than 80 words: -4', () => {
    expect(computeLengthAdjustment(81)).toBe(-4);
    expect(computeLengthAdjustment(200)).toBe(-4);
  });
});

describe('computeMainQuranFontSize: preferred size + length adjustment, clamped to [22, 32]', () => {
  it('preferred 26, 30-word ayah -> 26 (no adjustment)', () => {
    expect(computeMainQuranFontSize(26, 30)).toBe(26);
  });

  it('preferred 26, 60-word ayah -> 24', () => {
    expect(computeMainQuranFontSize(26, 60)).toBe(24);
  });

  it('preferred 26, 90-word ayah -> 22', () => {
    expect(computeMainQuranFontSize(26, 90)).toBe(22);
  });

  it('preferred 32, 30-word ayah -> 32', () => {
    expect(computeMainQuranFontSize(32, 30)).toBe(32);
  });

  it('preferred 22, very long ayah -> never below 22', () => {
    expect(computeMainQuranFontSize(22, 500)).toBe(22);
  });

  it('preferred 32, very long ayah -> 28 (32 - 4, well within the floor)', () => {
    expect(computeMainQuranFontSize(32, 500)).toBe(28);
  });

  it('preferred 22, 41-word ayah -> clamped at the floor (22 - 2 = 20, floored back up to 22)', () => {
    expect(computeMainQuranFontSize(22, 41)).toBe(22);
  });
});

describe('computeCompactQuranFontSize: derived compact-preferred size (-5, clamped [18,27]) + length adjustment, clamped to [18, 27]', () => {
  it('preferred 26, 30-word ayah -> 21 (no adjustment)', () => {
    expect(computeCompactQuranFontSize(26, 30)).toBe(21);
  });

  it('preferred 26, 60-word ayah -> 19', () => {
    expect(computeCompactQuranFontSize(26, 60)).toBe(19);
  });

  it('preferred 26, 90-word ayah -> 18 (17 clamped up to the floor)', () => {
    expect(computeCompactQuranFontSize(26, 90)).toBe(18);
  });

  it('preferred 32, 30-word ayah -> 27 (compact-preferred clamped at the ceiling before adjustment)', () => {
    expect(computeCompactQuranFontSize(32, 30)).toBe(27);
  });

  it('preferred 22, very long ayah -> never below 18', () => {
    expect(computeCompactQuranFontSize(22, 500)).toBe(18);
  });

  it('preferred 22, 30-word ayah -> compact-preferred clamped at the floor (18), not negative', () => {
    expect(computeCompactQuranFontSize(22, 30)).toBe(18);
  });
});

describe('computeQuranLineHeight: Quran-safe ratio (never a tight/clipping ratio)', () => {
  it('rounds fontSize * 1.62', () => {
    expect(computeQuranLineHeight(26)).toBe(Math.round(26 * 1.62));
    expect(computeQuranLineHeight(22)).toBe(Math.round(22 * 1.62));
    expect(computeQuranLineHeight(32)).toBe(Math.round(32 * 1.62));
    expect(computeQuranLineHeight(18)).toBe(Math.round(18 * 1.62));
    expect(computeQuranLineHeight(27)).toBe(Math.round(27 * 1.62));
  });

  it('matches the exact required examples', () => {
    expect(computeQuranLineHeight(26)).toBe(42);
    expect(computeQuranLineHeight(24)).toBe(39);
    expect(computeQuranLineHeight(22)).toBe(36);
    expect(computeQuranLineHeight(21)).toBe(34);
    expect(computeQuranLineHeight(19)).toBe(31);
    expect(computeQuranLineHeight(18)).toBe(29);
  });

  it('the line-height-to-font-size ratio always exceeds 1.5, leaving headroom for tashkeel above/below each letter', () => {
    [18, 21, 22, 24, 26, 27, 28, 30, 32].forEach((fontSize) => {
      expect(computeQuranLineHeight(fontSize) / fontSize).toBeGreaterThan(1.5);
    });
  });
});

describe('countArabicWords: trimmed whitespace splitting, not raw character count', () => {
  it('counts a short ayah correctly', () => {
    expect(countArabicWords('بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ')).toBe(4);
  });

  it('ignores leading/trailing whitespace', () => {
    expect(countArabicWords('   بِسْمِ اللَّهِ   ')).toBe(2);
  });

  it('collapses multiple internal spaces into a single word boundary', () => {
    expect(countArabicWords('بِسْمِ    اللَّهِ')).toBe(2);
  });

  it('returns 0 for an empty or whitespace-only string', () => {
    expect(countArabicWords('')).toBe(0);
    expect(countArabicWords('   ')).toBe(0);
  });

  it('a single heavily-diacritized (tashkeel-laden) word with many more characters than an undiacritized word still counts as exactly one word', () => {
    const undiacritized = 'بسم';
    const heavilyDiacritized = 'بِسْمِ'; // same letters, full tashkeel added
    expect(heavilyDiacritized.length).toBeGreaterThan(undiacritized.length);
    expect(countArabicWords(undiacritized)).toBe(1);
    expect(countArabicWords(heavilyDiacritized)).toBe(1);
  });

  it('word count scales with whitespace-separated tokens, not character length, for long diacritic-heavy ayahs', () => {
    const thirtyWords = fakeAyah(30);
    const ninetyWords = fakeAyah(90);
    // Same word, so per-word character length is identical; only the token count differs.
    expect(countArabicWords(thirtyWords)).toBe(30);
    expect(countArabicWords(ninetyWords)).toBe(90);
  });

  it('hits every automatic threshold boundary exactly at the word-count boundary, regardless of diacritic character bulk', () => {
    expect(countArabicWords(fakeAyah(40))).toBe(40);
    expect(countArabicWords(fakeAyah(41))).toBe(41);
    expect(countArabicWords(fakeAyah(80))).toBe(80);
    expect(countArabicWords(fakeAyah(81))).toBe(81);
    expect(computeLengthAdjustment(countArabicWords(fakeAyah(40)))).toBe(0);
    expect(computeLengthAdjustment(countArabicWords(fakeAyah(41)))).toBe(-2);
    expect(computeLengthAdjustment(countArabicWords(fakeAyah(80)))).toBe(-2);
    expect(computeLengthAdjustment(countArabicWords(fakeAyah(81)))).toBe(-4);
  });
});

describe('useQuranFontSizePreference.tsx (source-scan: no RN renderer available in this test environment)', () => {
  const PROVIDER_PATH = resolve(__dirname, '../src/localization/useQuranFontSizePreference.tsx');
  const source = readFileSync(PROVIDER_PATH, 'utf-8');

  it('persists via loadQuranFontSizePreference/saveQuranFontSizePreference, matching the existing AsyncStorage-preference pattern', () => {
    expect(source).toMatch(/loadQuranFontSizePreference\(\)/);
    expect(source).toMatch(/saveQuranFontSizePreference\(next\)/);
  });

  it('defaults preferredSize state to DEFAULT_QURAN_FONT_SIZE', () => {
    expect(source).toMatch(/useState<number>\(DEFAULT_QURAN_FONT_SIZE\)/);
  });

  it('increase/decrease both persist via stepQuranFontSize (never an unclamped arbitrary increment)', () => {
    expect(source).toMatch(/stepQuranFontSize\(current,\s*1\)/);
    expect(source).toMatch(/stepQuranFontSize\(current,\s*-1\)/);
  });

  it('reset (Auto) sets preferredSize back to DEFAULT_QURAN_FONT_SIZE and persists it', () => {
    expect(source).toMatch(/setPreferredSize\(DEFAULT_QURAN_FONT_SIZE\)/);
    expect(source).toMatch(/saveQuranFontSizePreference\(DEFAULT_QURAN_FONT_SIZE\)/);
  });

  it('exposes canIncrease/canDecrease so controls can disable at the limits', () => {
    expect(source).toMatch(/canIncrease:\s*preferredSize\s*<\s*MAX_QURAN_FONT_SIZE/);
    expect(source).toMatch(/canDecrease:\s*preferredSize\s*>\s*MIN_QURAN_FONT_SIZE/);
  });

  it('throws a clear error when used outside its provider, matching the project`s existing context-hook pattern', () => {
    expect(source).toMatch(/must be used within a QuranFontSizePreferenceProvider/);
  });
});

describe('QuranFontSizeControls.tsx (source-scan): accessibility, disabled limits, RTL, and localized Auto label', () => {
  const CONTROLS_PATH = resolve(__dirname, '../src/components/QuranFontSizeControls.tsx');
  const source = readFileSync(CONTROLS_PATH, 'utf-8');

  it('gives each of A-, Auto, and A+ a distinct, localized accessibility label (never a hardcoded English string)', () => {
    expect(source).toMatch(/accessibilityLabel=\{messages\.quranFontSize\.decreaseLabel\}/);
    expect(source).toMatch(/accessibilityLabel=\{messages\.quranFontSize\.increaseLabel\}/);
    expect(source).toMatch(/accessibilityLabel=\{messages\.quranFontSize\.autoLabel\}/);
  });

  it('renders the Auto button`s visible label from the localized dictionary, never a hardcoded "Auto"', () => {
    expect(source).toMatch(/\{messages\.quranFontSize\.auto\}/);
    expect(source).not.toMatch(/>\s*Auto\s*</);
  });

  it('disables (and visually indicates) A- when canDecrease is false, and A+ when canIncrease is false', () => {
    expect(source).toMatch(/disabled=\{!canDecrease\}/);
    expect(source).toMatch(/disabled=\{!canIncrease\}/);
    expect(source).toMatch(/accessibilityState=\{\{\s*disabled:\s*!canDecrease\s*\}\}/);
    expect(source).toMatch(/accessibilityState=\{\{\s*disabled:\s*!canIncrease\s*\}\}/);
    expect(source).toMatch(/!canDecrease\s*&&\s*styles\.segmentDisabled/);
    expect(source).toMatch(/!canIncrease\s*&&\s*styles\.segmentDisabled/);
  });

  it('Auto resets rather than steps (calls reset, not increase/decrease)', () => {
    expect(source).toMatch(/onPress=\{reset\}/);
  });

  it('mirrors row direction for RTL locales, matching the project`s existing RTL-row pattern', () => {
    expect(source).toMatch(/isRtl\s*&&\s*styles\.groupRtl/);
    expect(source).toMatch(/groupRtl:\s*\{\s*flexDirection:\s*'row-reverse'/);
  });

  it('keeps the group centered and content-width, never stretched full-width across the card', () => {
    expect(source).toMatch(/alignSelf:\s*'center'/);
  });

  it('gives each segment a hitSlop so the effective touch target reaches at least 44x44 despite the compact ~38px visual height', () => {
    expect(source).toMatch(/hitSlop=\{HIT_SLOP\}/);
  });
});

describe('AyahCard.tsx integration (source-scan): each ayah computes its own size, Favorites gets no second control set', () => {
  const AYAH_CARD_PATH = resolve(__dirname, '../src/components/AyahCard.tsx');
  const source = readFileSync(AYAH_CARD_PATH, 'utf-8');

  it('derives word count per-ayah from the ayah`s own Arabic text, not a shared/cached value', () => {
    expect(source).toMatch(/countArabicWords\(ayah\.arabicText\)/);
  });

  it('uses the compact calculation for compact cards and the main calculation otherwise', () => {
    expect(source).toMatch(/compact\s*\?\s*computeCompactQuranFontSize\(preferredSize,\s*wordCount\)\s*:\s*computeMainQuranFontSize\(preferredSize,\s*wordCount\)/);
  });

  it('derives line height from the final computed font size via computeQuranLineHeight', () => {
    expect(source).toMatch(/computeQuranLineHeight\(arabicFontSize\)/);
  });

  it('renders the A-/Auto/A+ controls only for the non-compact (main-screen) card, never for compact/Favorites cards', () => {
    expect(source).toMatch(/\{!compact\s*&&\s*<QuranFontSizeControls\s*\/>\}/);
  });

  it('reads the shared preference via the context hook rather than touching AsyncStorage directly in this component', () => {
    expect(source).toMatch(/useQuranFontSizePreference\(\)/);
    expect(source).not.toMatch(/AsyncStorage/);
  });
});

describe('Quran font-size preference is never synced to MongoDB/an account', () => {
  it('preferencesSync.ts (the only module that syncs local preferences to the account) never references the Quran font-size preference', () => {
    const source = readFileSync(resolve(__dirname, '../src/sync/preferencesSync.ts'), 'utf-8');
    expect(source).not.toMatch(/fontSize|FontSize|quran-font-size/i);
  });

  it('syncOrchestrator.ts never references the Quran font-size preference', () => {
    const source = readFileSync(resolve(__dirname, '../src/sync/syncOrchestrator.ts'), 'utf-8');
    expect(source).not.toMatch(/fontSize|FontSize|quran-font-size/i);
  });

  it('quranFontSizePreference.ts never imports the sync layer', () => {
    const source = readFileSync(resolve(__dirname, '../src/localization/quranFontSizePreference.ts'), 'utf-8');
    expect(source).not.toMatch(/from ['"]@\/sync/);
  });
});

describe('_layout.tsx wires the Quran font-size provider app-wide', () => {
  it('wraps the app in QuranFontSizePreferenceProvider', () => {
    const source = readFileSync(resolve(__dirname, '../src/app/_layout.tsx'), 'utf-8');
    expect(source).toMatch(/<QuranFontSizePreferenceProvider>/);
    expect(source).toMatch(/<\/QuranFontSizePreferenceProvider>/);
  });
});

describe('"Auto" label and accessibility copy are localized correctly in every app locale', () => {
  APP_LOCALES.forEach((locale) => {
    it(`${locale}: decreaseLabel, increaseLabel, auto, and autoLabel are all non-empty`, () => {
      const { decreaseLabel, increaseLabel, auto, autoLabel } = MESSAGES[locale].quranFontSize;
      expect(decreaseLabel.trim().length).toBeGreaterThan(0);
      expect(increaseLabel.trim().length).toBeGreaterThan(0);
      expect(auto.trim().length).toBeGreaterThan(0);
      expect(autoLabel.trim().length).toBeGreaterThan(0);
    });
  });

  it('en: Auto', () => {
    expect(MESSAGES.en.quranFontSize.auto).toBe('Auto');
  });

  it('ar (Standard Arabic): تلقائي', () => {
    expect(MESSAGES.ar.quranFontSize.auto).toBe('تلقائي');
  });

  it('ar-EG (Egyptian Arabic): تلقائي', () => {
    expect(MESSAGES['ar-EG'].quranFontSize.auto).toBe('تلقائي');
  });

  it('every locale defines the exact same quranFontSize keys (no locale missing a string the others have)', () => {
    const keySet = (locale: (typeof APP_LOCALES)[number]) => Object.keys(MESSAGES[locale].quranFontSize).sort();
    expect(keySet('ar')).toEqual(keySet('en'));
    expect(keySet('ar-EG')).toEqual(keySet('en'));
  });
});
