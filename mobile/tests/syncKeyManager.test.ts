import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WrappedMasterKey } from '@/crypto/reflectionEncryption';

vi.mock('@/crypto/randomBytes', () => ({ getRandomBytes: (n: number) => new Uint8Array(randomBytes(n)) }));

const cachedKeyStore = vi.hoisted(() => ({ value: null as string | null }));
vi.mock('@/auth/sessionStorage', () => ({
  getCachedMasterKey: vi.fn(async () => cachedKeyStore.value),
  setCachedMasterKey: vi.fn(async (key: string) => {
    cachedKeyStore.value = key;
  }),
  clearCachedMasterKey: vi.fn(async () => {
    cachedKeyStore.value = null;
  }),
}));

const cloudKeyStore = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('@/sync/syncApi', () => ({
  getCloudSyncKey: vi.fn(async () => cloudKeyStore.value),
  putCloudSyncKey: vi.fn(async (_token: string, key: unknown) => {
    cloudKeyStore.value = key;
    return key;
  }),
  replaceCloudSyncKey: vi.fn(async (_token: string, expected: unknown, key: unknown) => {
    if (JSON.stringify(cloudKeyStore.value) !== JSON.stringify(expected)) throw new Error('Conflict');
    cloudKeyStore.value = key;
    return key;
  }),
}));

const { ensureReflectionMasterKey, SyncPassphraseCancelledError } = await import('@/sync/syncKeyManager');
const { setCachedMasterKey } = await import('@/auth/sessionStorage');
const { putCloudSyncKey } = await import('@/sync/syncApi');
const { changeSyncPassword, verifySyncPassphrase } = await import('@/sync/syncKeyManager');
const { replaceCloudSyncKey, getCloudSyncKey } = await import('@/sync/syncApi');
const crypto = await import('@/crypto/reflectionEncryption');

afterEach(() => {
  cachedKeyStore.value = null;
  cloudKeyStore.value = null;
  vi.clearAllMocks();
});

describe('password change preserves envelope-encrypted reflections', { timeout: 20_000 }, () => {
  async function setup() {
    const key = await ensureReflectionMasterKey('token', async () => 'old-password', 'user-1');
    const reflection = crypto.encryptReflectionText('private reflection', key, (n) => new Uint8Array(randomBytes(n)));
    const previous = cloudKeyStore.value as WrappedMasterKey;
    return { key, reflection, previous };
  }

  it('verifies the current password and rewraps the same key with fresh values; only new password unlocks', async () => {
    const { reflection, previous } = await setup();
    const cachedBefore = cachedKeyStore.value;
    await changeSyncPassword('token', 'old-password', 'new-password');
    const saved = cloudKeyStore.value as WrappedMasterKey;
    expect(saved.salt).not.toBe(previous.salt);
    expect(saved.nonce).not.toBe(previous.nonce);
    expect(saved.kdfIterations).toBe(crypto.DEFAULT_KDF_ITERATIONS);
    const recovered = await crypto.unwrapMasterKey(saved, 'new-password');
    expect(crypto.decryptReflectionText(reflection, recovered)).toBe('private reflection');
    expect(await verifySyncPassphrase(saved, 'old-password')).toBe(false);
    expect(cachedKeyStore.value).toBe(cachedBefore);
    expect(replaceCloudSyncKey).toHaveBeenCalledWith('token', previous, saved);
  });

  it('wrong current password cannot write anything', async () => {
    const { previous } = await setup();
    await expect(changeSyncPassword('token', 'wrong', 'new-password')).rejects.toThrow();
    expect(cloudKeyStore.value).toEqual(previous);
    expect(replaceCloudSyncKey).not.toHaveBeenCalled();
  });

  it.each(['short', 'a'.repeat(33), 'old-password'])('rejects invalid new password %s before writing', async (next) => {
    await setup();
    await expect(changeSyncPassword('token', 'old-password', next)).rejects.toThrow();
    expect(replaceCloudSyncKey).not.toHaveBeenCalled();
  });

  it('a failed save preserves the old wrapper and its decryptable data', async () => {
    const { previous, reflection } = await setup();
    vi.mocked(replaceCloudSyncKey).mockRejectedValueOnce(new Error('Offline'));
    await expect(changeSyncPassword('token', 'old-password', 'new-password')).rejects.toThrow('Offline');
    expect(cloudKeyStore.value).toEqual(previous);
    expect(crypto.decryptReflectionText(reflection, await crypto.unwrapMasterKey(previous, 'old-password'))).toBe('private reflection');
  });

  it('a failed re-encryption never attempts a save', async () => {
    const { previous } = await setup();
    vi.spyOn(crypto, 'wrapMasterKey').mockRejectedValueOnce(new Error('Encryption failed'));
    await expect(changeSyncPassword('token', 'old-password', 'new-password')).rejects.toThrow('Encryption failed');
    expect(replaceCloudSyncKey).not.toHaveBeenCalled();
    expect(cloudKeyStore.value).toEqual(previous);
  });

  it('confirms a committed replacement when its response was lost', async () => {
    await setup();
    vi.mocked(replaceCloudSyncKey).mockImplementationOnce(async (_token, _expected, replacement) => {
      cloudKeyStore.value = replacement;
      throw new Error('Response lost');
    });
    await expect(changeSyncPassword('token', 'old-password', 'new-password')).resolves.toBeUndefined();
    expect(await verifySyncPassphrase(cloudKeyStore.value as WrappedMasterKey, 'new-password')).toBe(true);
  });

  it('a concurrent change wins without being rolled back', async () => {
    const { key } = await setup();
    const concurrent = await crypto.wrapMasterKey(key, 'other-password', (n) => new Uint8Array(randomBytes(n)), 100);
    vi.mocked(replaceCloudSyncKey).mockImplementationOnce(async () => {
      cloudKeyStore.value = concurrent;
      throw new Error('Conflict');
    });
    await expect(changeSyncPassword('token', 'old-password', 'new-password')).rejects.toThrow('Conflict');
    expect(cloudKeyStore.value).toEqual(concurrent);
    expect(getCloudSyncKey).toHaveBeenCalled();
  });
});

