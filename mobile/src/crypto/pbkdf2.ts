import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { devLog } from '@/utils/devLog';
import { decodeBase64, encodeBase64 } from './base64';
import { loadNativePbkdf2Module, type NativePbkdf2Module } from './nativePbkdf2Module';

/**
 * The single PBKDF2-HMAC-SHA256 entry point. Computation only: the native
 * module (modules/quran-heals-pbkdf2 — CommonCrypto on iOS, javax HMAC on
 * Android) and the JS implementation take the same bytes and return the same
 * bytes; which one ran never changes the result.
 *
 * Native is used only after it reproduces known answers on this device
 * (NATIVE_KNOWN_ANSWERS, computed with OpenSSL and checked against the JS
 * implementation in tests/pbkdf2Compatibility.test.ts). Otherwise — module
 * absent (Expo Go, web, tests, a build from before the module existed),
 * known-answer mismatch, or a native error on any call — the JS
 * implementation runs instead. A fallback only costs time; it never alters a
 * key, so nothing stored or uploaded can depend on it.
 */

// How long the JS PBKDF2 computes before yielding to the event loop. Scheduling
// only: the derived key is identical for any value. noble's 10ms default yields
// via setTimeout(0), which on React Native costs about a frame each time, so the
// yields alone took longer than the KDF itself.
export const KDF_ASYNC_TICK_MS = 50;

export type Pbkdf2Implementation = 'native' | 'js';

/** Generated with Node's OpenSSL (crypto.pbkdf2Sync, sha256). The first is RFC 7914 §11; it spans two output blocks. The second covers non-ASCII UTF-8 password bytes and 0x00/0xFF salt bytes. */
export const NATIVE_KNOWN_ANSWERS: readonly { password: string; salt: string; iterations: number; keyLength: number; expected: string }[] = [
  {
    password: 'cGFzc3dk', // "passwd"
    salt: 'c2FsdA==', // "salt"
    iterations: 1,
    keyLength: 64,
    expected: 'VawEblbjCJ/sFpHCJUS2BflBhSFt3gRl5oudV8INrLxJypzM8Xm2RZkWZLOdd+8xfHG4RbHjC9UJESBB06GXgw==',
  },
  {
    password: 'cMOkc3N3w7ZyZCDinJMg77e9', // "pässwörd ✓ ﷽" as UTF-8
    salt: 'AP8Q73+AAf4BAgMEBQYHCA==',
    iterations: 4096,
    keyLength: 32,
    expected: 'mC7Uno4lMMLFTNAuHmEdGAbIJ87CEaUxO7WH455Vdsg=',
  },
];

let nativeOverride: NativePbkdf2Module | null | undefined;
let trustedNative: Promise<NativePbkdf2Module | null> | null = null;

function loadNativeModule(): NativePbkdf2Module | null {
  if (nativeOverride !== undefined) return nativeOverride;
  try {
    return loadNativePbkdf2Module();
  } catch {
    return null;
  }
}

async function passesKnownAnswers(native: NativePbkdf2Module): Promise<boolean> {
  try {
    for (const vector of NATIVE_KNOWN_ANSWERS) {
      const actual = await native.pbkdf2Sha256(vector.password, vector.salt, vector.iterations, vector.keyLength);
      if (actual !== vector.expected) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** The native module once it has passed the known-answer test on this device, or null. Checked once per app run; concurrent callers share the check. */
function getTrustedNative(): Promise<NativePbkdf2Module | null> {
  trustedNative ??= (async () => {
    const native = loadNativeModule();
    if (!native) {
      devLog('pbkdf2', 'native module unavailable; using JS');
      return null;
    }
    if (!(await passesKnownAnswers(native))) {
      devLog('pbkdf2', 'native known-answer test failed; using JS');
      return null;
    }
    return native;
  })();
  return trustedNative;
}

/** The existing pure-JS implementation (@noble/hashes). Kept as the reference and the fallback. */
export function jsPbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, keyLength: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: keyLength, asyncTick: KDF_ASYNC_TICK_MS });
}

