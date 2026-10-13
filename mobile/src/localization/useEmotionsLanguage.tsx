import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_EMOTIONS_LANGUAGE,
  loadStoredEmotionsLanguage,
  migrateLegacyAppLanguage,
  resolveEmotionLocale,
  saveEmotionsLanguage,
  subscribeToEmotionsLanguage,
  type EmotionsLanguage,
} from './emotionsLanguage';
import { getDirectionStyle, isRtlLocale, type AppLocale, type TextDirection } from './locales';
import { useAppLocale } from './useAppLocale';

export type EmotionsLanguageContextValue = {
  /** The stored choice ('follow' by default). */
  preference: EmotionsLanguage;
  setPreference: (value: EmotionsLanguage) => void;
  isReady: boolean;
};

const EmotionsLanguageContext = createContext<EmotionsLanguageContextValue | undefined>(undefined);

/** Emotions Language (لغة المشاعر), persisted on the device (emotionsLanguage.ts). Inside AppLocaleProvider. */
export function EmotionsLanguageProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<EmotionsLanguage>(DEFAULT_EMOTIONS_LANGUAGE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Applied by a migration or an account's Egyptian Arabic, as well as by the picker.
    const unsubscribe = subscribeToEmotionsLanguage((value) => {
      if (!cancelled) setPreferenceState(value);
    });
    void (async () => {
      // A legacy Egyptian Arabic App Language becomes this setting first.
      await migrateLegacyAppLanguage();
      const stored = await loadStoredEmotionsLanguage();
      if (cancelled) return;
      if (stored) setPreferenceState(stored);
      setIsReady(true);
    })();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const setPreference = useCallback((value: EmotionsLanguage) => {
    void saveEmotionsLanguage(value);
  }, []);

  const value = useMemo(() => ({ preference, setPreference, isReady }), [preference, setPreference, isReady]);
  return <EmotionsLanguageContext.Provider value={value}>{children}</EmotionsLanguageContext.Provider>;
}

/** The Emotions Language setting; outside its provider (isolated component tests), the default: follow the App Language. */
export function useEmotionsLanguage(): EmotionsLanguageContextValue {
  return useContext(EmotionsLanguageContext) ?? { preference: DEFAULT_EMOTIONS_LANGUAGE, setPreference: () => {}, isReady: true };
}

/**
 * The locale emotion content is shown in, and its own text direction — an
 * Arabic emotion name reads right to left inside an English interface, and
 * an English one left to right inside an Arabic interface. Per text, never
 * a global layout change.
 */
export function useEmotionLocale(): { emotionLocale: AppLocale; emotionDirection: { writingDirection: TextDirection; textAlign: 'left' | 'right' }; emotionRtl: boolean } {
  const { locale } = useAppLocale();
  const { preference } = useEmotionsLanguage();
  const emotionLocale = resolveEmotionLocale(preference, locale);
  return { emotionLocale, emotionDirection: getDirectionStyle(emotionLocale), emotionRtl: isRtlLocale(emotionLocale) };
}
