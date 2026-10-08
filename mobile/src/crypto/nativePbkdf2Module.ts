/** Contract of modules/quran-heals-pbkdf2: PBKDF2-HMAC-SHA256 over base64-encoded raw bytes, resolving to the base64-encoded key. */
export type NativePbkdf2Module = {
  pbkdf2Sha256(passwordBase64: string, saltBase64: string, iterations: number, keyLength: number): Promise<string>;
};

/** Web and Node (tests): no native module. iOS/Android resolve nativePbkdf2Module.native.ts instead. */
export function loadNativePbkdf2Module(): NativePbkdf2Module | null {
  return null;
}
