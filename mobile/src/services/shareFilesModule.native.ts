import { requireOptionalNativeModule } from 'expo';

import type { NativeShareFilesModule } from './shareFilesModule';

/** iOS/Android: the local modules/quran-heals-share-files module, or null when this binary does not include it (Expo Go, builds from before it existed). */
export function loadNativeShareFilesModule(): NativeShareFilesModule | null {
  return requireOptionalNativeModule<NativeShareFilesModule>('QuranHealsShareFiles');
}
