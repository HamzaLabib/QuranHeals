/// <reference types="node" />
import { pbkdf2 } from 'node:crypto';

/**
 * Stand-in for modules/quran-heals-pbkdf2 with the same JS contract (base64
 * bytes in, base64 key out). Backed by Node's OpenSSL — an implementation
 * independent of @noble/hashes, as CommonCrypto/javax are on device.
 */
export function fakeNativePbkdf2() {
  const calls: { iterations: number; keyLength: number }[] = [];
  return {
    calls,
    pbkdf2Sha256: (passwordBase64: string, saltBase64: string, iterations: number, keyLength: number) => {
      calls.push({ iterations, keyLength });
      return new Promise<string>((resolve, reject) => {
        pbkdf2(Buffer.from(passwordBase64, 'base64'), Buffer.from(saltBase64, 'base64'), iterations, keyLength, 'sha256', (error, key) => {
          if (error) reject(error);
          else resolve(key.toString('base64'));
        });
      });
    },
  };
}
