import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * useFreshProviderCredential (auth/reauthentication.ts): a fresh sign-in with
 * the signed-in account's own provider, for the forgotten-password reset.
 * The native Apple/Google modules are replaced; the hook's logic is real.
 */

const provider = vi.hoisted(() => ({
  appleSupported: true,
  appleCredential: vi.fn(),
  googleConfigured: true,
  googleRequest: {} as object | null,
  googlePrompt: vi.fn(),
  setGoogleResponse: (() => {}) as (response: unknown) => void,
}));

vi.mock('@/auth/appleAuth', () => {
  class AppleSignInCancelledError extends Error {}
  return {
    AppleSignInCancelledError,
    isAppleSignInSupportedPlatform: () => provider.appleSupported,
    requestAppleCredential: () => provider.appleCredential(),
  };
});
vi.mock('@/auth/googleAuth', async () => {
  const { useState } = await import('react');
  return {
    isGoogleAuthConfigured: () => provider.googleConfigured,
    useGoogleAuthRequest: () => {
      const [response, setResponse] = useState<unknown>(null);
      provider.setGoogleResponse = setResponse;
      return [provider.googleRequest, response, provider.googlePrompt];
    },
    extractGoogleIdToken: (response: { type?: string; params?: { id_token?: string } } | null) =>
      response?.type === 'success' && response.params?.id_token ? response.params.id_token : null,
    wasGoogleSignInCancelled: (response: { type?: string } | null) => response?.type === 'cancel' || response?.type === 'dismiss',
  };
});

import { AppleSignInCancelledError } from '@/auth/appleAuth';
import {
  ReauthenticationFailedError,
  ReauthenticationUnavailableError,
  useFreshProviderCredential,
  type ProviderCredential,
} from '@/auth/reauthentication';

let root: ReactTestRenderer | undefined;
let authenticate: () => Promise<ProviderCredential | null>;

function Probe({ accountProvider }: { accountProvider: 'apple' | 'google' | null }) {
  authenticate = useFreshProviderCredential(accountProvider);
  return null;
}

async function mount(accountProvider: 'apple' | 'google' | null) {
  await act(async () => { root = create(createElement(Probe, { accountProvider })); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  provider.appleSupported = true;
  provider.appleCredential.mockReset();
  provider.googleConfigured = true;
  provider.googleRequest = {};
  provider.googlePrompt.mockReset().mockResolvedValue({ type: 'opened' });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
});

describe('Apple account', () => {
  it('returns a fresh Apple ID token and authorization code — and never starts a Google sign-in', async () => {
    provider.appleCredential.mockResolvedValue({ identityToken: 'fresh-apple-token', authorizationCode: 'fresh-code' });
    await mount('apple');
    await expect(authenticate()).resolves.toEqual({ provider: 'apple', idToken: 'fresh-apple-token', authorizationCode: 'fresh-code' });
    expect(provider.googlePrompt).not.toHaveBeenCalled();
  });

  it('a dismissed Apple sheet resolves to null (nothing to reset with)', async () => {
    provider.appleCredential.mockRejectedValue(new AppleSignInCancelledError('cancelled'));
    await mount('apple');
    await expect(authenticate()).resolves.toBeNull();
  });

  it('any other Apple failure is a generic failure, never the provider\'s own error', async () => {
    provider.appleCredential.mockRejectedValue(new Error('AuthorizationError 1000: internal detail'));
    await mount('apple');
    const error = await authenticate().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ReauthenticationFailedError);
    expect((error as Error).message).not.toContain('internal detail');
  });

  it('is unavailable where Apple sign-in is not supported', async () => {
    provider.appleSupported = false;
    await mount('apple');
    await expect(authenticate()).rejects.toBeInstanceOf(ReauthenticationUnavailableError);
    expect(provider.appleCredential).not.toHaveBeenCalled();
  });
});

describe('Google account', () => {
  it('returns the fresh Google ID token from the completed sign-in — and never starts an Apple sign-in', async () => {
    await mount('google');
    let pending!: Promise<ProviderCredential | null>;
    await act(async () => { pending = authenticate(); pending.catch(() => {}); });
    expect(provider.googlePrompt).toHaveBeenCalledTimes(1);

    await act(async () => { provider.setGoogleResponse({ type: 'success', params: { id_token: 'fresh-google-token' } }); });

    await expect(pending).resolves.toEqual({ provider: 'google', idToken: 'fresh-google-token' });
    expect(provider.appleCredential).not.toHaveBeenCalled();
  });

  it('a dismissed Google sign-in resolves to null', async () => {
    await mount('google');
    let pending!: Promise<ProviderCredential | null>;
    await act(async () => { pending = authenticate(); pending.catch(() => {}); });
    await act(async () => { provider.setGoogleResponse({ type: 'dismiss' }); });
    await expect(pending).resolves.toBeNull();
  });

  it('a Google error result, or a failed prompt, is a generic failure', async () => {
    await mount('google');
    let pending!: Promise<ProviderCredential | null>;
    await act(async () => { pending = authenticate(); pending.catch(() => {}); });
    await act(async () => { provider.setGoogleResponse({ type: 'error', error: { message: 'internal detail' } }); });
    await expect(pending).rejects.toBeInstanceOf(ReauthenticationFailedError);

    provider.googlePrompt.mockRejectedValueOnce(new Error('browser failed'));
    await act(async () => { pending = authenticate(); pending.catch(() => {}); });
    await expect(pending).rejects.toBeInstanceOf(ReauthenticationFailedError);
  });

  it('is unavailable when Google sign-in is not configured on this build', async () => {
    provider.googleConfigured = false;
    await mount('google');
    await expect(authenticate()).rejects.toBeInstanceOf(ReauthenticationUnavailableError);
    expect(provider.googlePrompt).not.toHaveBeenCalled();
  });
});

describe('no known account provider', () => {
  it('is unavailable rather than guessing a provider', async () => {
    await mount(null);
    await expect(authenticate()).rejects.toBeInstanceOf(ReauthenticationUnavailableError);
    expect(provider.appleCredential).not.toHaveBeenCalled();
    expect(provider.googlePrompt).not.toHaveBeenCalled();
  });
});
