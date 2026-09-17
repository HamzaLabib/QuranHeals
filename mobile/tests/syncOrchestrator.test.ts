import { afterEach, describe, expect, it, vi } from 'vitest';

const callOrder: string[] = [];

vi.mock('@/sync/preferencesSync', () => ({
  reconcilePreferencesOnSignIn: vi.fn(async () => {
    callOrder.push('preferences');
  }),
}));

vi.mock('@/sync/favoritesSync', () => ({
  syncFavorites: vi.fn(async () => {
    callOrder.push('favorites');
  }),
}));

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
    local: { locale: 'en' as const, translationDisplayMode: 'always' as const, translationId: 'pickthall' },
    applyPreferencesLocally: () => {},
    promptForPassphrase,
  };
}

describe('runFullSync: the mandatory Sync Password gates favorites AND reflections', () => {
  it('resolves the password step before favorites or reflections ever sync — never after', async () => {
    ensureReflectionMasterKey.mockResolvedValue(new Uint8Array(32));

    const result = await runFullSync('token', baseOptions(async () => 'irrelevant'));

    expect(callOrder).toEqual(['preferences', 'passphrase-gate', 'favorites', 'reflections']);
    expect(result).toEqual({ favoritesSynced: true, preferencesSynced: true, reflectionsSynced: true });
  });

  it('if the mandatory step is not completed (user signs out instead), favorites and reflections never sync', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new SyncPassphraseCancelledError('Signed out during the mandatory sync password step.'));

    const result = await runFullSync('token', baseOptions(async () => 'unused'));

    expect(callOrder).toEqual(['preferences', 'passphrase-gate']);
    expect(syncFavorites).not.toHaveBeenCalled();
    expect(syncReflections).not.toHaveBeenCalled();
    expect(result).toEqual({ favoritesSynced: false, preferencesSynced: true, reflectionsSynced: false });
  });

  it('preferences sync is unaffected by the password gate (not sensitive, not mentioned in the Sync Password copy)', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new SyncPassphraseCancelledError('cancelled'));
    const result = await runFullSync('token', baseOptions(async () => 'unused'));
    expect(result.preferencesSynced).toBe(true);
  });

  it('a genuine (non-cancellation) error from the password step still propagates, not swallowed', async () => {
    ensureReflectionMasterKey.mockRejectedValue(new Error('unexpected crypto failure'));
    await expect(runFullSync('token', baseOptions(async () => 'unused'))).rejects.toThrow('unexpected crypto failure');
    expect(syncFavorites).not.toHaveBeenCalled();
  });
});
