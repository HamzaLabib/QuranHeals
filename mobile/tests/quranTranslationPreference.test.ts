import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_QURAN_TRANSLATION_PREFERENCE,
  PICKTHALL_TRANSLATION_ID,
  parseQuranTranslationPreference,
  resolveTranslationVisibility,
} from '@/localization/quranTranslationPreference';
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

describe('Quran translation preference shape and defaults', () => {
  it('identifies the only currently-verified translation this app bundles', () => {
    expect(PICKTHALL_TRANSLATION_ID).toBe('en.pickthall.gutenberg16955');
  });

  it('defaults to displayMode "always", preserving the app`s pre-existing behavior of auto-showing the English translation', () => {
    expect(DEFAULT_QURAN_TRANSLATION_PREFERENCE).toEqual({
      translationId: 'en.pickthall.gutenberg16955',
      displayMode: 'always',
    });
  });
});

describe('parseQuranTranslationPreference: safe validation/migration of an arbitrary stored payload', () => {
  it('passes through a fully valid preference unchanged', () => {
    expect(parseQuranTranslationPreference({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'on-demand' })).toEqual({
      translationId: 'en.pickthall.gutenberg16955',
      displayMode: 'on-demand',
    });
  });

  it('accepts each of the three valid display modes', () => {
    (['always', 'on-demand', 'off'] as const).forEach((mode) => {
      expect(parseQuranTranslationPreference({ translationId: 'x', displayMode: mode }).displayMode).toBe(mode);
    });
  });

  it('falls back to the default display mode when the stored mode is invalid/unrecognized, without throwing', () => {
    expect(parseQuranTranslationPreference({ translationId: 'x', displayMode: 'sometimes' }).displayMode).toBe('always');
    expect(parseQuranTranslationPreference({ translationId: 'x', displayMode: 42 }).displayMode).toBe('always');
    expect(parseQuranTranslationPreference({ translationId: 'x' }).displayMode).toBe('always');
  });

  it('falls back to the default translationId when missing/blank, but keeps a valid displayMode', () => {
    expect(parseQuranTranslationPreference({ displayMode: 'off' })).toEqual({
      translationId: 'en.pickthall.gutenberg16955',
      displayMode: 'off',
    });
    expect(parseQuranTranslationPreference({ translationId: '   ', displayMode: 'off' }).translationId).toBe(
      'en.pickthall.gutenberg16955',
    );
  });

  it('falls back entirely to the default preference for a non-object / malformed payload (old schema, null, array, primitive)', () => {
    expect(parseQuranTranslationPreference(null)).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
    expect(parseQuranTranslationPreference(undefined)).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
    expect(parseQuranTranslationPreference('always')).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
    expect(parseQuranTranslationPreference(true)).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
    // An old/legacy shape (e.g. a bare boolean "show translation" flag) never crashes the parser.
    expect(parseQuranTranslationPreference({ showTranslation: true })).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
  });
});

describe('AsyncStorage-backed load/save round trip', () => {
  beforeEach(() => asyncStorageState.clear());

  it('loadQuranTranslationPreference returns the default when nothing has been stored yet', async () => {
    const { loadQuranTranslationPreference } = await import('@/localization/quranTranslationPreference');
    expect(await loadQuranTranslationPreference()).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
  });

  it('saveQuranTranslationPreference persists, and a subsequent load reads exactly what was saved', async () => {
    const { loadQuranTranslationPreference, saveQuranTranslationPreference } = await import('@/localization/quranTranslationPreference');
    await saveQuranTranslationPreference({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'off' });
    expect(await loadQuranTranslationPreference()).toEqual({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'off' });
  });

  it('loadQuranTranslationPreference recovers safely (returns the default) from corrupted stored JSON', async () => {
    asyncStorageState.set('quran-heals:quran-translation-preference:v1', '{not valid json');
    const { loadQuranTranslationPreference } = await import('@/localization/quranTranslationPreference');
    expect(await loadQuranTranslationPreference()).toEqual(DEFAULT_QURAN_TRANSLATION_PREFERENCE);
  });

  it('uses a versioned/namespaced storage key distinct from the app-locale key', async () => {
    const { saveQuranTranslationPreference } = await import('@/localization/quranTranslationPreference');
    await saveQuranTranslationPreference({ translationId: 'en.pickthall.gutenberg16955', displayMode: 'on-demand' });
    expect(asyncStorageState.has('quran-heals:quran-translation-preference:v1')).toBe(true);
    expect(asyncStorageState.has('quran-heals:app-locale:v1')).toBe(false);
  });
});

