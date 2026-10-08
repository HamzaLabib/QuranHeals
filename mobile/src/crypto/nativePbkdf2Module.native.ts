import { requireOptionalNativeModule } from 'expo';

import type { NativePbkdf2Module } from './nativePbkdf2Module';

/** iOS/Android: the local modules/quran-heals-pbkdf2 module, or null when this binary does not include it (Expo Go, builds from before it existed). */
export function loadNativePbkdf2Module(): NativePbkdf2Module | null {
  return requireOptionalNativeModule<NativePbkdf2Module>('QuranHealsPbkdf2');
}
