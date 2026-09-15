import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_QURAN_TRANSLATION_PREFERENCE,
  PICKTHALL_TRANSLATION_ID,
  parseQuranTranslationPreference,
} from '@/localization/quranTranslationPreference';

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

describe('Translation display-mode behavior in AyahCard.tsx (source-scan: no RN renderer available in this test environment)', () => {
  const AYAH_CARD_PATH = resolve(__dirname, '../src/components/AyahCard.tsx');
  const source = readFileSync(AYAH_CARD_PATH, 'utf-8');

  it('renders the Arabic text unconditionally — never gated behind showTranslation/displayMode', () => {
    const arabicLine = source.match(/<Text[^>]*>\{ayah\.arabicText\}<\/Text>/);
    expect(arabicLine, 'could not find the unconditional Arabic <Text> element').not.toBeNull();
  });

  it('computes showTranslation as "always", or "on-demand" combined with this ayah having been revealed', () => {
    expect(source).toMatch(
      /showTranslation\s*=\s*preference\.displayMode\s*===\s*'always'\s*\|\|\s*\(preference\.displayMode\s*===\s*'on-demand'\s*&&\s*isRevealed\)/,
    );
  });

  it('only shows the reveal control in on-demand mode, before the ayah has been revealed', () => {
    expect(source).toMatch(/showRevealControl\s*=\s*preference\.displayMode\s*===\s*'on-demand'\s*&&\s*!isRevealed/);
  });

  it('the English translation text is rendered only when showTranslation is true (never unconditionally)', () => {
    expect(source).toMatch(/\{showTranslation\s*&&\s*\([\s\S]*?ayah\.englishTranslation/);
  });

  it('the reveal button text uses the localized "Show translation" message, not a hardcoded English string', () => {
    expect(source).toMatch(/messages\.translation\.showTranslation/);
    expect(source).not.toMatch(/>\s*Show translation\s*</);
  });

  it('reveal state is local per-ayah-id state, reset when a different ayah loads — never written to the persisted global preference', () => {
    expect(source).toMatch(/useState<string \| null>\(null\)/);
    expect(source).toMatch(/trackedAyahId\s*!==\s*ayah\.id/);
    expect(source).toMatch(/setRevealedAyahId\(null\)/);
    // The reveal state setter must never be passed to saveQuranTranslationPreference / setDisplayMode.
    expect(source).not.toMatch(/setDisplayMode\([^)]*revealedAyahId/);
  });
});
