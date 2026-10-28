/** Contract of modules/quran-heals-backup-exclusion (iOS only): NSURLIsExcludedFromBackupKey on a file or directory. */
export type NativeBackupExclusionModule = {
  /** false when nothing exists at that location. */
  excludeFromBackupAsync(location: string): Promise<boolean>;
  /** null when nothing exists at that location. */
  isExcludedFromBackupAsync(location: string): Promise<boolean | null>;
};

/** Web and Node (tests): no native module. iOS/Android resolve backupExclusionModule.native.ts instead. */
export function loadNativeBackupExclusionModule(): NativeBackupExclusionModule | null {
  return null;
}
