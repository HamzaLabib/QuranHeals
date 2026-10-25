import { pbkdf2Sha256 } from './pbkdf2';
import { DEFAULT_KDF_ITERATIONS, MASTER_KEY_LENGTH_BYTES, SALT_LENGTH_BYTES } from './reflectionEncryption';

/**
 * DEVELOPER TOOL (development builds only): measures sync-password key derivation on this device at the shipped work
 * factor and at OWASP's 600,000 for PBKDF2-HMAC-SHA256, for the device benchmark that gates raising
 * DEFAULT_KDF_ITERATIONS (reflectionEncryption.ts; docs/release-device-checklist.md, section E). Start Metro with
 * EXPO_PUBLIC_KDF_BENCHMARK=1; each run logs "[pbkdf2] native|js <n> iterations: <ms>ms" (pbkdf2.ts) to the Metro
 * terminal. A fixed throwaway password and salt: nothing is stored, sent or compared, and no user key is touched.
 */
export const BENCHMARK_ITERATIONS: readonly number[] = [DEFAULT_KDF_ITERATIONS, 600_000];

export async function runKdfBenchmark(derive: typeof pbkdf2Sha256 = pbkdf2Sha256, rounds = 3): Promise<void> {
  const salt = new Uint8Array(SALT_LENGTH_BYTES).fill(7);
  for (let round = 0; round < rounds; round++) {
    for (const iterations of BENCHMARK_ITERATIONS) await derive('benchmark-only-not-a-password', salt, iterations, MASTER_KEY_LENGTH_BYTES);
  }
}

/** Runs once when asked for; never in a release build (Metro drops the branch with `__DEV__`). */
export function runKdfBenchmarkIfRequested(): void {
  if (__DEV__ && process.env.EXPO_PUBLIC_KDF_BENCHMARK === '1') void runKdfBenchmark().catch(() => undefined);
}
