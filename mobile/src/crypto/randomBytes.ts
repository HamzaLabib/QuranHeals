import * as Crypto from 'expo-crypto';

import type { RandomBytesFn } from './reflectionEncryption';

/**
 * The only place expo-crypto is used for reflection encryption's randomness
 * (nonces, salts, the master key itself) — a CSPRNG, never Math.random().
 * Kept as a thin wrapper so mobile/src/crypto/reflectionEncryption.ts stays
 * dependency-free and unit-testable under plain Node (see
 * mobile/tests/reflectionEncryption.test.ts, which injects Node's own
 * crypto.randomBytes instead).
 */
export const getRandomBytes: RandomBytesFn = (length: number) => Crypto.getRandomBytes(length);
