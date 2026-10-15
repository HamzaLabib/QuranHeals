import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { PreferenceChangeOptions } from '@/localization/useAppLocale';
import { recordLocalPreferenceChange } from '@/sync/preferencesSyncState';
import { devLog } from '@/utils/devLog';
import { DEFAULT_APPEARANCE_MODE, loadAppearancePreference, saveAppearancePreference, type AppearanceMode } from './appearancePreference';

export type AppearancePreferenceContextValue = {
  mode: AppearanceMode;
  /** True once the persisted preference has been read (or the read failed and fell back to DEFAULT_APPEARANCE_MODE). */
  isReady: boolean;
  /** `fromSync`: the signed-in account's value, applied without being recorded as this device's change. */
  setMode: (mode: AppearanceMode, options?: PreferenceChangeOptions) => void;
};

/**
 * Default context value used when no AppearancePreferenceProvider is
 * mounted — e.g. a component rendered in isolation in a test. It reproduces
 * the Provider's own initial state (DEFAULT_APPEARANCE_MODE = 'system')
 * rather than throwing, so appearance resolution can never block rendering
 * and every existing themed component keeps working unchanged.
 */
const DEFAULT_CONTEXT_VALUE: AppearancePreferenceContextValue = {
  mode: DEFAULT_APPEARANCE_MODE,
  isReady: true,
  setMode: () => undefined,
};

const AppearancePreferenceContext = createContext<AppearancePreferenceContextValue>(DEFAULT_CONTEXT_VALUE);

/**
 * Global appearance-mode preference (the default is System:
 * appearancePreference.ts). Follows the signed-in account
 * (sync/preferenceFields.ts); a guest's stays on the device. Starts synchronously at
 * DEFAULT_APPEARANCE_MODE and loads the persisted choice in the background
 * — the app renders immediately and never waits on this load; if a valid
 * saved preference is found it is applied once loaded, otherwise the app
 * stays on the default.
 */
export function AppearancePreferenceProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AppearanceMode>(DEFAULT_APPEARANCE_MODE);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await loadAppearancePreference();
      if (!cancelled) {
        devLog('appearance', 'preference resolved', { mode: loaded });
        setModeState(loaded);
        setIsReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: AppearanceMode, options?: PreferenceChangeOptions) => {
    // The user's own choice is recorded for the signed-in account; an account value (fromSync) is not.
    if (!options?.fromSync) recordLocalPreferenceChange('appearance', next);
    setModeState(next);
    void saveAppearancePreference(next);
  }, []);

  const value = useMemo<AppearancePreferenceContextValue>(() => ({ mode, isReady, setMode }), [mode, isReady, setMode]);

  return <AppearancePreferenceContext.Provider value={value}>{children}</AppearancePreferenceContext.Provider>;
}

/** Never throws: falls back to the default (System) context value if no provider is mounted. */
export function useAppearancePreference(): AppearancePreferenceContextValue {
  return useContext(AppearancePreferenceContext);
}
