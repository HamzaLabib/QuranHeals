/**
 * Dependency-free base64 encode/decode for Uint8Array. Deliberately not
 * `Buffer` (not guaranteed present in the Hermes/React Native runtime) or
 * global `atob`/`btoa` (inconsistent availability across RN engines) — this
 * is plain, well-known base64 arithmetic, not a cryptographic primitive.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
  let result = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;

    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 0x03) << 4) | (b1 >> 4)];
    result += hasB1 ? BASE64_CHARS[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    result += hasB2 ? BASE64_CHARS[b2 & 0x3f] : '=';
  }

  return result;
}

export function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;

  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) {
      throw new Error('Invalid base64 input.');
    }
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}
