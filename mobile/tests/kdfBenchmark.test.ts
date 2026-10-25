import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { BENCHMARK_ITERATIONS, runKdfBenchmark, runKdfBenchmarkIfRequested } from '@/crypto/kdfBenchmark';
import { DEFAULT_KDF_ITERATIONS } from '@/crypto/reflectionEncryption';

/** The development-only work-factor benchmark (crypto/kdfBenchmark.ts): a developer tool, never part of a release. */
describe('sync-password work-factor benchmark (developer tool)', () => {
  it('derives a throwaway key at the shipped factor and at 600,000, round after round, and changes nothing', async () => {
    const derive = vi.fn(async (_password: string, _salt: Uint8Array, _iterations: number, _length: number) => new Uint8Array(32));
    await runKdfBenchmark(derive, 2);
    expect(BENCHMARK_ITERATIONS).toEqual([DEFAULT_KDF_ITERATIONS, 600_000]);
    expect(derive.mock.calls.map((c) => c[2])).toEqual([DEFAULT_KDF_ITERATIONS, 600_000, DEFAULT_KDF_ITERATIONS, 600_000]);
    expect(DEFAULT_KDF_ITERATIONS).toBe(210_000); // the shipped factor is unchanged until the benchmark is decided
  });

  it('does nothing in a release bundle, whatever the environment (vitest: __DEV__ false)', () => {
    vi.stubEnv('EXPO_PUBLIC_KDF_BENCHMARK', '1');
    expect(() => runKdfBenchmarkIfRequested()).not.toThrow();
    vi.unstubAllEnvs();
    const layout = readFileSync(join(__dirname, '..', 'src', 'app', '_layout.tsx'), 'utf8');
    // The guard Metro folds away in a release bundle, taking the module with it.
    expect(layout).toMatch(/if \(__DEV__ && startupReady && process\.env\.EXPO_PUBLIC_KDF_BENCHMARK === '1'\) \{\s*void import\('@\/crypto\/kdfBenchmark'\)/);
  });
});
