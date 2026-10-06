import { useCallback, useEffect, useRef } from 'react';

import { AppleSignInCancelledError, isAppleSignInSupportedPlatform, requestAppleCredential } from './appleAuth';
import type { AuthProvider } from './authTypes';
import { extractGoogleIdToken, isGoogleAuthConfigured, useGoogleAuthRequest, wasGoogleSignInCancelled } from './googleAuth';

/**
 * Fresh Apple/Google re-authentication for destructive account actions
 * (currently: resetting encrypted reflection sync after a forgotten sync
 * password). The ID token obtained here is only ever sent to the backend,
 * which verifies it with the provider and checks it belongs to the signed-in
 * Quran Heals account (backend/src/auth/providerReauthentication.ts). It
 * never creates or replaces a Quran Heals session.
 */

export type ProviderCredential = {
  provider: AuthProvider;
  idToken: string;
  /** Only ever set for `provider: 'apple'` — see appleAuth.ts's AppleCredential. Existing callers (sync-password reset) simply never read this field. */
  authorizationCode?: string | null;
};

/** This device cannot sign in with the account's provider (e.g. Google not configured, Apple on Android). */
export class ReauthenticationUnavailableError extends Error {}
/** The provider sign-in failed for a reason other than the user dismissing it. */
export class ReauthenticationFailedError extends Error {}

type PendingGoogle = { resolve: (credential: ProviderCredential | null) => void; reject: (error: Error) => void };

/**
 * Returns a function that runs a fresh sign-in with `provider` — always the
 * signed-in account's own provider (each account has exactly one) — and
 * resolves with its ID token, or null if the user dismissed the sign-in.
 */
export function useFreshProviderCredential(provider: AuthProvider | null): () => Promise<ProviderCredential | null> {
  const [googleRequest, googleResponse, promptGoogle] = useGoogleAuthRequest();
  const pendingGoogle = useRef<PendingGoogle | null>(null);

  // expo-auth-session delivers the Google result (after its code exchange)
  // as a new `response` value, not from promptAsync's own result.
  useEffect(() => {
    const pending = pendingGoogle.current;
    if (!pending || !googleResponse) return;
    pendingGoogle.current = null;
    const idToken = extractGoogleIdToken(googleResponse);
    if (idToken) pending.resolve({ provider: 'google', idToken });
    else if (wasGoogleSignInCancelled(googleResponse)) pending.resolve(null);
    else pending.reject(new ReauthenticationFailedError('Google re-authentication failed.'));
  }, [googleResponse]);

  return useCallback(async () => {
    if (provider === 'apple') {
      if (!isAppleSignInSupportedPlatform()) throw new ReauthenticationUnavailableError('Apple sign-in is unavailable here.');
      try {
        const credential = await requestAppleCredential();
        return { provider: 'apple', idToken: credential.identityToken, authorizationCode: credential.authorizationCode };
      } catch (error) {
        if (error instanceof AppleSignInCancelledError) return null;
        throw new ReauthenticationFailedError('Apple re-authentication failed.');
      }
    }

    if (provider === 'google') {
      if (!isGoogleAuthConfigured() || !googleRequest) throw new ReauthenticationUnavailableError('Google sign-in is unavailable here.');
      return new Promise<ProviderCredential | null>((resolve, reject) => {
        pendingGoogle.current = { resolve, reject };
        promptGoogle().catch(() => {
          if (!pendingGoogle.current) return;
          pendingGoogle.current = null;
          reject(new ReauthenticationFailedError('Google re-authentication failed.'));
        });
      });
    }

    throw new ReauthenticationUnavailableError('No sign-in provider for this account.');
  }, [provider, googleRequest, promptGoogle]);
}
