import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { DEFAULT_QURAN_TRANSLATION_PREFERENCE } from '@/localization/quranTranslationPreference';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';
import { runFullSync } from '@/sync/syncOrchestrator';
import { SyncPassphraseCancelledError, type SyncPassphraseMode } from '@/sync/syncKeyManager';
import { clearAllReflections } from '@/storage/ayahReflections';
import { clearAllFavorites } from '@/storage/favorites';
import { deleteAccountRequest } from '@/sync/syncApi';
import { runGuardedRefresh, type RefreshInFlightRef } from '@/utils/pullToRefresh';
import { logoutSession, signInWithAppleIdToken, signInWithGoogleIdToken, AuthApiError } from './authApi';
import { initializeSession, type InitializedSession } from './initializeSession';
import {
  clearCachedMasterKey,
  clearCachedUser,
  clearRefreshToken,
  clearSessionToken,
  getRefreshToken,
  getSessionToken,
  setCachedUser,
  setRefreshToken,
  setSessionToken,
} from './sessionStorage';
import { registerSessionExpiredHandler } from './tokenManager';
import type { AuthStatus, AuthUser } from './authTypes';

// Automatic (AppState-triggered) foreground resync is throttled the same
// way Home throttles its own foreground revalidation (see app/index.tsx's
// FOREGROUND_REVALIDATE_AFTER_MS) — a brief app-switch-and-back should never
// re-run the full sync (and, transitively, re-touch the mandatory Sync
// Password gate) on every single transition. An *explicit* pull-to-refresh
// (refreshSync(), called directly by a screen) is never throttled — only
// the passive AppState listener is.
const FOREGROUND_RESYNC_THROTTLE_MS = 60_000;

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  lastError: string | null;
  signInWithGoogleIdToken: (idToken: string) => Promise<void>;
  signInWithAppleIdToken: (idToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearLastError: () => void;
  /** Re-runs the same favorites/preferences/reflections sync as sign-in/foreground (runFullSync) — a no-op for a guest. The one function pull-to-refresh screens call; never a separate sync implementation. */
  refreshSync: () => Promise<void>;
  /**
   * Permanently deletes the signed-in account. Local data (tokens, cached
   * master key, local reflections, local favorites) is cleared only after
   * the backend confirms deletion — a network/backend failure here throws
   * and leaves everything local untouched, exactly like a failed sync
   * (never a false "deleted" state). Throws if called while not signed in.
   */
  deleteAccount: () => Promise<void>;
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
  // Mark restoration complete only after a live effect commits its result.
  const hasRestoredSessionRef = useRef(false);
  const sessionRestorePromiseRef = useRef<Promise<InitializedSession> | null>(null);
  // Single-flight guard so cold start, an AppState foreground event, and an
  // explicit pull-to-refresh refreshSync() call can never run runFullSync
  // (and therefore the mandatory Sync Password prompt) concurrently — see
  // utils/pullToRefresh.ts's doc comment for why this must be a ref rather
  // than React state.
  const syncGuardRef = useRef<RefreshInFlightRef>({ current: false });
  // Throttles only the *automatic* AppState-triggered resync below — see
  // FOREGROUND_RESYNC_THROTTLE_MS.
  const lastForegroundSyncAtRef = useRef(0);

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
      await runGuardedRefresh(syncGuardRef.current, async () => {
        lastForegroundSyncAtRef.current = Date.now();
        // Always syncs with the freshest persisted access token, not
        // necessarily the one this call happened to be invoked with. A
        // silent 401-triggered refresh (sync/syncApi.ts's authedRequest ->
        // tokenManager.ts) rotates the access token in SecureStore but has
        // no way to reach back into an already-running closure's `token`
        // parameter or sessionTokenRef — without this re-read, every sync
        // after the very first silent refresh would keep presenting a
        // token that's already stale.
        try {
          const latestToken = (await getSessionToken()) ?? token;
          sessionTokenRef.current = latestToken;
          await runFullSync(latestToken, {
            local: {
              locale,
              translationDisplayMode: preference.displayMode,
              translationId: preference.translationId,
            },
            applyPreferencesLocally: (next) => {
              if (next.locale) setLocale(next.locale);
              if (next.translationDisplayMode) setDisplayMode(next.translationDisplayMode);
              // translationId has only one valid value today
              // (DEFAULT_QURAN_TRANSLATION_PREFERENCE.translationId) —
              // nothing to apply yet; kept here so a second bundled
              // translation only needs a setter added, not new sync wiring.
              void DEFAULT_QURAN_TRANSLATION_PREFERENCE;
            },
            promptForPassphrase,
          });
        } catch {
          // Sync failures never undo a successful sign-in or block app
          // usage (Part H §33) — the user is signed in and can keep using
          // the app; sync can be retried later (e.g. next app foreground).
        }
      });
    },
    [locale, preference.displayMode, preference.translationId, promptForPassphrase, setLocale, setDisplayMode],
  );

  useEffect(() => {
    if (hasRestoredSessionRef.current) return;
    let cancelled = false;

    // Cleanup cancels only this subscription, not initialization. If persisted
    // preferences change runSyncAfterSignIn while restoration is pending, the
    // replacement effect subscribes to the same promise and commits its result.
    if (!sessionRestorePromiseRef.current) {
      sessionRestorePromiseRef.current = initializeSession().finally(() => {
        sessionRestorePromiseRef.current = null;
      });
    }

    void sessionRestorePromiseRef.current.then((session) => {
      if (cancelled) return;
      hasRestoredSessionRef.current = true;
      sessionTokenRef.current = session.token;
      setUser(session.user);
      setStatus(session.status);
      if (session.shouldSync && session.token && session.user) {
        void setCachedUser(session.user);
        void runSyncAfterSignIn(session.token);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [runSyncAfterSignIn]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      const token = sessionTokenRef.current;
      if (!token) return;
      // A plain background -> foreground blip must never re-run the full
      // sync (and, transitively, the mandatory Sync Password gate) on every
      // single transition — see FOREGROUND_RESYNC_THROTTLE_MS. An explicit
      // pull-to-refresh (refreshSync(), below) is a separate call path and
      // is never throttled.
      if (Date.now() - lastForegroundSyncAtRef.current < FOREGROUND_RESYNC_THROTTLE_MS) return;
      void runSyncAfterSignIn(token);
    });
    return () => subscription.remove();
  }, [runSyncAfterSignIn]);

  const handleSignInSuccess = useCallback(
    async (token: string, refreshToken: string | undefined, signedInUser: AuthUser) => {
      await setSessionToken(token);
      // Only absent if the backend itself omitted it — this app's backend
      // always sends one (see authApi.ts's SignInResponse doc comment).
      if (refreshToken) await setRefreshToken(refreshToken);
      sessionTokenRef.current = token;
      setUser(signedInUser);
      void setCachedUser(signedInUser);
      setStatus('signed-in');
      setLastError(null);
      await runSyncAfterSignIn(token);
    },
    [runSyncAfterSignIn],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string) => {
      try {
        const { token, refreshToken, user: signedInUser } = await signInWithGoogleIdToken(idToken);
        await handleSignInSuccess(token, refreshToken, signedInUser);
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
        const { token, refreshToken, user: signedInUser } = await signInWithAppleIdToken(idToken);
        await handleSignInSuccess(token, refreshToken, signedInUser);
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

  // Shared by a user-initiated sign-out and a session forcibly expired by
  // the refresh flow (tokenManager's registerSessionExpiredHandler) —
  // clears only this device's local auth state either way. Never touches
  // local reflections/favorites/preferences storage (Part H §32).
  const clearLocalSession = useCallback(() => {
    sessionTokenRef.current = null;
    setUser(null);
    void clearCachedUser();
    setStatus('guest');
  }, []);

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      void clearCachedMasterKey();
      clearLocalSession();
    });
    return () => registerSessionExpiredHandler(null);
  }, [clearLocalSession]);

  const signOut = useCallback(async () => {
    // Revokes only this device's session server-side (best-effort — see
    // authApi.ts's logoutSession) — every other signed-in device is
    // unaffected. Local sign-out below always proceeds regardless.
    const refreshToken = await getRefreshToken();
    if (refreshToken) await logoutSession(refreshToken);

    await clearSessionToken();
    await clearRefreshToken();
    await clearCachedMasterKey();
    clearLocalSession();
  }, [clearLocalSession]);

  const clearLastError = useCallback(() => setLastError(null), []);

  const refreshSync = useCallback(async () => {
    const token = sessionTokenRef.current;
    if (!token) return;
    await runSyncAfterSignIn(token);
  }, [runSyncAfterSignIn]);

  const deleteAccount = useCallback(async () => {
    const token = sessionTokenRef.current;
    if (!token) {
      throw new Error('Not signed in.');
    }

    // Everything before this line only reads; nothing local is touched
    // until the backend confirms the account (and every model it owns) is
    // actually gone. A thrown error here (network failure, 5xx, timeout)
    // propagates to the caller and leaves the session fully intact.
    await deleteAccountRequest(token);

    // Only reached after backend success. Local reflections/favorites are
    // cleared here — unlike ordinary signOut(), which deliberately keeps
    // them, deletion means there is no account left for them to belong to.
    // Locale/translation-display preferences are left alone (an app/device
    // setting, not account data).
    await clearAllReflections();
    await clearAllFavorites();
    await clearSessionToken();
    await clearRefreshToken();
    await clearCachedMasterKey();
    clearLocalSession();
  }, [clearLocalSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      lastError,
      signInWithGoogleIdToken: signInWithGoogle,
      signInWithAppleIdToken: signInWithApple,
      signOut,
      clearLastError,
      refreshSync,
      deleteAccount,
    }),
    [status, user, lastError, signInWithGoogle, signInWithApple, signOut, clearLastError, refreshSync, deleteAccount],
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
        onSignOut={() => {
          // The only sanctioned way out of the mandatory password step —
          // never a skip that leaves the user signed in without having
          // satisfied it. Rejecting first lets the in-flight sync abort
          // cleanly (see syncOrchestrator.ts) before signOut() clears the
          // session it would otherwise have kept retrying against.
          passphraseRequest?.reject(new SyncPassphraseCancelledError('Signed out during the mandatory sync password step.'));
          setPassphraseRequest(null);
          void signOut();
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
