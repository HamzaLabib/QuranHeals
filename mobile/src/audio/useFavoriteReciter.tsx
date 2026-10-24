import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { loadFavoriteReciter, saveFavoriteReciter } from './favoriteReciterPreference';
import { DEFAULT_FAVORITE_RECITER_ID, isReciterId } from './reciters';

export type FavoriteReciterContextValue = {
  reciterId: string;
  isReady: boolean;
  setReciterId: (reciterId: string) => void;
};

/** Without a provider (a component rendered alone in a test): the default and a setter that does nothing. */
const DEFAULT_CONTEXT_VALUE: FavoriteReciterContextValue = { reciterId: DEFAULT_FAVORITE_RECITER_ID, isReady: true, setReciterId: () => undefined };

const FavoriteReciterContext = createContext<FavoriteReciterContextValue>(DEFAULT_CONTEXT_VALUE);

/** The Favorite Reciter (favoriteReciterPreference.ts), shared by Settings, the Mushaf and the ayah screens. */
export function FavoriteReciterProvider({ children }: { children: ReactNode }) {
  const [reciterId, setState] = useState(DEFAULT_FAVORITE_RECITER_ID);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadFavoriteReciter().then((loaded) => {
      if (cancelled) return;
      setState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setReciterId = useCallback((next: string) => {
    if (!isReciterId(next)) return;
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
