import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_MEMORIZATION_MODE_VISIBLE, loadMemorizationModeVisible, saveMemorizationModeVisible } from './memorizationModePreference';

export type MemorizationModeSettingContextValue = {
  /** Whether the Eye button is offered (Settings → Quran → Memorization Mode). */
  visible: boolean;
  /** True once the stored choice has been read (or the read failed and fell back to the default). */
  isReady: boolean;
  setVisible: (visible: boolean) => void;
};

/** Without a provider (a component rendered alone in a test): the default, OFF, and a setter that does nothing. */
const DEFAULT_CONTEXT_VALUE: MemorizationModeSettingContextValue = { visible: DEFAULT_MEMORIZATION_MODE_VISIBLE, isReady: true, setVisible: () => undefined };

const MemorizationModeSettingContext = createContext<MemorizationModeSettingContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * The Memorization Mode setting (memorizationModePreference.ts), shared by Settings and the Mushaf so a change in one is
 * seen by the other at once. Starts at the default and loads the stored choice in the background, like Word Meanings.
 */
export function MemorizationModeSettingProvider({ children }: { children: ReactNode }) {
  const [visible, setVisibleState] = useState(DEFAULT_MEMORIZATION_MODE_VISIBLE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadMemorizationModeVisible().then((loaded) => {
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
    void saveMemorizationModeVisible(next);
  }, []);

  const value = useMemo<MemorizationModeSettingContextValue>(() => ({ visible, isReady, setVisible }), [visible, isReady, setVisible]);
  return <MemorizationModeSettingContext.Provider value={value}>{children}</MemorizationModeSettingContext.Provider>;
}

/** Never throws: the default (OFF) if no provider is mounted. */
export function useMemorizationModeSetting(): MemorizationModeSettingContextValue {
  return useContext(MemorizationModeSettingContext);
}
