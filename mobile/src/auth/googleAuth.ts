import type { AuthRequestPromptOptions, AuthSessionResult } from 'expo-auth-session';
import * as Google from 'expo-auth-session/providers/google';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { requestSignInChallenge } from './authApi';
import { googleClientIdForPlatform, readGoogleClientIds } from './googleConfig';

/** A web challenge is refreshed before the backend's 10-minute expiry (backend/src/auth/signInChallenge.ts). */
export const WEB_CHALLENGE_REFRESH_MS = 8 * 60 * 1000;
/** How long a native sign-in waits for the request that carries its challenge before prompting without one. */
export const NATIVE_CHALLENGE_WAIT_MS = 5000;

/**
 * Google sign-in uses expo-auth-session's official Google provider (a
 * browser-based OAuth flow via expo-web-browser) rather than the
 * community native-module Google Sign-In SDK — it works in both Expo Go
 * and a custom dev/production build without ejecting from the managed
 * workflow, matching "smallest secure architecture that fits the
 * repository" (Part B §4). Client IDs are public OAuth identifiers (not
 * secrets — see Part B §6) and must be supplied via the env vars in
 * googleConfig.ts; see docs/auth-and-sync/setup.md for how to obtain real
 * ones from Google Cloud Console. Until THIS platform's client ID is set,
 * isGoogleAuthConfigured() is false and the sign-in UI doesn't offer Google.
 */
export function isGoogleAuthConfigured(): boolean {
  return Boolean(googleClientIdForPlatform(Platform.OS, readGoogleClientIds()));
}

/**
 * React hook — must be called from a component. Returns the loaded auth
 * request, the latest response, and the prompt function, exactly as
 * expo-auth-session's Google provider does; a caller shows the Google
 * button when `request` is non-null and calls `promptAsync()` on tap. The
 * resulting `response` (read via extractGoogleIdToken) arrives on a later
 * render, not from promptAsync's own resolved value — see the provider's
 * own auto code-exchange behavior.
 */
export function useGoogleAuthRequest(options: { bindSignIn?: boolean } = {}) {
  const bind = options.bindSignIn === true;
  // expo-auth-session throws synchronously during render if its platform's
  // client ID is `undefined` (see invariantClientId in the library) — an
  // empty string keeps the hook safely inert instead of crashing the
  // Settings screen whenever Google sign-in isn't configured yet (the
  // expected state until real Google Cloud Console credentials are set —
  // see docs/auth-setup.md). isGoogleAuthConfigured() gates whether the
  // button is shown or promptAsync is ever actually called.
  const ids = readGoogleClientIds();
  const [nonce, setNonce] = useState<string | null>(null);
  // A new object only when the nonce changes: expo-auth-session rebuilds the request when extraParams change, and
  // keeps the previous request until the new one is ready.
  const extraParams = useMemo(() => (nonce ? { nonce } : undefined), [nonce]);
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: ids.ios ?? '',
    androidClientId: ids.android ?? '',
    webClientId: ids.web ?? '',
    ...(extraParams ? { extraParams } : {}),
  });
  const web = Platform.OS === 'web';
  const enabled = bind && isGoogleAuthConfigured();

  // Web only: the browser opens Google's popup only from the tap itself, so the challenge is fetched ahead (while this
  // button is shown), refreshed before it expires, and replaced after every attempt (each is single-use).
  // `response` is a dependency: each finished attempt (success, cancel or error) gets a new challenge.
  const [webRound, setWebRound] = useState(0);
  useEffect(() => {
    if (!enabled || !web) return undefined;
    let active = true;
    void requestSignInChallenge().then((next) => {
      if (active) setNonce(next);
    });
    const timer = setTimeout(() => setWebRound((n) => n + 1), WEB_CHALLENGE_REFRESH_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [enabled, web, webRound, response]);

  // iOS and Android: no gesture rule, so the challenge is fetched on the tap (nothing for guests who only open
  // Settings), and the prompt waits for the request whose nonce is exactly the target: the fresh challenge, or none at
  // all (null) when no challenge could be had. It never prompts with an earlier nonce: a used one would be refused as a
  // replay. A second tap supersedes the first, and leaving the screen cancels a waiting prompt (it settles as dismissed).
  type Wait = typeof promptAsync | 'timeout' | 'cancelled';
  type Waiting = { target: string | null; resolve: (result: Wait) => void; timer: ReturnType<typeof setTimeout> };
  const waiting = useRef<Waiting | null>(null);
  const latest = useRef({ request, promptAsync });
  useEffect(() => {
    latest.current = { request, promptAsync };
    const w = waiting.current;
    if (w && (request?.extraParams?.nonce ?? null) === w.target) {
      waiting.current = null;
      clearTimeout(w.timer);
      w.resolve(promptAsync);
    }
  }, [request, promptAsync]);
  const settle = useCallback((w: Waiting | null) => {
    if (!w) return;
    clearTimeout(w.timer);
    w.resolve('cancelled');
  }, []);
  useEffect(() => () => {
    settle(waiting.current);
    waiting.current = null;
  }, [settle]);

  /** The prompt of a request whose nonce is `target` once there is one; 'timeout' after the wait; 'cancelled' if superseded. */
  const promptFor = useCallback((target: string | null): Promise<Wait> => {
    settle(waiting.current);
    waiting.current = null;
    if ((latest.current.request?.extraParams?.nonce ?? null) === target && latest.current.request) return Promise.resolve(latest.current.promptAsync);
    return new Promise((resolve) => {
      const w: Waiting = {
        target,
        resolve,
        timer: setTimeout(() => {
          if (waiting.current === w) waiting.current = null;
          resolve('timeout');
        }, NATIVE_CHALLENGE_WAIT_MS),
      };
      waiting.current = w;
      setNonce(target);
    });
  }, [settle]);

  const prompt = useCallback(async (promptOptions?: AuthRequestPromptOptions): Promise<AuthSessionResult> => {
    if (!enabled || web) return latest.current.promptAsync(promptOptions);
    const next = await requestSignInChallenge();
    // Bound if possible; otherwise (no challenge, or its request never appeared) unbound, as before — never stale.
    let result: Wait = next ? await promptFor(next) : 'timeout';
    if (result === 'timeout') result = await promptFor(null);
    return typeof result === 'function' ? result(promptOptions) : { type: 'dismiss' };
  }, [enabled, web, promptFor]);

  return [request, response, prompt] as const;
}

export function extractGoogleIdToken(response: AuthSessionResult | null): string | null {
  if (
    response?.type === 'success' &&
    typeof response.params?.id_token === 'string' &&
    response.params.id_token.length > 0
  ) {
    return response.params.id_token;
  }
  return null;
}

export function wasGoogleSignInCancelled(response: AuthSessionResult | null): boolean {
  return response?.type === 'cancel' || response?.type === 'dismiss';
}