describe('ensureReflectionMasterKey', () => {
  it('returns the cached key without prompting when one is already cached on this device', async () => {
    const masterKey = new Uint8Array(32).fill(7);
    const { encodeBase64 } = await import('@/crypto/base64');
    cachedKeyStore.value = encodeBase64(masterKey);
    // The account's current cloud key is this same master key.
    cloudKeyStore.value = { ...(await crypto.wrapMasterKey(masterKey, 'any password', (n) => new Uint8Array(randomBytes(n)), 1000)), keyFingerprint: crypto.masterKeyFingerprint(masterKey) };
    const prompt = vi.fn();

    const result = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(prompt).not.toHaveBeenCalled();
    expect(Array.from(result)).toEqual(Array.from(masterKey));
  });

  it('on the first device to enable sync (no cloud key yet), generates a new key, prompts to CREATE a passphrase, and uploads only the wrapped key', async () => {
    const prompt = vi.fn(async (mode: string) => {
      expect(mode).toBe('create');
      return 'a strong passphrase';
    });

    const masterKey = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(masterKey).toHaveLength(32);
    expect(putCloudSyncKey).toHaveBeenCalledTimes(1);
    const uploaded = vi.mocked(putCloudSyncKey).mock.calls[0][1] as { wrappedKey: string };
    // The uploaded blob must not contain the raw master key or passphrase.
    const { encodeBase64 } = await import('@/crypto/base64');
    expect(uploaded.wrappedKey).not.toBe(encodeBase64(masterKey));
    expect(setCachedMasterKey).toHaveBeenCalled();
  });

  it('on a second device (cloud key already exists), prompts to UNLOCK and recovers the same master key with the correct passphrase', async () => {
    const firstDevicePrompt = vi.fn(async () => 'shared passphrase');
    const masterKey = await ensureReflectionMasterKey('token', firstDevicePrompt, 'user-1');

    // Simulate a second device: no cached key locally, but the cloud key now exists.
    cachedKeyStore.value = null;
    const secondDevicePrompt = vi.fn(async (mode: string) => {
      expect(mode).toBe('unlock');
      return 'shared passphrase';
    });

    const recovered = await ensureReflectionMasterKey('token', secondDevicePrompt, 'user-1');
    expect(Array.from(recovered)).toEqual(Array.from(masterKey));
  });

  it('an incorrect passphrase on a second device fails to recover the key', async () => {
    await ensureReflectionMasterKey('token', async () => 'correct passphrase', 'user-1');
    cachedKeyStore.value = null;

    await expect(ensureReflectionMasterKey('token', async () => 'wrong passphrase', 'user-1')).rejects.toThrow();
  });

  it('propagates cancellation as SyncPassphraseCancelledError without caching or uploading anything', async () => {
    const prompt = vi.fn(async () => {
      throw new SyncPassphraseCancelledError('cancelled');
    });

    await expect(ensureReflectionMasterKey('token', prompt, 'user-1')).rejects.toBeInstanceOf(SyncPassphraseCancelledError);
    expect(setCachedMasterKey).not.toHaveBeenCalled();
    expect(putCloudSyncKey).not.toHaveBeenCalled();
  });
});

describe('the cached master key is bound to its account', { timeout: 20_000 }, () => {
  it("a key cached for account A is never returned for account B — B must unlock its own key", async () => {
    const { encodeBase64 } = await import('@/crypto/base64');
    const keyA = new Uint8Array(32).fill(0xa1);
    cachedKeyStore.value = JSON.stringify({ userId: 'user-A', key: encodeBase64(keyA) });
    const prompt = vi.fn(async () => 'B passphrase');

    const keyB = await ensureReflectionMasterKey('token-B', prompt, 'user-B');

    expect(prompt).toHaveBeenCalledWith('create');
    expect(Array.from(keyB)).not.toEqual(Array.from(keyA));
    expect(JSON.parse(cachedKeyStore.value!)).toMatchObject({ userId: 'user-B' });
  });

  it('a newly cached key records the account it belongs to and is reused for that same account without a prompt', async () => {
    const created = await ensureReflectionMasterKey('token', async () => 'a strong passphrase', 'user-1');
    expect(JSON.parse(cachedKeyStore.value!)).toMatchObject({ userId: 'user-1' });

    const prompt = vi.fn();
    const reused = await ensureReflectionMasterKey('token', prompt, 'user-1');

    expect(prompt).not.toHaveBeenCalled();
    expect(Array.from(reused)).toEqual(Array.from(created));
  });

  it('a bare key cached by the previous version is accepted once for the signed-in account and rebound to it', async () => {
    const { encodeBase64 } = await import('@/crypto/base64');
    const legacy = new Uint8Array(32).fill(9);
    cachedKeyStore.value = encodeBase64(legacy);
    // A cloud key from the previous version: no fingerprint, so it cannot be checked.
    cloudKeyStore.value = await crypto.wrapMasterKey(legacy, 'any password', (n) => new Uint8Array(randomBytes(n)), 1000);

    const result = await ensureReflectionMasterKey('token', vi.fn(), 'user-1');

    expect(Array.from(result)).toEqual(Array.from(legacy));
    expect(JSON.parse(cachedKeyStore.value!)).toEqual({ userId: 'user-1', key: encodeBase64(legacy) });
  });
});
