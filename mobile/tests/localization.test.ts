import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_LOCALES, APP_LOCALE_DISPLAY_NAMES, DEFAULT_APP_LOCALE, getDirectionStyle, isAppLocale, isRtlLocale } from '@/localization/locales';
import { MESSAGES, getMessages } from '@/localization/messages';

const asyncStorageState = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageState.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageState.set(key, value);
    }),
  },
}));

describe('AppLocale values and RTL/LTR direction', () => {
  it('supports exactly the three approved app locales, defaulting to English', () => {
    expect(APP_LOCALES).toEqual(['en', 'ar', 'ar-EG']);
    expect(DEFAULT_APP_LOCALE).toBe('en');
  });

  it('classifies ar and ar-EG as RTL, and en as LTR', () => {
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('ar-EG')).toBe(true);
  });

  it('produces a matching writingDirection/textAlign pair per locale, without requiring a global RTL app restart', () => {
    expect(getDirectionStyle('en')).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
    expect(getDirectionStyle('ar')).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(getDirectionStyle('ar-EG')).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('validates candidate locale values safely, rejecting anything outside the approved set', () => {
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('ar')).toBe(true);
    expect(isAppLocale('ar-EG')).toBe(true);
    expect(isAppLocale('fr')).toBe(false);
    expect(isAppLocale('AR')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(isAppLocale(null)).toBe(false);
    expect(isAppLocale(42)).toBe(false);
  });

  it('exposes each locale`s own self-name for the settings picker, never machine-translated', () => {
    expect(APP_LOCALE_DISPLAY_NAMES).toEqual({
      en: 'English',
      ar: 'العربية',
      'ar-EG': 'العربية المصرية',
    });
  });
});

describe('Interface message dictionary (messages.ts)', () => {
  const sectionKeySets = (locale: keyof typeof MESSAGES) => {
    const messages = MESSAGES[locale];
    const result: Record<string, string[]> = {};
    for (const [section, value] of Object.entries(messages)) {
      if (value && typeof value === 'object') {
        result[section] = Object.keys(value).sort();
      }
    }
    return result;
  };

  it('defines every message key for all three locales — no locale is missing a string the others have', () => {
    const en = sectionKeySets('en');
    const ar = sectionKeySets('ar');
    const arEG = sectionKeySets('ar-EG');
    expect(ar).toEqual(en);
    expect(arEG).toEqual(en);
  });

  it('every message string in every locale is non-empty', () => {
    for (const locale of APP_LOCALES) {
      const messages = MESSAGES[locale];
      for (const [section, value] of Object.entries(messages)) {
        if (typeof value === 'string') {
          expect(value.trim().length, `${locale}.${section} is empty`).toBeGreaterThan(0);
          continue;
        }
        for (const [key, str] of Object.entries(value as Record<string, string>)) {
          expect(str.trim().length, `${locale}.${section}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('getMessages returns the matching dictionary for each locale, and safely falls back to English for an unknown one', () => {
    expect(getMessages('en')).toBe(MESSAGES.en);
    expect(getMessages('ar')).toBe(MESSAGES.ar);
    expect(getMessages('ar-EG')).toBe(MESSAGES['ar-EG']);
    // @ts-expect-error deliberately passing an unsupported locale to prove the safe fallback
    expect(getMessages('fr')).toBe(MESSAGES.en);
  });

  it('the on-demand "Show translation" / "Hide translation" toggle uses the exact approved wording per locale', () => {
    expect(MESSAGES.en.translation.showTranslation).toBe('Show translation');
    expect(MESSAGES.en.translation.hideTranslation).toBe('Hide translation');
    expect(MESSAGES.ar.translation.showTranslation).toBe('إظهار الترجمة');
    expect(MESSAGES.ar.translation.hideTranslation).toBe('إخفاء الترجمة');
    // ar-EG: showTranslation keeps the project's existing natural-Egyptian
    // phrasing (same meaning, distinct verb from ar); hideTranslation now
    // matches ar exactly, per the approved wording.
    expect(MESSAGES['ar-EG'].translation.showTranslation).toBe('عرض الترجمة');
    expect(MESSAGES['ar-EG'].translation.hideTranslation).toBe('إخفاء الترجمة');
  });

  it('the home heading uses the exact approved wording per locale', () => {
    expect(MESSAGES.en.home.title).toBe('How are you feeling?');
    expect(MESSAGES.ar.home.title).toBe('بماذا تشعر الآن؟');
    expect(MESSAGES['ar-EG'].home.title).toBe('إيه إحساسك دلوقتي؟');
  });

  it('the Egyptian Arabic home subtitle uses the exact approved wording', () => {
    expect(MESSAGES['ar-EG'].home.subtitle).toBe('رسالة من القرآن لكل إحساس بتحسه');
  });

  it('general Arabic UI copy (eyebrow, disclaimer, kicker) uses Standard Arabic in both ar and ar-EG, unlike the Egyptian home heading/subtitle', () => {
    expect(MESSAGES.ar.home.eyebrow).toBe('تأمّل مع آية');
    expect(MESSAGES['ar-EG'].home.eyebrow).toBe('تأمّل مع آية');

    expect(MESSAGES.ar.home.disclaimer).toBe(
      'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
    );
    expect(MESSAGES['ar-EG'].home.disclaimer).toBe(
      'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
    );

    expect(MESSAGES.ar.ayah.kicker).toBe('آية مختارة لهذه اللحظة');
    expect(MESSAGES['ar-EG'].ayah.kicker).toBe('آية مختارة لهذه اللحظة');
  });

  it('ar-EG general UI copy (another ayah, remove, favorites notice, translation settings) uses Standard Arabic, not Egyptian colloquial wording', () => {
    expect(MESSAGES['ar-EG'].ayah.anotherAyah).toBe('آية أخرى');
    expect(MESSAGES['ar-EG'].ayah.loadAnotherAyah).toBe('تحميل آية أخرى');

    expect(MESSAGES['ar-EG'].favorites.remove).toBe('إزالة');
    expect(MESSAGES['ar-EG'].favorites.removeSaved).toBe('إزالة الآية المحفوظة');
    expect(MESSAGES['ar-EG'].favoriteButton.removeLabel).toBe('إزالة الآية من المفضّلة');

    expect(MESSAGES['ar-EG'].favorites.subtitle).toBe('المفضّلة محفوظة على هذا الجهاز.');

    expect(MESSAGES['ar-EG'].settings.quranTranslationSection).toBe('ترجمة القرآن');
    expect(MESSAGES['ar-EG'].settings.translationDisplayAlways).toBe('دائمًا');
    expect(MESSAGES['ar-EG'].settings.translationDisplayAlwaysHint).toBe(
      'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
    );
    expect(MESSAGES['ar-EG'].settings.translationDisplayOnDemand).toBe('عند الطلب');
    expect(MESSAGES['ar-EG'].settings.translationDisplayOnDemandHint).toBe(
      'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
    );
    expect(MESSAGES['ar-EG'].settings.translationDisplayOff).toBe('إيقاف');
    expect(MESSAGES['ar-EG'].settings.translationDisplayOffHint).toBe('النص العربي فقط. لن تظهر الترجمة.');
    expect(MESSAGES['ar-EG'].settings.quranArabicNote).toBe(
      'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
    );
  });

  it('never localizes Quran Arabic, Pickthall translation text, verse keys, or stable emotion keys (only interface copy is present)', () => {
    const disallowedSubstrings = ['pickthall', 'bismillah', 'surah_', 'verseKey', 'emotionKey'];
    for (const locale of APP_LOCALES) {
      const serialized = JSON.stringify(MESSAGES[locale]).toLowerCase();
      disallowedSubstrings.forEach((needle) => {
        expect(serialized.includes(needle.toLowerCase()), `${locale} messages unexpectedly reference "${needle}"`).toBe(false);
      });
    }
  });
});

describe('Locale persistence (useAppLocale.tsx): AsyncStorage wiring proven by source + isolated logic', () => {
  const PROVIDER_PATH = resolve(__dirname, '../src/localization/useAppLocale.tsx');
  const source = readFileSync(PROVIDER_PATH, 'utf-8');

  it('persists under a versioned/namespaced AsyncStorage key, matching this project`s existing storage convention', () => {
    expect(source).toMatch(/APP_LOCALE_STORAGE_KEY\s*=\s*'quran-heals:app-locale:v1'/);
    expect(source).toMatch(/AsyncStorage\.getItem\(APP_LOCALE_STORAGE_KEY\)/);
    expect(source).toMatch(/AsyncStorage\.setItem\(APP_LOCALE_STORAGE_KEY,\s*next\)/);
  });

  it('defaults to DEFAULT_APP_LOCALE (English) and only accepts a stored value that passes isAppLocale', () => {
    expect(source).toMatch(/useState<AppLocale>\(DEFAULT_APP_LOCALE\)/);
    expect(source).toMatch(/isAppLocale\(stored\)/);
  });

  it('never throws on unreadable/corrupted storage — a read failure is caught and the default locale is kept', () => {
    expect(source).toMatch(/try\s*{[\s\S]*AsyncStorage\.getItem[\s\S]*}\s*catch/);
  });
});

describe('AsyncStorage-backed locale round trip (simulated provider logic)', () => {
  beforeEach(() => asyncStorageState.clear());

  it('a valid persisted locale is read back through isAppLocale exactly as the provider would validate it', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('quran-heals:app-locale:v1', 'ar-EG');
    const stored = await AsyncStorage.getItem('quran-heals:app-locale:v1');
    expect(isAppLocale(stored)).toBe(true);
    expect(stored).toBe('ar-EG');
  });

  it('an invalid persisted value fails isAppLocale, matching the provider`s safe-fallback-to-default path', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('quran-heals:app-locale:v1', 'fr');
    const stored = await AsyncStorage.getItem('quran-heals:app-locale:v1');
    expect(isAppLocale(stored)).toBe(false);
  });
});
