import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { DEFAULT_QURAN_TRANSLATION_PREFERENCE } from '@/localization/quranTranslationPreference';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';
import { runFullSync } from '@/sync/syncOrchestrator';
import { SyncPassphraseCancelledError, type SyncPassphraseMode } from '@/sync/syncKeyManager';
import { fetchCurrentUser, signInWithAppleIdToken, signInWithGoogleIdToken, AuthApiError } from './authApi';
import { clearCachedMasterKey, clearSessionToken, getSessionToken, setSessionToken } from './sessionStorage';
import type { AuthStatus, AuthUser } from './authTypes';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  lastError: string | null;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithAppleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearLastError: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type PassphraseRequest = {
  mode: SyncPassphraseMode;
  resolve: (passphrase: string) => void;
  reject: (error: Error) => void;
};

/**
 * Optional-account state (Part A/B). Guest is the default and fully
 * supported status — nothing here ever blocks Quran Heals' core reading
 * experience, and a failed sign-in only ever sets `lastError`, never
 * changes `status` away from 'guest'. Nested inside AppLocaleProvider and
 * QuranTranslationPreferenceProvider (see app/_layout.tsx) so post-sign-in
 * sync can read/apply those preferences directly.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [passphraseRequest, setPassphraseRequest] = useState<PassphraseRequest | null>(null);
  // Mirrors the current session token for the AppState-foreground sync
  // effect below, which needs the latest token without re-subscribing on
  // every render (a ref avoids that, unlike putting the token in state).
  // Only ever written from effects/event handlers, never during render.
  const sessionTokenRef = useRef<string | null>(null);
  // Guards the one-time session-restore-from-storage logic in the mount
  // effect below so it still only runs once even though that effect must
  // legitimately list runSyncAfterSignIn (which changes identity when
  // locale/preference change) in its dependency array.
  const hasRestoredSessionRef = useRef(false);

  const { locale, setLocale } = useAppLocale();
  const { preference, setDisplayMode } = useQuranTranslationPreference();

  const promptForPassphrase = useCallback(
    (mode: SyncPassphraseMode) =>
      new Promise<string>((resolve, reject) => {
        setPassphraseRequest({ mode, resolve, reject });
      }),
    [],
  );

  const runSyncAfterSignIn = useCallback(
    async (token: string) => {
      try {
        await runFullSync(token, {
          local: {
            locale,
            translationDisplayMode: preference.displayMode,
            translationId: preference.translationId,
          },
          applyPreferencesLocally: (next) => {
            if (next.locale) setLocale(next.locale);
            if (next.translationDisplayMode) setDisplayMode(next.translationDisplayMode);
            // translationId has only one valid value today
            // (DEFAULT_QURAN_TRANSLATION_PREFERENCE.translationId) — nothing
            // to apply yet; kept here so a second bundled translation only
            // needs a setter added, not new sync wiring.
            void DEFAULT_QURAN_TRANSLATION_PREFERENCE;
          },
          promptForPassphrase,
        });
      } catch {
        // Sync failures never undo a successful sign-in or block app usage
        // (Part H §33) — the user is signed in and can keep using the app;
        // sync can be retried later (e.g. next app foreground).
      }
    },
    [locale, preference.displayMode, preference.translationId, promptForPassphrase, setLocale, setDisplayMode],
  );

  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    hasRestoredSessionRef.current = true;

    let cancelled = false;
    (async () => {
      const token = await getSessionToken();
      if (!token) {
        if (!cancelled) setStatus('guest');
        return;
      }
      const currentUser = await fetchCurrentUser(token);
      if (cancelled) return;
      if (currentUser) {
        sessionTokenRef.current = token;
        setUser(currentUser);
        setStatus('signed-in');
        // Picks up anything that changed on another device (or was left
        // pending on this one) since this device was last open — see Part
        // H §33. Runs once per cold start; the AppState listener below
        // covers reconnect/foreground after that.
        void runSyncAfterSignIn(token);
      } else {
        // Expired/invalid session token — fall back to guest rather than
        // retrying indefinitely or blocking the app.
        await clearSessionToken();
        setStatus('guest');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runSyncAfterSignIn]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const token = sessionTokenRef.current;
      if (token) void runSyncAfterSignIn(token);
    });
    return () => subscription.remove();
  }, [runSyncAfterSignIn]);

  const handleSignInSuccess = useCallback(
    async (token: string, signedInUser: AuthUser) => {
      await setSessionToken(token);
      sessionTokenRef.current = token;
      setUser(signedInUser);
      setStatus('signed-in');
      setLastError(null);
      await runSyncAfterSignIn(token);
    },
    [runSyncAfterSignIn],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string) => {
      try {
        const { token, user: signedInUser } = await signInWithGoogleIdToken(idToken);
        await handleSignInSuccess(token, signedInUser);
      } catch (error) {
        setLastError(
          error instanceof AuthApiError
            ? error.message
            : "We couldn't sign you in. You can try again or continue without an account.",
        );
      }
    },
    [handleSignInSuccess],
  );

  const signInWithApple = useCallback(
    async (idToken: string) => {
      try {
        const { token, user: signedInUser } = await signInWithAppleIdToken(idToken);
        await handleSignInSuccess(token, signedInUser);
      } catch (error) {
        setLastError(
          error instanceof AuthApiError
            ? error.message
            : "We couldn't sign you in. You can try again or continue without an account.",
        );
      }
    },
    [handleSignInSuccess],
  );

  const signOut = useCallback(async () => {
    // Never touches local reflections/favorites/preferences storage — only
    // ends the authenticated session (Part H §32).
    await clearSessionToken();
    await clearCachedMasterKey();
    sessionTokenRef.current = null;
    setUser(null);
    setStatus('guest');
  }, []);

  const clearLastError = useCallback(() => setLastError(null), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      lastError,
      signInWithGoogleIdToken: signInWithGoogle,
      signInWithAppleIdToken: signInWithApple,
      signOut,
      clearLastError,
    }),
    [status, user, lastError, signInWithGoogle, signInWithApple, signOut, clearLastError],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      <SyncPassphraseSheet
        request={passphraseRequest}
        onSubmit={(passphrase: string) => {
          passphraseRequest?.resolve(passphrase);
          setPassphraseRequest(null);
        }}
        onCancel={() => {
          passphraseRequest?.reject(new SyncPassphraseCancelledError('Sync passphrase entry was cancelled.'));
          setPassphraseRequest(null);
        }}
      />
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/** Exposed for components (e.g. FavoriteButton's sync-propagation, ReflectionSheet) that need the raw token for a one-off authenticated call rather than the full context. Returns null for a guest. */
export { getSessionToken as getCurrentSessionToken };
