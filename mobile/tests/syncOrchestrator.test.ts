import { afterEach, describe, expect, it, vi } from 'vitest';

const callOrder: string[] = [];

vi.mock('@/sync/preferencesSync', () => ({
  syncPreferences: vi.fn(async () => {
    callOrder.push('preferences');
  }),
}));

vi.mock('@/sync/favoritesSync', () => ({
  syncFavorites: vi.fn(async () => {
    callOrder.push('favorites');
  }),
}));

const syncReading = vi.fn(async () => {
  callOrder.push('reading');
  return true;
});
vi.mock('@/sync/readingSync', () => ({ syncReading: (...args: unknown[]) => (syncReading as (...a: unknown[]) => Promise<boolean>)(...args) }));

vi.mock('@/sync/reflectionsSync', () => ({
  syncReflections: vi.fn(async () => {
    callOrder.push('reflections');
  }),
}));

class MockSyncPassphraseCancelledError extends Error {}

const ensureReflectionMasterKey = vi.fn();
vi.mock('@/sync/syncKeyManager', () => ({
  SyncPassphraseCancelledError: MockSyncPassphraseCancelledError,
  ensureReflectionMasterKey: (...args: unknown[]) => {
    callOrder.push('passphrase-gate');
    return ensureReflectionMasterKey(...args);
  },
}));

const { runFullSync } = await import('@/sync/syncOrchestrator');
const { SyncPassphraseCancelledError } = await import('@/sync/syncKeyManager');
const { syncFavorites } = await import('@/sync/favoritesSync');
const { syncReflections } = await import('@/sync/reflectionsSync');

afterEach(() => {
  callOrder.length = 0;
  vi.clearAllMocks();
});

function baseOptions(promptForPassphrase: () => Promise<string>) {
  return {
    ownerUserId: 'user-1',
    applyPreference: () => {},
    promptForPassphrase,
  };
}

describe('runFullSync: the mandatory Sync Password gates favorites AND reflections', () => {
  it('resolves the password step before favorites or reflections ever sync — never after', async () => {
    ensureReflectionMasterKey.mockResolvedValue(new Uint8Array(32));

    const result = await runFullSync('token', baseOptions(async () => 'irrelevant'));

    expect(callOrder).toEqual(['preferences', 'reading', 'passphrase-gate', 'favorites', 'reflections']);
    expect(result).toEqual({ favoritesSynced: true, preferencesSynced: true, reflectionsSynced: true, readingSynced: true });
    // أورادي وختماتي: the session and this account only — no master key.
    expect(syncReading).toHaveBeenCalledWith('token', 'user-1', expect.objectContaining({ isCurrent: expect.any(Function) }));
  });

  it('if the mandatory step is not completed (user signs out instead), favorites and reflections never sync', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new SyncPassphraseCancelledError('Signed out during the mandatory sync password step.'));

    const result = await runFullSync('token', baseOptions(async () => 'unused'));

    expect(callOrder).toEqual(['preferences', 'reading', 'passphrase-gate']);
    expect(syncFavorites).not.toHaveBeenCalled();
    expect(syncReflections).not.toHaveBeenCalled();
    // أورادي وختماتي never wait for, or depend on, the Sync Password.
    expect(result).toEqual({ favoritesSynced: false, preferencesSynced: true, reflectionsSynced: false, readingSynced: true });
  });

  it('preferences sync is unaffected by the password gate (not sensitive, not mentioned in the Sync Password copy)', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new SyncPassphraseCancelledError('cancelled'));
    const result = await runFullSync('token', baseOptions(async () => 'unused'));
    expect(result.preferencesSynced).toBe(true);
  });

  it('a failed أورادي وختماتي sync never blocks reflections, and is reported as not synced (so the session retries)', async () => {
    ensureReflectionMasterKey.mockResolvedValue(new Uint8Array(32));
    syncReading.mockRejectedValueOnce(new Error('offline'));
    const result = await runFullSync('token', baseOptions(async () => 'irrelevant'));
    expect(callOrder).toEqual(['preferences', 'passphrase-gate', 'favorites', 'reflections']);
    expect(result).toEqual({ favoritesSynced: true, preferencesSynced: true, reflectionsSynced: true, readingSynced: false });
  });

  it('أورادي وختماتي sync even while the Sync Password prompt is still open (reflections locked)', async () => {
    let unlock: (key: Uint8Array) => void = () => {};
    ensureReflectionMasterKey.mockImplementation(() => new Promise<Uint8Array>((resolve) => { unlock = resolve; }));
    const pending = runFullSync('token', baseOptions(async () => 'irrelevant'));
    await new Promise((done) => setTimeout(done, 0));
    expect(callOrder).toEqual(['preferences', 'reading', 'passphrase-gate']);
    expect(syncReading).toHaveBeenCalledTimes(1);
    unlock(new Uint8Array(32));
    await pending;
  });

  it('a genuine (non-cancellation) error from the password step still propagates, not swallowed', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new Error('unexpected crypto failure'));
    await expect(runFullSync('token', baseOptions(async () => 'unused'))).rejects.toThrow('unexpected crypto failure');
    expect(syncFavorites).not.toHaveBeenCalled();
  });
});
