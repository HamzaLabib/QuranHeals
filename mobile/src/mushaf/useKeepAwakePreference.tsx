import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PreferenceChangeOptions } from '@/localization/useAppLocale';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

import { DEFAULT_KEEP_AWAKE, loadKeepAwake, saveKeepAwake } from './keepAwakePreference';

export type KeepAwakePreferenceContextValue = {
  enabled: boolean;
  /** True once the stored choice has been read (or the read failed and fell back to the default). */
  isReady: boolean;
  /** `fromSync`: the signed-in account's value (useAuth.tsx), applied without being recorded as this device's change. */
  setEnabled: (enabled: boolean, options?: PreferenceChangeOptions) => void;
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
  const currentRef = useRef(DEFAULT_KEEP_AWAKE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadKeepAwake().then((loaded) => {
      if (cancelled) return;
      currentRef.current = loaded;
      setEnabledState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEnabled = useCallback((next: boolean, options?: PreferenceChangeOptions) => {
    // The user's own change is recorded for the signed-in account (sync/preferencesSyncState.ts).
    if (!options?.fromSync && next !== currentRef.current) recordLocalPreferenceChange('keepAwake', next);
    currentRef.current = next;
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
