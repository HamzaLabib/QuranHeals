import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { APP_LOCALES, DEFAULT_APP_LOCALE, isAppLocale, type AppLocale } from './locales';
import { getMessages, type Messages } from './messages';
import { recordLocalPreferencesUpdatedAt } from '@/sync/preferencesSyncState';

/** Versioned/namespaced, matching the convention already used by mobile/src/storage/recentAyahs.ts. */
export const APP_LOCALE_STORAGE_KEY = 'quran-heals:app-locale:v1';

/** `fromSync` marks a value applied from the account preference rather than chosen by the user on this device. */
export type PreferenceChangeOptions = { fromSync?: boolean };

export type AppLocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale, options?: PreferenceChangeOptions) => void;
  messages: Messages;
  /** True once the persisted preference has been read (or safely defaulted). */
  isReady: boolean;
};

const AppLocaleContext = createContext<AppLocaleContextValue | undefined>(undefined);

/**
 * Persists the user's app-language choice via AsyncStorage (this project's
 * existing persistence mechanism — see recentAyahs.ts) under a
 * versioned/namespaced key. Defaults to `en` (DEFAULT_APP_LOCALE),
 * preserving current app behavior. An invalid or unreadable stored value
 * (corrupted storage, a future removed locale) falls back to the default
 * safely — it never throws and never leaves the app in a broken locale
 * state.
 */
export function AppLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_APP_LOCALE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(APP_LOCALE_STORAGE_KEY);
        if (!cancelled && isAppLocale(stored)) {
          setLocaleState(stored);
        }
      } catch {
        // Unreadable storage: keep the default locale rather than throwing.
      } finally {
        if (!cancelled) setIsReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((next: AppLocale, options?: PreferenceChangeOptions) => {
    // A user's choice is stamped so sync can tell it is newer than the
    // account's value; a value adopted from the account is stamped by sync
    // itself (preferencesSync.ts) with the account's own timestamp.
    if (!options?.fromSync) recordLocalPreferencesUpdatedAt(Date.now());
    setLocaleState(next);
    void AsyncStorage.setItem(APP_LOCALE_STORAGE_KEY, next).catch(() => {
      // Persistence failure is non-fatal: the in-memory selection still applies this session.
    });
  }, []);

  const value = useMemo<AppLocaleContextValue>(
    () => ({ locale, setLocale, messages: getMessages(locale), isReady }),
    [locale, setLocale, isReady],
  );

  return <AppLocaleContext.Provider value={value}>{children}</AppLocaleContext.Provider>;
}

export function useAppLocale(): AppLocaleContextValue {
  const context = useContext(AppLocaleContext);
  if (!context) {
    throw new Error('useAppLocale must be used within an AppLocaleProvider');
  }
  return context;
}

export { APP_LOCALES };
