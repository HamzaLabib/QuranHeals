import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import type { PreferenceChangeOptions } from '@/localization/useAppLocale';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';

import { DEFAULT_MEMORIZATION_MODE_VISIBLE, loadMemorizationModeVisible, saveMemorizationModeVisible } from './memorizationModePreference';

export type MemorizationModeSettingContextValue = {
  /** Whether the Eye button is offered (Settings → Quran → Memorization Mode). */
  visible: boolean;
  /** True once the stored choice has been read (or the read failed and fell back to the default). */
  isReady: boolean;
  /** `fromSync`: the signed-in account's value (useAuth.tsx), applied without being recorded as this device's change. */
  setVisible: (visible: boolean, options?: PreferenceChangeOptions) => void;
};

/**
 * Without a provider (a component rendered alone, as in a test): the Eye not offered, and a setter that does nothing.
 * The app always mounts the provider (app/_layout.tsx), which starts from the stored choice or the default (ON).
 */
const DEFAULT_CONTEXT_VALUE: MemorizationModeSettingContextValue = { visible: false, isReady: true, setVisible: () => undefined };

const MemorizationModeSettingContext = createContext<MemorizationModeSettingContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * The Memorization Mode setting (memorizationModePreference.ts), shared by Settings and the Mushaf so a change in one is
 * seen by the other at once. Starts at the default and loads the stored choice in the background, like Word Meanings.
 */
export function MemorizationModeSettingProvider({ children }: { children: ReactNode }) {
  const [visible, setVisibleState] = useState(DEFAULT_MEMORIZATION_MODE_VISIBLE);
  const currentRef = useRef(DEFAULT_MEMORIZATION_MODE_VISIBLE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadMemorizationModeVisible().then((loaded) => {
      if (cancelled) return;
      currentRef.current = loaded;
      setVisibleState(loaded);
      setIsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setVisible = useCallback((next: boolean, options?: PreferenceChangeOptions) => {
    // The user's own change is recorded for the signed-in account (sync/preferencesSyncState.ts).
    if (!options?.fromSync && next !== currentRef.current) recordLocalPreferenceChange('memorizationModeVisible', next);
    currentRef.current = next;
    setVisibleState(next);
    void saveMemorizationModeVisible(next);
  }, []);

  const value = useMemo<MemorizationModeSettingContextValue>(() => ({ visible, isReady, setVisible }), [visible, isReady, setVisible]);
  return <MemorizationModeSettingContext.Provider value={value}>{children}</MemorizationModeSettingContext.Provider>;
}

/** Never throws: not offered (visible false) if no provider is mounted. */
export function useMemorizationModeSetting(): MemorizationModeSettingContextValue {
  return useContext(MemorizationModeSettingContext);
}
