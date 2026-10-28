import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PreferenceChangeOptions } from '@/localization/useAppLocale';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

import { loadFavoriteReciter, saveFavoriteReciter } from './favoriteReciterPreference';
import { DEFAULT_FAVORITE_RECITER_ID, isReciterId } from './reciters';

export type FavoriteReciterContextValue = {
  reciterId: string;
  isReady: boolean;
  /** `fromSync`: the signed-in account's value (useAuth.tsx), applied without being recorded as this device's change. */
  setReciterId: (reciterId: string, options?: PreferenceChangeOptions) => void;
};

/** Without a provider (a component rendered alone in a test): the default and a setter that does nothing. */
const DEFAULT_CONTEXT_VALUE: FavoriteReciterContextValue = { reciterId: DEFAULT_FAVORITE_RECITER_ID, isReady: true, setReciterId: () => undefined };

const FavoriteReciterContext = createContext<FavoriteReciterContextValue>(DEFAULT_CONTEXT_VALUE);

/** The Favorite Reciter (favoriteReciterPreference.ts), shared by Settings, the Mushaf and the ayah screens. */
export function FavoriteReciterProvider({ children }: { children: ReactNode }) {
  const [reciterId, setState] = useState(DEFAULT_FAVORITE_RECITER_ID);
  const currentRef = useRef(DEFAULT_FAVORITE_RECITER_ID);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadFavoriteReciter().then((loaded) => {
      if (cancelled) return;
      currentRef.current = loaded;
      setState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A reciter this app version does not list (from the account, set on a newer app) is never applied.
  const setReciterId = useCallback((next: string, options?: PreferenceChangeOptions) => {
    if (!isReciterId(next)) return;
    // The user's own change is recorded for the signed-in account (sync/preferencesSyncState.ts).
    if (!options?.fromSync && next !== currentRef.current) recordLocalPreferenceChange('favoriteReciter', next);
    currentRef.current = next;
    setState(next);
    void saveFavoriteReciter(next);
  }, []);

  const value = useMemo<FavoriteReciterContextValue>(() => ({ reciterId, isReady, setReciterId }), [reciterId, isReady, setReciterId]);
  return <FavoriteReciterContext.Provider value={value}>{children}</FavoriteReciterContext.Provider>;
}

/** Never throws: the default (Al-Minshawi: reciters.ts DEFAULT_RECITER_ID) if no provider is mounted. */
export function useFavoriteReciter(): FavoriteReciterContextValue {
  return useContext(FavoriteReciterContext);
}
