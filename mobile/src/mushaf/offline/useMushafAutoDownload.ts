import { useCallback, useSyncExternalStore } from 'react';

import type { AutoState } from './autoDownload';
import { mushafAutoDownload } from './autoDownloadService';

/** The automatic Mushaf download's state, live, for any screen (the controller itself is started by the root layout). */
export function useMushafAutoDownload(): AutoState {
  const subscribe = useCallback((onChange: () => void) => mushafAutoDownload().subscribe(onChange), []);
  const getState = useCallback(() => mushafAutoDownload().getState(), []);
  return useSyncExternalStore(subscribe, getState, getState);
}
