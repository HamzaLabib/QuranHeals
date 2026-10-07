import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { DEFAULT_QURAN_TRANSLATION_PREFERENCE } from '@/localization/quranTranslationPreference';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { GuestDataSheet, type GuestDataChoice } from '@/components/GuestDataSheet';
import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';
import { pushPreferences, type LocalPreferencesSnapshot } from '@/sync/preferencesSync';
import { hasUnsyncedLocalPreferences } from '@/sync/preferencesSyncState';
import { runFullSync } from '@/sync/syncOrchestrator';
import {
  SyncPassphraseCancelledError,
  SyncPasswordResetError,
  type ResetEncryptedSync,
  type SyncPassphraseMode,
  type VerifyPassphrase,
} from '@/sync/syncKeyManager';
import { clearAllReflections } from '@/storage/ayahReflections';
import { clearAllFavorites } from '@/storage/favorites';
import { hideAccountDataNow, notifyLocalDataChanged } from '@/storage/localDataOwner';
import {
  activateGuestLocalData,
  activateLocalDataForAccount,
  confirmRestoredLocalDataOwner,
  forgetGuestDataDecision,
  guestDataAwaitsDecision,
  keepGuestDataSeparate,
  mergeGuestDataIntoAccount,
  releaseLocalDataAfterAccountDeletion,
} from '@/storage/localDataOwnership';
import { deleteAccountRequest, SyncApiError } from '@/sync/syncApi';
import { devLog } from '@/utils/devLog';
import { logoutSession, signInWithAppleIdToken, signInWithGoogleIdToken, AuthApiError } from './authApi';
import { beginAuthEpoch, currentAuthEpoch } from './authEpoch';
import { initializeSession, type InitializedSession } from './initializeSession';
import { useFreshProviderCredential } from './reauthentication';
import { getRefreshToken, getSessionToken, setCachedUser } from './sessionStorage';
import {
  clearPersistedSession,
  forgetInFlightRefresh,
  persistSessionTokens,
  registerSessionExpiredHandler,
  writeForEpoch,
} from './tokenManager';
import type { AuthStatus, AuthUser } from './authTypes';