async function nativePbkdf2Sha256(
  native: NativePbkdf2Module,
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  keyLength: number,
): Promise<Uint8Array> {
  const derived = decodeBase64(await native.pbkdf2Sha256(encodeBase64(password), encodeBase64(salt), iterations, keyLength));
  if (derived.length !== keyLength) throw new Error('Native PBKDF2 returned the wrong key length.');
  return derived;
}

function shouldLogTiming(): boolean {
  return __DEV__ || process.env.EXPO_PUBLIC_KDF_TIMING === '1';
}

function logTiming(implementation: Pbkdf2Implementation, iterations: number, startedAt: number) {
  if (!shouldLogTiming()) return;
  // Never logs the password, salt or key.
  console.log(`[pbkdf2] ${implementation} ${iterations} iterations: ${Math.round(Date.now() - startedAt)}ms`);
}

/**
 * PBKDF2-HMAC-SHA256 of the UTF-8 bytes of `password` — exactly what
 * `pbkdf2Async(sha256, password, ...)` derives for a string (noble encodes it
 * with TextEncoder too). Callers apply any version-specific normalization
 * before calling.
 */
export async function pbkdf2Sha256(password: string, salt: Uint8Array, iterations: number, keyLength: number): Promise<Uint8Array> {
  const passwordBytes = new TextEncoder().encode(password);
  try {
    const native = await getTrustedNative();
    if (native) {
      const startedAt = Date.now();
      try {
        const derived = await nativePbkdf2Sha256(native, passwordBytes, salt, iterations, keyLength);
        logTiming('native', iterations, startedAt);
        return derived;
      } catch {
        devLog('pbkdf2', 'native derivation failed; using JS for this call');
      }
    }
    const startedAt = Date.now();
    const derived = await jsPbkdf2Sha256(passwordBytes, salt, iterations, keyLength);
    logTiming('js', iterations, startedAt);
    return derived;
  } finally {
    passwordBytes.fill(0);
  }
}

/** Which implementation pbkdf2Sha256 will use on this device (runs the known-answer test if it hasn't run yet). */
export async function getPbkdf2Implementation(): Promise<Pbkdf2Implementation> {
  return (await getTrustedNative()) ? 'native' : 'js';
}

export type Pbkdf2Benchmark = { iterations: number; jsMs: number; nativeMs: number | null; identical: boolean | null };

/**
 * Development/testing aid: derives the same key with both implementations
 * (fixed fixture password and salt, the given iteration count) and reports
 * timings and whether the outputs match. Not called by the app; invoke it
 * from a dev build to compare on a real device. Note the JS figure is from
 * whatever mode the bundle runs in (dev bundles are slower than release).
 */
export async function benchmarkPbkdf2(iterations: number, keyLength = 32): Promise<Pbkdf2Benchmark> {
  const password = new TextEncoder().encode('benchmark sync password');
  const salt = Uint8Array.from({ length: 16 }, (_, i) => (i * 37) & 0xff);

  let startedAt = Date.now();
  const js = await jsPbkdf2Sha256(password, salt, iterations, keyLength);
  const jsMs = Date.now() - startedAt;

  const native = await getTrustedNative();
  if (!native) return { iterations, jsMs, nativeMs: null, identical: null };
  startedAt = Date.now();
  const fromNative = await nativePbkdf2Sha256(native, password, salt, iterations, keyLength);
  const nativeMs = Date.now() - startedAt;
  const result = { iterations, jsMs, nativeMs, identical: encodeBase64(js) === encodeBase64(fromNative) };
  console.log('[pbkdf2] benchmark', result);
  return result;
}

/** Tests only: replace the native module (null = absent) and forget the cached known-answer result. `undefined` restores the real lookup. */
export function setNativePbkdf2ModuleForTesting(module: NativePbkdf2Module | null | undefined) {
  nativeOverride = module;
  trustedNative = null;
}
