/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ bytes: new Uint8Array(), uri: '/assets/quran.sqlite' }));
const deserialize = vi.hoisted(() => vi.fn(async () => ({ testConnection: true })));
vi.mock('@/services/quranAssets', () => ({ bundledQuranAssets: { database: 1, notice: 2 } }));
vi.mock('expo-asset', () => ({ Asset: { fromModule: () => ({
  uri: fixture.uri, downloadAsync: async () => ({ localUri: 'file:///bundled/quran.sqlite' }),
}) } }));
vi.mock('expo-file-system', () => ({ File: class { async bytes() { return fixture.bytes; } } }));
vi.mock('expo-sqlite', () => ({ deserializeDatabaseAsync: deserialize }));
const native = await import('@/services/quranAsset');
const web = await import('@/services/quranAsset.web');
const original = new Uint8Array(readFileSync(new URL('../assets/quran/quran.sqlite', import.meta.url)));
beforeEach(() => {
  vi.clearAllMocks();
  fixture.bytes = original;
  fixture.uri = '/assets/quran.sqlite';
});
afterEach(() => vi.unstubAllGlobals());

it('native adapter sends exact bundled bytes to the private in-memory connection', async () => {
  await native.openBundledQuran();
  expect(deserialize).toHaveBeenCalledWith(original, { useNewConnection: true });
});

it('native adapter rejects a truncated asset before opening SQLite', async () => {
  fixture.bytes = original.subarray(1);
  await expect(native.openBundledQuran()).rejects.toMatchObject({ kind: 'integrity' });
  expect(deserialize).not.toHaveBeenCalled();
});

it('web adapter verifies the original hash before opening the shipped asset and caches only verified bytes', async () => {
  vi.stubGlobal('window', { crossOriginIsolated: true, location: { href: 'http://localhost:8083/favorites', origin: 'http://localhost:8083' } });
  const put = vi.fn(async () => undefined);
  vi.stubGlobal('caches', { open: async () => ({ match: async () => undefined, put }) });
  const fetch = vi.fn(async () => new Response(original));
  vi.stubGlobal('fetch', fetch);
  await web.openBundledQuran();
  expect(deserialize).toHaveBeenCalledWith(original, { useNewConnection: true });
  expect(put).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith('http://localhost:8083/assets/quran.sqlite', { credentials: 'same-origin' });
});

it('web adapter rejects corrupt cached bytes and foreign origins without an Arabic fallback', async () => {
  vi.stubGlobal('window', { crossOriginIsolated: true, location: { href: 'http://localhost:8083/', origin: 'http://localhost:8083' } });
  const corruptHeader = original.slice();
  corruptHeader[0] ^= 1; // Disposable header copy only; neither original file is touched.
  const remove = vi.fn(async () => true);
  vi.stubGlobal('caches', { open: async () => ({ match: async () => new Response(corruptHeader), delete: remove }) });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(web.openBundledQuran()).rejects.toMatchObject({ kind: 'integrity' });
  expect(remove).toHaveBeenCalledOnce();
  fixture.uri = 'https://example.invalid/quran.sqlite';
  await expect(web.openBundledQuran()).rejects.toMatchObject({ kind: 'integrity' });
  expect(deserialize).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
