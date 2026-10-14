import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { DEFAULT_KEEP_AWAKE, loadKeepAwake, saveKeepAwake } from './keepAwakePreference';

export type KeepAwakePreferenceContextValue = {
  enabled: boolean;
  /** True once the stored choice has been read (or the read failed and fell back to the default). */
  isReady: boolean;
  setEnabled: (enabled: boolean) => void;
};

/** Without a provider (a component rendered alone in a test): the default, ON, and a setter that does nothing. */
const DEFAULT_CONTEXT_VALUE: KeepAwakePreferenceContextValue = { enabled: DEFAULT_KEEP_AWAKE, isReady: true, setEnabled: () => undefined };

const KeepAwakePreferenceContext = createContext<KeepAwakePreferenceContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * The Keep Screen Awake setting (keepAwakePreference.ts), shared by Settings and the Mushaf so a change in one is
 * seen by the other at once. Starts at the default and loads the stored choice in the background, like Appearance.
 */
export function KeepAwakePreferenceProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabledState] = useState(DEFAULT_KEEP_AWAKE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadKeepAwake().then((loaded) => {
      if (cancelled) return;
      setEnabledState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next);
    void saveKeepAwake(next);
  }, []);

  const value = useMemo<KeepAwakePreferenceContextValue>(() => ({ enabled, isReady, setEnabled }), [enabled, isReady, setEnabled]);
  return <KeepAwakePreferenceContext.Provider value={value}>{children}</KeepAwakePreferenceContext.Provider>;
}

/** Never throws: the default (ON) if no provider is mounted. */
export function useKeepAwakePreference(): KeepAwakePreferenceContextValue {
  return useContext(KeepAwakePreferenceContext);
}
