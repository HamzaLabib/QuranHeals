import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(resolve(__dirname, '../src/app/index.tsx'), 'utf-8');
const ayahExperienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');
const syncApiSource = readFileSync(resolve(__dirname, '../src/sync/syncApi.ts'), 'utf-8');

describe('Home screen (emotions): background/resume reliability (Part 4)', () => {
  it('revalidates on AppState foreground, not just on mount', () => {
    expect(indexSource).toMatch(/AppState\.addEventListener\('change'/);
    expect(indexSource).toMatch(/nextState !== 'active'/);
  });

  it('throttles foreground revalidation instead of refetching on every brief background/foreground', () => {
    expect(indexSource).toMatch(/FOREGROUND_REVALIDATE_AFTER_MS/);
    expect(indexSource).toMatch(/elapsed < FOREGROUND_REVALIDATE_AFTER_MS/);
  });

  it('guards against a duplicate/overlapping fetch (mount + foreground racing)', () => {
    expect(indexSource).toMatch(/isFetchingRef\.current/);
  });

  it('reads a local cache first and writes a successful response back to it', () => {
    expect(indexSource).toMatch(/getCachedEmotions/);
    expect(indexSource).toMatch(/setCachedEmotions/);
  });

  it('wraps the network call in the shared bounded retry helper', () => {
    expect(indexSource).toMatch(/withRetry\(\(\) => getEmotions\(\)\)/);
  });

  it('never clears already-displayed emotions just because a (background) request failed', () => {
    // The only place setEmotions([]) could hide is a literal call with an
    // empty array — this must never appear anywhere in the file.
    expect(indexSource).not.toMatch(/setEmotions\(\[\]\)/);
    // The error branch must be gated on there being no data to show yet.
    expect(indexSource).toMatch(/if \(emotionsRef\.current\.length === 0\) \{\s*setErrorMessage/);
  });

  it('a silent (background) revalidation never flips on the blocking loading state', () => {
    const silentBlock = indexSource.match(/if \(!silent\) \{[\s\S]*?\}/)?.[0] ?? '';
    expect(silentBlock).toMatch(/setIsLoading/);
    expect(silentBlock).toMatch(/setErrorMessage\(null\)/);
  });
});

describe('Ayah loading: bounded retry for a transient backend/network failure (Part 4)', () => {
  it('wraps the ayah fetch in the shared bounded retry helper', () => {
    // The callback is `async` (not a plain arrow returning a promise)
    // because general mode's selection/content-load are two separate
    // awaits inside it — see AyahExperience's resolveGeneralVerseKey doc
    // comment — but it's still the exact same shared withRetry helper.
    expect(ayahExperienceSource).toMatch(/withRetry\(async \(\) =>/);
  });

  it('still exposes the existing manual retry action once retries are exhausted', () => {
    expect(ayahExperienceSource).toMatch(/actionLabel=\{messages\.ayah\.retry\}/);
    expect(ayahExperienceSource).toMatch(/onAction=\{loadAyah\}/);
  });
});

describe('Sync requests: single-flight 401 refresh + retry (Part 4)', () => {
  it('retries exactly once on a 401, never in a loop', () => {
    expect(syncApiSource).toMatch(/response\.status === 401/);
    // Exactly two call sites: the initial attempt and the single retry.
    expect(syncApiSource.match(/= await sendRequest\(/g)?.length).toBe(2);
  });

  it('imports the shared single-flight refresher rather than reimplementing refresh logic', () => {
    expect(syncApiSource).toMatch(/await import\('@\/auth\/tokenManager'\)/);
    expect(syncApiSource).toMatch(/refreshAccessToken/);
  });
});
