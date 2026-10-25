import { beforeEach, describe, expect, it, vi } from 'vitest';

/** requestAppleCredential passes the backend's sign-in challenge to Apple only when there is one (authApi.ts). */
const signInAsync = vi.hoisted(() => vi.fn());
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-apple-authentication', () => ({
  signInAsync,
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const { requestAppleCredential } = await import('@/auth/appleAuth');

beforeEach(() => {
  signInAsync.mockReset().mockResolvedValue({ identityToken: 'id-token', authorizationCode: 'code' });
});

describe('Sign in with Apple: request binding', () => {
  it('sends the challenge as Apple\'s nonce', async () => {
    const nonce = 'b'.repeat(64);
    await expect(requestAppleCredential({ nonce })).resolves.toEqual({ identityToken: 'id-token', authorizationCode: 'code' });
    expect(signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1], nonce });
  });

  it('without a challenge, asks exactly as before (no nonce field at all)', async () => {
    await requestAppleCredential();
    expect(signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1] });
  });
});
