import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
}));

const { ensureReflectionMasterKey, SyncPassphraseCancelledError } = await import('@/sync/syncKeyManager');
const { setCachedMasterKey } = await import('@/auth/sessionStorage');
const { putCloudSyncKey } = await import('@/sync/syncApi');

afterEach(() => {
  cachedKeyStore.value = null;
  cloudKeyStore.value = null;
  vi.clearAllMocks();
});

describe('ensureReflectionMasterKey', () => {
  it('returns the cached key without prompting when one is already cached on this device', async () => {
    const masterKey = new Uint8Array(32).fill(7);
    const { encodeBase64 } = await import('@/crypto/base64');
    cachedKeyStore.value = encodeBase64(masterKey);
    const prompt = vi.fn();

    const result = await ensureReflectionMasterKey('token', prompt);

    expect(prompt).not.toHaveBeenCalled();
    expect(Array.from(result)).toEqual(Array.from(masterKey));
  });

  it('on the first device to enable sync (no cloud key yet), generates a new key, prompts to CREATE a passphrase, and uploads only the wrapped key', async () => {
    const prompt = vi.fn(async (mode: string) => {
      expect(mode).toBe('create');
      return 'a strong passphrase';
    });

    const masterKey = await ensureReflectionMasterKey('token', prompt);

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
    const masterKey = await ensureReflectionMasterKey('token', firstDevicePrompt);

    // Simulate a second device: no cached key locally, but the cloud key now exists.
    cachedKeyStore.value = null;
    const secondDevicePrompt = vi.fn(async (mode: string) => {
      expect(mode).toBe('unlock');
      return 'shared passphrase';
    });

    const recovered = await ensureReflectionMasterKey('token', secondDevicePrompt);
    expect(Array.from(recovered)).toEqual(Array.from(masterKey));
  });

  it('an incorrect passphrase on a second device fails to recover the key', async () => {
    await ensureReflectionMasterKey('token', async () => 'correct passphrase');
    cachedKeyStore.value = null;

    await expect(ensureReflectionMasterKey('token', async () => 'wrong passphrase')).rejects.toThrow();
  });

  it('propagates cancellation as SyncPassphraseCancelledError without caching or uploading anything', async () => {
    const prompt = vi.fn(async () => {
      throw new SyncPassphraseCancelledError('cancelled');
    });

    await expect(ensureReflectionMasterKey('token', prompt)).rejects.toBeInstanceOf(SyncPassphraseCancelledError);
    expect(setCachedMasterKey).not.toHaveBeenCalled();
    expect(putCloudSyncKey).not.toHaveBeenCalled();
  });
});
