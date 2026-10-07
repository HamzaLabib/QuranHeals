import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WrappedMasterKey } from '@/crypto/reflectionEncryption';

/**
 * Setting the sync password creates the account's one data key. These cover
 * the key manager's guarantees directly: one password step per account and
 * session, one key per setup however often the step is retried, and an
 * existing account key is never replaced.
 */
const counts = vi.hoisted(() => ({ generated: 0 }));
vi.mock('@/crypto/reflectionEncryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/reflectionEncryption')>();
  return {
    ...actual,
    generateMasterKey: (...args: Parameters<typeof actual.generateMasterKey>) => {
      counts.generated += 1;
      return actual.generateMasterKey(...args);
    },
    // Fast tests: the iteration count travels inside each wrapped key.
    wrapMasterKey: (masterKey: Uint8Array, passphrase: string, random: (n: number) => Uint8Array) => actual.wrapMasterKey(masterKey, passphrase, random, 1000),
  };
});
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
const cache = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/auth/sessionStorage', () => ({
  getCachedMasterKey: vi.fn(async () => cache.value),
  setCachedMasterKey: vi.fn(async (value: string) => { cache.value = value; }),
  clearCachedMasterKey: vi.fn(async () => { cache.value = null; }),
}));
vi.mock('@/storage/ayahReflections', () => ({ markAllReflectionsPending: vi.fn(async () => {}) }));
/** One account's server: stores only a first key, like backend/src/controllers/syncController.ts. */
const server = vi.hoisted(() => ({ key: null as unknown, puts: 0, failNextPut: null as null | 'lost' | 'unsent', getDelay: null as null | Promise<void> }));
vi.mock('@/sync/syncApi', () => ({
  getCloudSyncKey: vi.fn(async () => {
    const answer = server.key;
    if (server.getDelay) await server.getDelay;
    return answer;
  }),
  putCloudSyncKey: vi.fn(async (_token: string, key: unknown) => {
    server.puts += 1;
    const failure = server.failNextPut;
    server.failNextPut = null;
    if (failure === 'unsent') throw new Error('Network request failed');
    if (server.key) throw Object.assign(new Error('A sync key already exists for this account.'), { statusCode: 409 });
    server.key = key;
    if (failure === 'lost') throw new Error('Network request failed');
    return key;
  }),
}));

const crypto = await import('@/crypto/reflectionEncryption');
const { ensureReflectionMasterKey, discardUnfinishedKeySetup, SyncPassphraseCancelledError } = await import('@/sync/syncKeyManager');

const random = (n: number) => new Uint8Array(randomBytes(n));
type Prompt = Parameters<typeof ensureReflectionMasterKey>[1];
/** A password step that records which sheets were opened and answers each with `password`. */
function sheet(password = 'a new password') {
  const opened: string[] = [];
  const prompt: Prompt = vi.fn(async (mode) => {
    opened.push(mode);
    return password;
  });
  return { prompt, opened };
}

afterEach(() => {
  discardUnfinishedKeySetup();
  cache.value = null;
  server.key = null;
  server.puts = 0;
  server.failNextPut = null;
  server.getDelay = null;
  counts.generated = 0;
});

