import { useEffect, useSyncExternalStore } from 'react';

import { tafsirLibrary, type TafsirLibrary, type TafsirLibrarySnapshot } from './library';

/** The shared tafsir library and each edition's state, re-rendering as downloads move. */
export function useTafsirLibrary(library: TafsirLibrary = tafsirLibrary()): { library: TafsirLibrary; states: TafsirLibrarySnapshot } {
  const states = useSyncExternalStore(library.subscribe, library.getSnapshot, library.getSnapshot);
  useEffect(() => {
    void library.refresh();
  }, [library]);
  return { library, states };
}