/** Thrown into a pending prompt when the session it was asked for has ended. */
class SessionEndedError extends SyncPassphraseCancelledError {}

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
  signInWithAppleIdToken: (idToken: string, authorizationCode?: string | null) => Promise<void>;
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
  verify?: VerifyPassphrase;
  /** Forgotten-password recovery, offered by the unlock step only (see syncKeyManager.ts). */
  reset?: ResetEncryptedSync;
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
  // "Add your local data to this account?" — see runSyncAfterSignIn.
  const [guestDataRequest, setGuestDataRequest] = useState<{ resolve: (choice: GuestDataChoice) => void; reject: (error: Error) => void } | null>(null);
  // Mirrors of both open prompts, so ending a session can reject them
  // immediately (an old account's question must never be answered under
  // another session).
  const passphraseRequestRef = useRef<PassphraseRequest | null>(null);
  const guestDataRequestRef = useRef<typeof guestDataRequest>(null);
  useEffect(() => {
    passphraseRequestRef.current = passphraseRequest;
  }, [passphraseRequest]);
  useEffect(() => {
    guestDataRequestRef.current = guestDataRequest;
  }, [guestDataRequest]);
  // Mirrors the current session token for the AppState-foreground sync
  // effect below, which needs the latest token without re-subscribing on
  // every render (a ref avoids that, unlike putting the token in state).
  // Only ever written from effects/event handlers, never during render.
  const sessionTokenRef = useRef<string | null>(null);
  // The signed-in account's id, for the same reason as sessionTokenRef.
  // Every full sync is pinned to this account's local data partition (see
  // storage/localDataOwner.ts) — never to whatever happens to be active.
  const currentUserIdRef = useRef<string | null>(null);
  // Mark restoration complete only after a live effect commits its result.
  const hasRestoredSessionRef = useRef(false);
  const sessionRestorePromiseRef = useRef<Promise<InitializedSession> | null>(null);
  // Single-flight per session: cold start, an AppState foreground event, and
  // an explicit pull-to-refresh refreshSync() call can never run runFullSync
  // (and therefore the mandatory Sync Password prompt) concurrently. A sync
  // still finishing for an EARLIER session (see auth/authEpoch.ts) never
  // blocks the new session's sync: that one waits for it to stop instead.
  const syncInFlightRef = useRef<{ epoch: number; promise: Promise<void> } | null>(null);
  // A sign-out still clearing storage; a sign-in waits for it to finish.
  const pendingSignOutRef = useRef<Promise<void>>(Promise.resolve());
  // Throttles only the *automatic* AppState-triggered resync below — see
  // FOREGROUND_RESYNC_THROTTLE_MS.
  const lastForegroundSyncAtRef = useRef(0);

  const { locale, setLocale, isReady: isLocaleReady } = useAppLocale();
  const { preference, setDisplayMode, isReady: isTranslationPreferenceReady } = useQuranTranslationPreference();
  const preferencesHydrated = isLocaleReady && isTranslationPreferenceReady;

  // Latest preference values for sync, read at decision time (never a
  // snapshot captured when a sync started — see preferencesSync.ts).
  const latestPreferencesRef = useRef<LocalPreferencesSnapshot>({
    locale,
    translationDisplayMode: preference.displayMode,
    translationId: preference.translationId,
  });
  useEffect(() => {
    latestPreferencesRef.current = {
      locale,
      translationDisplayMode: preference.displayMode,
      translationId: preference.translationId,
    };
  }, [locale, preference.displayMode, preference.translationId]);

  // Sync must never read the providers' pre-hydration defaults (e.g. `en`)
  // as if the user had chosen them — it waits until both have loaded what
  // was persisted on this device.
  const preferencesHydratedRef = useRef(false);
  const hydrationWaitersRef = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (!preferencesHydrated) return;
    preferencesHydratedRef.current = true;
    const waiters = hydrationWaitersRef.current;
    hydrationWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, [preferencesHydrated]);
  const waitForPreferenceHydration = useCallback(
    () =>
      preferencesHydratedRef.current
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            hydrationWaitersRef.current.push(resolve);
          }),
    [],
  );

  const promptForPassphrase = useCallback(
    (mode: SyncPassphraseMode, verify?: VerifyPassphrase, reset?: ResetEncryptedSync) =>
      new Promise<string>((resolve, reject) => {
        setPassphraseRequest({ mode, verify, reset, resolve, reject });
      }),
    [],
  );

  const promptForGuestData = useCallback(
    () =>
      new Promise<GuestDataChoice>((resolve, reject) => {
        setGuestDataRequest({ resolve, reject });
      }),
    [],
  );

  /** Ends any open prompt of the session that just ended. */
  const rejectOpenPrompts = useCallback(() => {
    passphraseRequestRef.current?.reject(new SessionEndedError('The session ended.'));
    guestDataRequestRef.current?.reject(new SessionEndedError('The session ended.'));
    passphraseRequestRef.current = null;
    guestDataRequestRef.current = null;
    setPassphraseRequest(null);
    setGuestDataRequest(null);
  }, []);

  const runSyncAfterSignIn = useCallback(
    async (token: string) => {
      // The session this sync is for. Every step below stops as soon as it
      // is no longer current (sign-out, or another account signed in), and
      // only ever touches `ownerUserId`'s own data and server account.
      const epoch = currentAuthEpoch();
      const isCurrent = () => epoch === currentAuthEpoch();
      const previous = syncInFlightRef.current;
      if (previous) {
        if (previous.epoch === epoch) return;
        await previous.promise.catch(() => undefined);
        if (!isCurrent() || syncInFlightRef.current) return;
      }

      const run = async () => {
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
          // Without a known account there is no partition this sync may
          // touch (e.g. an offline cold start with no cached profile) — it
          // runs on a later sync once the account is known.
          const ownerUserId = currentUserIdRef.current;
          if (!ownerUserId) return;
          // Already done at sign-in/restore; repeated here (a no-op then) so
          // no sync can ever run before its account's partition is active.
          await activateLocalDataForAccount(ownerUserId, isCurrent);
          if (!isCurrent()) return;

          // Guest data joins the account only if the user says so, and
          // before this sync, so an added copy is uploaded right away.
          if (await guestDataAwaitsDecision(ownerUserId)) {
            const choice = await promptForGuestData();
            if (!isCurrent()) return;
            if (choice === 'add') await mergeGuestDataIntoAccount(ownerUserId, isCurrent);
            else await keepGuestDataSeparate(ownerUserId);
          }

          await waitForPreferenceHydration();
          const latestToken = (await getSessionToken()) ?? token;
          if (!isCurrent()) return;
          sessionTokenRef.current = latestToken;
          const result = await runFullSync(latestToken, {
            ownerUserId,
            local: () => latestPreferencesRef.current,
            applyPreferencesLocally: (next) => {
              if (!isCurrent()) return;
              if (next.locale) setLocale(next.locale, { fromSync: true });
              if (next.translationDisplayMode) setDisplayMode(next.translationDisplayMode, { fromSync: true });
              // translationId has only one valid value today
              // (DEFAULT_QURAN_TRANSLATION_PREFERENCE.translationId) —
              // nothing to apply yet; kept here so a second bundled
              // translation only needs a setter added, not new sync wiring.
              void DEFAULT_QURAN_TRANSLATION_PREFERENCE;
            },
            promptForPassphrase,
            isCurrent,
          });
          // Screens showing this account's data pick up what was downloaded.
          if (isCurrent() && (result.favoritesSynced || result.reflectionsSynced)) notifyLocalDataChanged();
        } catch {
          // Sync failures never undo a successful sign-in or block app
          // usage (Part H §33) — the user is signed in and can keep using
          // the app; sync can be retried later (e.g. next app foreground).
        }
      };

      const promise = run();
      syncInFlightRef.current = { epoch, promise };
      try {
        await promise;
      } finally {
        if (syncInFlightRef.current?.promise === promise) syncInFlightRef.current = null;
      }
    },
    [promptForPassphrase, promptForGuestData, setLocale, setDisplayMode, waitForPreferenceHydration],
  );

  // Pushes a preference change made on this device while signed in, as soon
  // as it happens. Best-effort: offline or failed pushes are retried by the
  // next full sync, which re-sends anything newer than the account's value.
  // Values adopted from the account are already marked synced, so applying
  // them never echoes back here.
  useEffect(() => {
    if (status !== 'signed-in' || !preferencesHydrated) return;
    void (async () => {
      try {
        if (!(await hasUnsyncedLocalPreferences())) return;
        const token = (await getSessionToken()) ?? sessionTokenRef.current;
        if (!token) return;
        await pushPreferences(token, () => latestPreferencesRef.current);
      } catch {
        // Left for the next full sync — see above.
      }
    })();
  }, [status, preferencesHydrated, locale, preference.displayMode, preference.translationId]);

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
      devLog('auth', 'session init complete', { status: session.status });
      hasRestoredSessionRef.current = true;
      sessionTokenRef.current = session.token;
      currentUserIdRef.current = session.user?.id ?? null;
      // Until this point no account data is shown (see localDataOwner.ts's
      // `resolved`): the last session may have expired or signed out.
      const epoch = currentAuthEpoch();
      if (session.status === 'signed-in' && session.user) {
        const userId = session.user.id;
        void activateLocalDataForAccount(userId, () => epoch === currentAuthEpoch()).catch(() => {
          // Retried by the sync below; local data stays where it is.
        });
      } else if (session.status === 'signed-in') {
        void confirmRestoredLocalDataOwner().catch(() => {});
      } else {
        void activateGuestLocalData().catch(() => {
          // Re-evaluated on the next launch.
        });
      }
      setUser(session.user);
      setStatus(session.status);
      if (session.shouldSync && session.token && session.user) {
        const signedInUser = session.user;
        void writeForEpoch(epoch, () => setCachedUser(signedInUser));
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
      // A sign-out still clearing storage finishes first, so it can never
      // clear this new session's tokens (they are written after it).
      await pendingSignOutRef.current.catch(() => undefined);
      // A new session: anything still running for an earlier one is stale
      // from here on (see auth/authEpoch.ts).
      const epoch = beginAuthEpoch();
      const isCurrent = () => epoch === currentAuthEpoch();
      forgetInFlightRefresh();
      rejectOpenPrompts();
      // Before anything can sync: switch local data to this account's own
      // partition. Nothing moves into it here — guest data only on request
      // (see storage/localDataOwnership.ts). A storage failure here cannot
      // route data to the wrong account — every sync names its account
      // explicitly — so it does not block signing in.
      await activateLocalDataForAccount(signedInUser.id, isCurrent).catch(() => {});
      // An interactive sign-in asks about guest data again.
      await forgetGuestDataDecision(signedInUser.id).catch(() => {});
      if (!isCurrent()) return;
      currentUserIdRef.current = signedInUser.id;
      // Only absent if the backend itself omitted it — this app's backend
      // always sends one (see authApi.ts's SignInResponse doc comment).
      await persistSessionTokens(epoch, token, refreshToken);
      if (!isCurrent()) return;
      sessionTokenRef.current = token;
      setUser(signedInUser);
      void writeForEpoch(epoch, () => setCachedUser(signedInUser));
      setStatus('signed-in');
      setLastError(null);
      await runSyncAfterSignIn(token);
    },
    [runSyncAfterSignIn, rejectOpenPrompts],
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
    async (idToken: string, authorizationCode?: string | null) => {
      try {
        const { token, refreshToken, user: signedInUser } = await signInWithAppleIdToken(idToken, authorizationCode);
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

  // Shared by sign-out, a session forcibly expired by the refresh flow
  // (tokenManager's registerSessionExpiredHandler) and account deletion.
  // Synchronously, before anything else can render or run: a new auth
  // epoch (everything still running for this session is stale from here
  // on), its prompts closed, and the guest partition shown instead of the
  // account's. Then the persisted session (tokens, cached profile, cached
  // master key) is cleared — unless a newer sign-in got there first. The
  // account's local partition is kept on this device for that account
  // only, and nothing on the server is deleted.
  const endSession = useCallback(() => {
    const epoch = beginAuthEpoch();
    forgetInFlightRefresh();
    sessionTokenRef.current = null;
    currentUserIdRef.current = null;
    rejectOpenPrompts();
    hideAccountDataNow();
    setUser(null);
    setStatus('guest');
    const cleared = (async () => {
      await activateGuestLocalData().catch(() => {});
      await clearPersistedSession(epoch);
    })();
    pendingSignOutRef.current = cleared;
    return cleared;
  }, [rejectOpenPrompts]);

  useEffect(() => {
    registerSessionExpiredHandler(() => {
      void endSession();
    });
    return () => registerSessionExpiredHandler(null);
  }, [endSession]);

  const signOut = useCallback(async () => {
    // Read before the session is cleared: revocation needs it.
    const refreshToken = await getRefreshToken().catch(() => null);
    await endSession();
    // Revokes only this device's session server-side (best-effort — see
    // authApi.ts's logoutSession) — every other signed-in device is
    // unaffected. Local sign-out has already completed regardless.
    if (refreshToken) await logoutSession(refreshToken).catch(() => {});
  }, [endSession]);

  const clearLastError = useCallback(() => setLastError(null), []);

  const refreshSync = useCallback(async () => {
    const token = sessionTokenRef.current;
    if (!token) return;
    await runSyncAfterSignIn(token);
  }, [runSyncAfterSignIn]);

  const promptForFreshProviderCredential = useFreshProviderCredential(user?.provider ?? null);

  const deleteAccount = useCallback(async () => {
    const token = sessionTokenRef.current;
    if (!token) {
      throw new Error('Not signed in.');
    }
    // The partition to clear is this account's own — never whatever is
    // active by the time the backend answers.
    const deletedUserId = currentUserIdRef.current;

    // Everything before local clearing below only reads/calls the backend;
    // nothing local is touched until the backend confirms the account (and
    // every model it owns) is actually gone. A thrown error anywhere here
    // (network failure, 5xx, timeout, cancelled re-authentication)
    // propagates to the caller and leaves the session fully intact.
    try {
      await deleteAccountRequest(token);
    } catch (error) {
      if (!(error instanceof SyncApiError) || error.statusCode !== 428) {
        throw error;
      }
      // The backend needs a fresh sign-in with this account's own provider
      // before deleting anything: always for Google accounts, and for an
      // Apple account with no stored revocation credential yet (so Apple's
      // authorization can be revoked first). See
      // backend/src/controllers/accountController.ts.
      const credential = await promptForFreshProviderCredential();
      if (!credential) {
        throw new Error('Account deletion needs a fresh sign-in.');
      }
      await deleteAccountRequest(token, credential);
    }

    // Only reached after backend success. Local reflections/favorites are
    // cleared here — unlike ordinary signOut(), which keeps them on this
    // device for the account, deletion means there is no account left for
    // them to belong to. Guest data and other accounts' partitions are
    // untouched. Locale/translation-display preferences are left alone (an
    // app/device setting, not account data).
    await clearAllReflections(deletedUserId ?? undefined);
    await clearAllFavorites(deletedUserId ?? undefined);
    await endSession();
    if (deletedUserId) await releaseLocalDataAfterAccountDeletion(deletedUserId);
  }, [endSession, promptForFreshProviderCredential]);

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
      <GuestDataSheet
        visible={guestDataRequest !== null}
        onChoose={(choice) => {
          guestDataRequest?.resolve(choice);
          guestDataRequestRef.current = null;
          setGuestDataRequest(null);
        }}
      />
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
        onResetComplete={() => {
          // Encrypted reflection sync was reset (forgotten password): the
          // in-flight sync continues straight into creating a NEW password
          // (syncKeyManager.ts) — the step is satisfied, not skipped.
          passphraseRequest?.reject(new SyncPasswordResetError('Encrypted reflection sync was reset.'));
          setPassphraseRequest(null);
        }}
        deleteAccount={deleteAccount}
        accountProvider={user?.provider ?? null}
        onAccountDeleted={() => {
          // deleteAccount() has already ended the session; just end the
          // waiting sync, exactly like signing out of this step.
          passphraseRequest?.reject(new SyncPassphraseCancelledError('Account deleted during the mandatory sync password step.'));
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