describe('setting the sync password', () => {
  it('asks once, stores one key, and the next syncs neither ask again nor make another key', async () => {
    const { prompt, opened } = sheet();
    const key = await ensureReflectionMasterKey('token', prompt, 'user-1');
    expect(await ensureReflectionMasterKey('token', prompt, 'user-1')).toEqual(key);
    expect(await ensureReflectionMasterKey('token', prompt, 'user-1')).toEqual(key);

    expect(opened).toEqual(['create']);
    expect(counts.generated).toBe(1);
    expect((server.key as WrappedMasterKey).keyFingerprint).toBe(crypto.masterKeyFingerprint(key));
  });

  it('simultaneous requests share one password step and one key', async () => {
    let answer!: (password: string) => void;
    const opened: string[] = [];
    const prompt: Prompt = (mode) => {
      opened.push(mode);
      return new Promise((resolve) => { answer = resolve; });
    };
    const requests = [1, 2, 3].map(() => ensureReflectionMasterKey('token', prompt, 'user-1'));
    await vi.waitFor(() => expect(opened).toEqual(['create']));
    answer('a new password');
    const keys = await Promise.all(requests);

    expect(new Set(keys).size).toBe(1);
    expect(opened).toEqual(['create']);
    expect(counts.generated).toBe(1);
    expect(server.puts).toBe(1);
  });

  it('a "no key yet" answer that arrives late (asked before setup finished) cannot start a second setup', async () => {
    let releaseLookup!: () => void;
    server.getDelay = new Promise((resolve) => { releaseLookup = resolve; });
    const { prompt, opened } = sheet();
    const first = ensureReflectionMasterKey('token', prompt, 'user-1');
    const second = ensureReflectionMasterKey('token', prompt, 'user-1'); // its lookup would also say "no key"
    releaseLookup();
    server.getDelay = null;

    expect(await second).toBe(await first);
    expect(opened).toEqual(['create']);
    expect(counts.generated).toBe(1);
  });

  it.each(['lost', 'unsent'] as const)('a %s upload completes with the SAME key, without asking again', async (failure) => {
    const { prompt, opened } = sheet('the password I set');
    server.failNextPut = failure;
    const first = ensureReflectionMasterKey('token', prompt, 'user-1');
    if (failure === 'lost') {
      // The server has it: confirmed by reading it back, in the same step.
      await first;
    } else {
      await expect(first).rejects.toThrow();
      expect(cache.value).toBeNull();
    }

    const key = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(opened).toEqual(['create']);
    expect(counts.generated).toBe(1);
    expect((server.key as WrappedMasterKey).keyFingerprint).toBe(crypto.masterKeyFingerprint(key));
    // What the server holds opens with the password the user set — reflections encrypted now stay readable.
    const reflection = crypto.encryptReflectionText('my reflection', key, random);
    const unwrapped = await crypto.unwrapMasterKey(server.key as WrappedMasterKey, 'the password I set');
    expect(crypto.decryptReflectionText(reflection, unwrapped)).toBe('my reflection');
  });

  it('never replaces a key another device stored first: the unfinished setup is dropped and that key is unlocked instead', async () => {
    const { prompt, opened } = sheet('my password');
    server.failNextPut = 'unsent';
    await expect(ensureReflectionMasterKey('token', prompt, 'user-1')).rejects.toThrow();
    const otherDeviceKey = crypto.generateMasterKey(random);
    const otherDeviceRecord = { ...(await crypto.wrapMasterKey(otherDeviceKey, 'my password', random)), keyFingerprint: crypto.masterKeyFingerprint(otherDeviceKey) };
    server.key = otherDeviceRecord;

    const key = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(opened).toEqual(['create', 'unlock']);
    expect(server.key).toBe(otherDeviceRecord);
    expect(Array.from(key)).toEqual(Array.from(otherDeviceKey));
  });

  it('after sign-out/sign-in with the key stored, the password is ENTERED, not set again', async () => {
    const { prompt } = sheet('my password');
    const key = await ensureReflectionMasterKey('token', prompt, 'user-1');
    cache.value = null; // sign-out clears the cached key

    const again = sheet('my password');
    expect(Array.from(await ensureReflectionMasterKey('token', again.prompt, 'user-1'))).toEqual(Array.from(key));
    expect(again.opened).toEqual(['unlock']);
    expect(counts.generated).toBe(1);
  });

  it("one account's unfinished setup is never used for another account", async () => {
    server.failNextPut = 'unsent';
    await expect(ensureReflectionMasterKey('token-1', sheet().prompt, 'user-1')).rejects.toThrow();
    const two = sheet('second account password');

    const keyTwo = await ensureReflectionMasterKey('token-2', two.prompt, 'user-2');

    expect(two.opened).toEqual(['create']);
    expect(counts.generated).toBe(2);
    expect(JSON.parse(cache.value!).userId).toBe('user-2');
    expect((server.key as WrappedMasterKey).keyFingerprint).toBe(crypto.masterKeyFingerprint(keyTwo));
  });

  it('a password step of an ended session stores nothing, and a new session never joins it', async () => {
    let current = true;
    let answer!: (password: string) => void;
    const opened: string[] = [];
    const prompt: Prompt = (mode) => {
      opened.push(mode);
      return new Promise((resolve) => { answer = resolve; });
    };
    const oldSession = ensureReflectionMasterKey('token', prompt, 'user-1', () => current);
    await vi.waitFor(() => expect(opened).toEqual(['create']));
    current = false; // signed out

    const newSession = sheet();
    const newKey = ensureReflectionMasterKey('token', newSession.prompt, 'user-1', () => true);
    answer('old password');

    await expect(oldSession).rejects.toBeInstanceOf(SyncPassphraseCancelledError);
    await newKey;
    expect(newSession.opened).toEqual(['create']);
    expect(server.puts).toBe(1);
    expect(counts.generated).toBe(1);
  });

  it('discardUnfinishedKeySetup (called at sign-out) wipes the unfinished key: it is never stored afterwards', async () => {
    server.failNextPut = 'unsent';
    await expect(ensureReflectionMasterKey('token', sheet().prompt, 'user-1')).rejects.toThrow();
    discardUnfinishedKeySetup();
    const again = sheet();
    await ensureReflectionMasterKey('token', again.prompt, 'user-1');
    expect(again.opened).toEqual(['create']);
    expect(counts.generated).toBe(2);
    expect(server.puts).toBe(2);
  });
});
