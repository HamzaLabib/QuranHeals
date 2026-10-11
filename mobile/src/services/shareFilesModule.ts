/** Contract of modules/quran-heals-share-files: several local files in one system share sheet, in order. Resolves when the sheet closes. */
export type NativeShareFilesModule = {
  shareFilesAsync(urls: string[], dialogTitle: string | null): Promise<void>;
};

/** Web and Node (tests): no native module. iOS/Android resolve shareFilesModule.native.ts instead. */
export function loadNativeShareFilesModule(): NativeShareFilesModule | null {
  return null;
}