describe('resolveTranslationVisibility: pure show/hide-toggle decision logic (behavior-level, no source-scan needed)', () => {
  it('on-demand, not yet revealed: translation hidden, toggle control shown ("Show translation" state)', () => {
    expect(resolveTranslationVisibility('on-demand', false)).toEqual({
      showTranslation: false,
      showToggleControl: true,
    });
  });

  it('on-demand, revealed: translation visible, toggle control still shown ("Hide translation" state)', () => {
    expect(resolveTranslationVisibility('on-demand', true)).toEqual({
      showTranslation: true,
      showToggleControl: true,
    });
  });

  it('on-demand round-trips: reveal then hide again returns to exactly the initial state', () => {
    const initial = resolveTranslationVisibility('on-demand', false);
    const revealed = resolveTranslationVisibility('on-demand', true);
    const hiddenAgain = resolveTranslationVisibility('on-demand', false);
    expect(hiddenAgain).toEqual(initial);
    expect(revealed).not.toEqual(initial);
  });

  it('always mode: translation always visible and no toggle control, regardless of local reveal state', () => {
    expect(resolveTranslationVisibility('always', false)).toEqual({ showTranslation: true, showToggleControl: false });
    expect(resolveTranslationVisibility('always', true)).toEqual({ showTranslation: true, showToggleControl: false });
  });

  it('off mode: translation never visible and no toggle control, regardless of local reveal state', () => {
    expect(resolveTranslationVisibility('off', false)).toEqual({ showTranslation: false, showToggleControl: false });
    expect(resolveTranslationVisibility('off', true)).toEqual({ showTranslation: false, showToggleControl: false });
  });

  it('a brand-new ayah (reveal state reset to false) with on-demand mode goes back to hidden, matching the initial state', () => {
    // Simulates AyahCard's own reset-on-new-ayah behavior: whatever the
    // previous ayah's reveal state was, a new ayah always starts at
    // isRevealed=false.
    const previousAyahRevealed = resolveTranslationVisibility('on-demand', true);
    const newAyahInitial = resolveTranslationVisibility('on-demand', false);
    expect(newAyahInitial.showTranslation).toBe(false);
    expect(newAyahInitial.showToggleControl).toBe(true);
    expect(newAyahInitial).not.toEqual(previousAyahRevealed);
  });
});

describe('show/hide translation labels are localized correctly in every app locale', () => {
  APP_LOCALES.forEach((locale) => {
    it(`${locale}: showTranslation and hideTranslation are both non-empty and distinct from each other`, () => {
      const { showTranslation, hideTranslation } = MESSAGES[locale].translation;
      expect(showTranslation.trim().length).toBeGreaterThan(0);
      expect(hideTranslation.trim().length).toBeGreaterThan(0);
      expect(showTranslation).not.toBe(hideTranslation);
    });
  });

  it('en matches the exact required wording', () => {
    expect(MESSAGES.en.translation).toEqual({ showTranslation: 'Show translation', hideTranslation: 'Hide translation' });
  });

  it('ar matches the exact required wording', () => {
    expect(MESSAGES.ar.translation).toEqual({ showTranslation: 'إظهار الترجمة', hideTranslation: 'إخفاء الترجمة' });
  });

  it('ar-EG conveys the same show/hide-translation meaning (project already uses natural Egyptian phrasing here)', () => {
    // Not required to be byte-identical to the MSA strings — only to mean
    // "show translation" / "hide translation" — see quranTranslationPreference
    // usage: both already contain "الترجمة" (translation) with distinct verbs.
    const { showTranslation, hideTranslation } = MESSAGES['ar-EG'].translation;
    expect(showTranslation).toContain('الترجمة');
    expect(hideTranslation).toContain('الترجمة');
    expect(showTranslation).not.toBe(hideTranslation);
  });
});

describe('Translation display-mode behavior in AyahCard.tsx (source-scan: no RN renderer available in this test environment)', () => {
  const AYAH_CARD_PATH = resolve(__dirname, '../src/components/AyahCard.tsx');
  const source = readFileSync(AYAH_CARD_PATH, 'utf-8');

  it('renders the Arabic text unconditionally — never gated behind showTranslation/displayMode', () => {
    const arabicLine = source.match(/<Text[^>]*>\{ayah\.arabicText\}<\/Text>/);
    expect(arabicLine, 'could not find the unconditional Arabic <Text> element').not.toBeNull();
  });

  it('delegates show/hide-toggle visibility to the pure, independently-tested resolveTranslationVisibility function', () => {
    expect(source).toMatch(/resolveTranslationVisibility\(preference\.displayMode,\s*isRevealed\)/);
  });

  it('the English translation text is rendered only when showTranslation is true (never unconditionally)', () => {
    expect(source).toMatch(/\{showTranslation\s*&&\s*\([\s\S]*?ayah\.englishTranslation/);
  });

  it('the toggle button label switches between the localized "Show translation" and "Hide translation" messages, never a hardcoded English string', () => {
    expect(source).toMatch(/messages\.translation\.showTranslation/);
    expect(source).toMatch(/messages\.translation\.hideTranslation/);
    expect(source).not.toMatch(/>\s*(Show|Hide) translation\s*</);
  });

  it('pressing the toggle flips isRevealed rather than only ever setting it (a real toggle, not a one-way reveal)', () => {
    expect(source).toMatch(/setRevealedAyahId\(isRevealed \? null : ayah\.id\)/);
  });

  it('reveal state is local per-ayah-id state, reset when a different ayah loads — never written to the persisted global preference', () => {
    expect(source).toMatch(/useState<string \| null>\(null\)/);
    expect(source).toMatch(/trackedAyahId\s*!==\s*ayah\.id/);
    expect(source).toMatch(/setRevealedAyahId\(null\)/);
    // The reveal state setter must never be passed to saveQuranTranslationPreference / setDisplayMode.
    expect(source).not.toMatch(/setDisplayMode\([^)]*revealedAyahId/);
  });
});
