import { requireOptionalNativeModule } from 'expo';

import type { NativeBackupExclusionModule } from './backupExclusionModule';

/**
 * iOS: the local modules/quran-heals-backup-exclusion module. null on Android (the module is iOS-only) and in a binary
 * built before it existed (Expo Go, older builds receiving an update), where nothing is marked.
 */
export function loadNativeBackupExclusionModule(): NativeBackupExclusionModule | null {
  return requireOptionalNativeModule<NativeBackupExclusionModule>('QuranHealsBackupExclusion');
}
