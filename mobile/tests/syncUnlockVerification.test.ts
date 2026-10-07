import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WrappedMasterKey } from '@/crypto/reflectionEncryption';

/**
 * The unlock step's password check must do the real work (KDF + AEAD
 * decryption of the account's wrapped key) exactly once per distinct
 * password, and that same unwrap must serve Continue, with no second KDF,
 * while existing wrapped keys and reflections stay readable.
 */
const unwrapCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/crypto/reflectionEncryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/crypto/reflectionEncryption')>();
  return {
    ...actual,
    unwrapMasterKey: (...args: Parameters<typeof actual.unwrapMasterKey>) => {
      unwrapCalls.count++;
      return actual.unwrapMasterKey(...args);
    },
  };
});
vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));
const cachedKeyStore = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/auth/sessionStorage', () => ({
  getCachedMasterKey: vi.fn(async () => cachedKeyStore.value),
  setCachedMasterKey: vi.fn(async (key: string) => { cachedKeyStore.value = key; }),
  clearCachedMasterKey: vi.fn(async () => { cachedKeyStore.value = null; }),
}));
const cloudKeyStore = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/sync/syncApi', () => ({ getCloudSyncKey: vi.fn(async () => cloudKeyStore.value) }));

const crypto = await import('@/crypto/reflectionEncryption');
const { createPassphraseVerifier, ensureReflectionMasterKey, SyncPassphraseCancelledError } = await import('@/sync/syncKeyManager');

const random = (n: number) => new Uint8Array(randomBytes(n));
const ITERATIONS = 1000; // Fast tests; the iteration count is read from each wrapped key.

async function account(password: string) {
  const masterKey = crypto.generateMasterKey(random);
  const wrapped: WrappedMasterKey = { ...(await crypto.wrapMasterKey(masterKey, password, random, ITERATIONS)), keyFingerprint: crypto.masterKeyFingerprint(masterKey) };
  return { masterKey, wrapped };
}

afterEach(() => {
  unwrapCalls.count = 0;
  cachedKeyStore.value = null;
  cloudKeyStore.value = null;
});

describe('createPassphraseVerifier', () => {
  it('rejects a wrong password and accepts the right one by actually decrypting the wrapped key', async () => {
    const { masterKey, wrapped } = await account('right password');
    const verifier = createPassphraseVerifier(wrapped);
    expect(await verifier.verify('wrong password')).toBe(false);
    expect(await verifier.verify('right password')).toBe(true);
    expect(Array.from(await verifier.unwrap('right password'))).toEqual(Array.from(masterKey));
    await expect(verifier.unwrap('wrong password')).rejects.toThrow();
  });

  it('derives once per distinct password: concurrent checks share it and Continue reuses it', async () => {
    const { wrapped } = await account('right password');
    const verifier = createPassphraseVerifier(wrapped);
    expect(await Promise.all([verifier.verify('right password'), verifier.verify('right password')])).toEqual([true, true]);
    await verifier.unwrap('right password');
    expect(unwrapCalls.count).toBe(1);
  });

  it('hands out a copy that outlives dispose(), which wipes the kept key', async () => {
    const { masterKey, wrapped } = await account('right password');
    const verifier = createPassphraseVerifier(wrapped);
    const key = await verifier.unwrap('right password');
    verifier.dispose();
    await Promise.resolve();
    expect(Array.from(key)).toEqual(Array.from(masterKey));
  });
});

describe('unlock through ensureReflectionMasterKey', () => {
  it('a verified password unlocks with a single KDF, and existing reflections still decrypt', async () => {
    const { masterKey, wrapped } = await account('shared password');
    const reflection = crypto.encryptReflectionText('an existing reflection', masterKey, random);
    cloudKeyStore.value = wrapped;
    const prompt = vi.fn(async (_mode: string, verify?: (value: string) => Promise<boolean>) => {
      expect(await verify!('shared password')).toBe(true);
      return 'shared password';
    });

    const recovered = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(unwrapCalls.count).toBe(1);
    expect(Array.from(recovered)).toEqual(Array.from(masterKey));
    expect(crypto.decryptReflectionText(reflection, recovered)).toBe('an existing reflection');
    expect(JSON.parse(cachedKeyStore.value!).userId).toBe('user-1');
  });

  it('a wrong attempt never enables anything and costs no extra KDF on Continue', async () => {
    const { masterKey, wrapped } = await account('shared password');
    cloudKeyStore.value = wrapped;
    const recovered = await ensureReflectionMasterKey('token', async (_mode, verify) => {
      expect(await verify!('typo password')).toBe(false);
      expect(await verify!('shared password')).toBe(true);
      return 'shared password';
    }, 'user-1');
    expect(unwrapCalls.count).toBe(2);
    expect(Array.from(recovered)).toEqual(Array.from(masterKey));
  });

  it('still refuses a submitted password that is wrong, verified or not', async () => {
    const { wrapped } = await account('shared password');
    cloudKeyStore.value = wrapped;
    await expect(ensureReflectionMasterKey('token', async () => 'wrong password', 'user-1')).rejects.toThrow();
    expect(cachedKeyStore.value).toBeNull();
  });

  it('keeps unlocking legacy version-1 wrapped keys (NFKC-normalized passwords)', async () => {
    const masterKey = crypto.generateMasterKey(random);
    const legacy = { ...(await crypto.wrapMasterKey(masterKey, 'ﬁle password'.normalize('NFKC'), random, ITERATIONS)), encryptionVersion: 1 };
    cloudKeyStore.value = legacy;
    const recovered = await ensureReflectionMasterKey('token', async (_mode, verify) => {
      expect(await verify!('ﬁle password')).toBe(true);
      return 'ﬁle password';
    }, 'user-1');
    expect(Array.from(recovered)).toEqual(Array.from(masterKey));
  });
});

describe('KDF scheduling change', () => {
  it('derives exactly the standard PBKDF2-HMAC-SHA256 key, so existing wrapped keys are unaffected', async () => {
    const salt = random(crypto.SALT_LENGTH_BYTES);
    const derived = await crypto.derivePassphraseKey('a password', salt, ITERATIONS);
    expect(Buffer.from(derived).toString('hex')).toBe(pbkdf2Sync('a password', salt, ITERATIONS, 32, 'sha256').toString('hex'));
  });
});

describe('an unlock that completes after its session ended', () => {
  it('never caches the key: sign-out has just cleared it and it must stay cleared', async () => {
    const { wrapped } = await account('shared password');
    cloudKeyStore.value = wrapped;
    let current = true;
    const unlocking = ensureReflectionMasterKey('token', async () => {
      current = false; // signed out while the password was being entered
      return 'shared password';
    }, 'user-1', () => current);
    await expect(unlocking).rejects.toBeInstanceOf(SyncPassphraseCancelledError);
    expect(cachedKeyStore.value).toBeNull();
  });
});
