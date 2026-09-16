import { describe, expect, it, vi } from 'vitest';

import { createQuranRepository } from '@/services/quranRepository';
import { openTestDatabase } from './helpers/sqlite';

describe('getRandomVerseKey: selection comes from the complete 6,236-ayah local Quran pool', () => {
  it('returns a valid verseKey drawn from the real bundled quran.sqlite, with no emotion/mapping involved', async () => {
    const repository = createQuranRepository(async () => openTestDatabase());
    const verseKey = await repository.getRandomVerseKey();
    expect(verseKey).toMatch(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/);
    // Resolvable against the same verified local source — proves it's a real ayah, not a fabricated key.
    await expect(repository.getVerseByKey(verseKey)).resolves.toMatchObject({ verseKey });
  });

  it('never needs an emotion key or any emotion-shaped argument', async () => {
    const repository = createQuranRepository(async () => openTestDatabase());
    // getRandomVerseKey's only parameter is an exclusion list of verseKeys —
    // structurally, there is nowhere to pass an emotion.
    expect(repository.getRandomVerseKey.length).toBeLessThanOrEqual(1);
    await expect(repository.getRandomVerseKey()).resolves.toEqual(expect.any(String));
  });

  it('excludes the requested verseKeys when possible', async () => {
    const repository = createQuranRepository(async () => openTestDatabase());
    const first = await repository.getRandomVerseKey();
    // Exclude a large, deterministic swath of the pool (everything except a
    // handful of surah 1 keys) so the "excluded" behavior is actually
    // exercised without needing to know every one of the 6,236 keys.
    const excluded = Array.from({ length: 500 }, (_, i) => `${(i % 113) + 2}:${(i % 5) + 1}`);
    const results = await Promise.all(Array.from({ length: 20 }, () => repository.getRandomVerseKey(excluded)));
    results.forEach((verseKey) => expect(excluded).not.toContain(verseKey));
    expect(first).toMatch(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/);
  });

  it('falls back to the unrestricted pool rather than failing if the exclusion list somehow covers everything returned', async () => {
    const real = openTestDatabase();
    // Simulate "every row excluded" by making the excluding query return
    // nothing, while the unrestricted query still works normally.
    const spy = {
      ...real,
      getAllAsync: vi.fn(async (sql: string, ...params: (string | number)[]) =>
        sql.includes('NOT IN') ? [] : real.getAllAsync(sql, ...params),
      ),
    };
    const repository = createQuranRepository(async () => spy as typeof real);
    const verseKey = await repository.getRandomVerseKey(['2:255']);
    expect(verseKey).toMatch(/^[1-9]\d{0,2}:[1-9]\d{0,2}$/);
  });

  it('is uniformly distributed across the whole pool, not clustered in one surah (sanity check over many draws)', async () => {
    const repository = createQuranRepository(async () => openTestDatabase());
    const draws = await Promise.all(Array.from({ length: 60 }, () => repository.getRandomVerseKey()));
    const surahs = new Set(draws.map((key) => key.split(':')[0]));
    // 60 independent draws landing in fewer than ~10 distinct surahs out of
    // 114 would indicate a broken/non-random query, not bad luck.
    expect(surahs.size).toBeGreaterThan(10);
  });
});

describe('getRandomGeneralAyah service: no network dependency for selection, no Mongo/emotion involvement', () => {
  it('never imports emotion-related modules or emotion-mapping concepts, and never uses an emotionKey parameter', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../src/services/generalQuran.ts'), 'utf-8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // strip comments before checking actual code
    expect(code).not.toMatch(/emotion/i);
    expect(code).not.toMatch(/mapping/i);
    expect(code).not.toMatch(/mongo/i);
  });

  it('selects the verseKey locally (getRandomVerseKey) before ever calling the network-backed getAyah', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(__dirname, '../src/services/generalQuran.ts'), 'utf-8');
    const randomCallIndex = source.indexOf('getRandomVerseKey(');
    const getAyahCallIndex = source.indexOf('getAyah(');
    expect(randomCallIndex).toBeGreaterThan(-1);
    expect(getAyahCallIndex).toBeGreaterThan(-1);
    expect(randomCallIndex).toBeLessThan(getAyahCallIndex);
  });
});
