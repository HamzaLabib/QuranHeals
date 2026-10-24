import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_WORD_MEANINGS_VISIBLE, loadWordMeaningsVisible, saveWordMeaningsVisible } from './wordMeaningsVisibilityPreference';

export type WordMeaningsVisibilityContextValue = {
  visible: boolean;
  /** True once the stored choice has been read (or the read failed and fell back to the default). */
  isReady: boolean;
  setVisible: (visible: boolean) => void;
};

/** Without a provider (a component rendered alone in a test): the default, ON, and a setter that does nothing. */
const DEFAULT_CONTEXT_VALUE: WordMeaningsVisibilityContextValue = { visible: DEFAULT_WORD_MEANINGS_VISIBLE, isReady: true, setVisible: () => undefined };

const WordMeaningsVisibilityContext = createContext<WordMeaningsVisibilityContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * The Word Meanings setting (wordMeaningsVisibilityPreference.ts), shared by Settings and the Mushaf so a change in one is seen by
 * the other at once. Starts at the default and loads the stored choice in the background, like Keep Screen Awake.
 */
export function WordMeaningsVisibilityProvider({ children }: { children: ReactNode }) {
  const [visible, setVisibleState] = useState(DEFAULT_WORD_MEANINGS_VISIBLE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadWordMeaningsVisible().then((loaded) => {
      if (cancelled) return;
      setVisibleState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setVisible = useCallback((next: boolean) => {
    setVisibleState(next);
    void saveWordMeaningsVisible(next);
  }, []);

  const value = useMemo<WordMeaningsVisibilityContextValue>(() => ({ visible, isReady, setVisible }), [visible, isReady, setVisible]);
  return <WordMeaningsVisibilityContext.Provider value={value}>{children}</WordMeaningsVisibilityContext.Provider>;
}

/** Never throws: the default (ON) if no provider is mounted. */
export function useWordMeaningsVisibility(): WordMeaningsVisibilityContextValue {
  return useContext(WordMeaningsVisibilityContext);
}
