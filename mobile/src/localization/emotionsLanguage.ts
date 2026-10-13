import AsyncStorage from '@react-native-async-storage/async-storage';

import { isAppLanguage, type AppLanguage, type AppLocale } from './locales';

/**
 * Emotions Language (لغة المشاعر): the language of emotion content only —
 * the 30 emotion names (Home, View All, the ayah screen's title) and the
 * body of "How this ayah connects". The rest of the interface follows the
 * App Language (useAppLocale.tsx); the Quran is always Arabic.
 *
 *  - 'follow' (default): English app → English; Arabic app → Modern Standard Arabic.
 *  - 'en', 'ar', 'ar-EG': that language, whatever the App Language.
 *
 * Fallbacks (documented, never invented content):
 *  - an emotion name missing in the chosen language → English → a
 *    readable form of the stable key (utils/emotionLabel.ts);
 *  - "How this ayah connects" exists in English and Arabic only: Egyptian
 *    Arabic shows the approved Arabic (MSA) text, as it always has
 *    (utils/ayahConnection.ts); a missing text hides the section.
 */
export type EmotionsLanguage = 'follow' | AppLocale;
export const EMOTIONS_LANGUAGES: readonly EmotionsLanguage[] = ['follow', 'en', 'ar', 'ar-EG'];
export const DEFAULT_EMOTIONS_LANGUAGE: EmotionsLanguage = 'follow';

export const EMOTIONS_LANGUAGE_STORAGE_KEY = 'quran-heals:emotions-language:v1';
/** Shared with useAppLocale.tsx (its storage key). */
const APP_LOCALE_STORAGE_KEY = 'quran-heals:app-locale:v1';

export function isEmotionsLanguage(value: unknown): value is EmotionsLanguage {
  return typeof value === 'string' && (EMOTIONS_LANGUAGES as readonly string[]).includes(value);
}

/** The locale emotion content is shown in. */
export function resolveEmotionLocale(preference: EmotionsLanguage, appLanguage: AppLanguage): AppLocale {
  return preference === 'follow' ? appLanguage : preference;
}

/** Stored choice, or null when the user never chose (the default, 'follow', applies). Never throws. */
export async function loadStoredEmotionsLanguage(): Promise<EmotionsLanguage | null> {
  try {
    const stored = await AsyncStorage.getItem(EMOTIONS_LANGUAGE_STORAGE_KEY);
    return isEmotionsLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}

const listeners = new Set<(value: EmotionsLanguage) => void>();
export function subscribeToEmotionsLanguage(listener: (value: EmotionsLanguage) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function saveEmotionsLanguage(value: EmotionsLanguage): Promise<void> {
  listeners.forEach((listener) => listener(value));
  try {
    await AsyncStorage.setItem(EMOTIONS_LANGUAGE_STORAGE_KEY, value);
  } catch {
    // Non-fatal: the in-memory choice still applies this session.
  }
}

/**
 * Egyptian Arabic is no longer an App Language. A user who had it keeps
 * it where it now lives: Emotions Language becomes Egyptian Arabic —
 * unless they already chose an Emotions Language explicitly — and the App
 * Language becomes Arabic. Used both for a stored App Language
 * (migrateLegacyAppLanguage) and for an 'ar-EG' arriving from the account's
 * synced preference (useAppLocale.tsx). Idempotent.
 */
export async function moveEgyptianArabicToEmotions(): Promise<void> {
  if ((await loadStoredEmotionsLanguage()) === null) await saveEmotionsLanguage('ar-EG');
}

/**
 * Reads the stored App Language, first migrating a legacy 'ar-EG':
 * Emotions Language first, then the App Language, so an interruption
 * between the two simply repeats. Idempotent and cheap, so it runs on every
 * load (both providers call it; two concurrent runs write the same values).
 * Every other preference and all user data are untouched. Returns the App
 * Language to use, or null when none is stored. Never throws.
 */
export async function migrateLegacyAppLanguage(): Promise<AppLanguage | null> {
  try {
    const stored = await AsyncStorage.getItem(APP_LOCALE_STORAGE_KEY);
    if (stored === 'ar-EG') {
      await moveEgyptianArabicToEmotions();
      await AsyncStorage.setItem(APP_LOCALE_STORAGE_KEY, 'ar');
      return 'ar';
    }
    return isAppLanguage(stored) ? stored : null;
  } catch {
    return null;
  }
}
