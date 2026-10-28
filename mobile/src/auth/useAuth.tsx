import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { saveEmotionsLanguage, type EmotionsLanguage } from '@/localization/emotionsLanguage';
import { applySyncedQuranReadingMode, type QuranReadingMode } from '@/localization/quranLanguage';
import type { EnabledTranslationMode, TranslationDisplayMode } from '@/localization/quranTranslationPreference';
import { useEmotionsLanguage } from '@/localization/useEmotionsLanguage';
import { useQuranFontSizeSync } from '@/localization/useQuranFontSizePreference';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import type { AppLocale } from '@/localization/locales';
import { useAppearancePreference } from '@/theme/useAppearancePreference';
import type { AppearanceMode } from '@/theme/appearancePreference';
import { useFavoriteReciter } from '@/audio/useFavoriteReciter';
import { applySyncedMemorizationGuideDone } from '@/memorization/memorizationGuide';
import { useMemorizationModeSetting } from '@/memorization/useMemorizationModeSetting';
import { applySyncedGuideCompletion } from '@/mushaf/mushafGuide';
import { useKeepAwakePreference } from '@/mushaf/useKeepAwakePreference';
import { useWordMeaningsVisibility } from '@/mushaf/useWordMeaningsVisibility';
import { applyAccountReminder, discardWaitingAccountReminders } from '@/notifications/accountReminders';
import { claimDevicePreferences, forgoDevicePreferencesClaim } from '@/sync/devicePreferencesClaim';
import { GuestDataSheet, type GuestDataChoice } from '@/components/GuestDataSheet';
import { SyncPassphraseSheet } from '@/components/SyncPassphraseSheet';
import { pushPreferences, type ApplyPreference } from '@/sync/preferencesSync';
import { claimLegacyPreferenceChanges, clearAccountPreferenceState, discardLegacyPreferenceChanges, subscribeToLocalPreferenceChanges } from '@/sync/preferencesSyncState';
import { subscribeToLocalChanges, subscribeToLocalReadingChanges } from '@/storage/localChanges';
import { markReadingChangedLocally, resetReadingSyncStatus } from '@/sync/readingSyncState';
import { syncReading } from '@/sync/readingSync';
import { runFullSync } from '@/sync/syncOrchestrator';
import {
  SyncPassphraseCancelledError,
  SyncPasswordResetError,
  discardUnfinishedKeySetup,
  type ResetEncryptedSync,
  type SyncPassphraseMode,
  type VerifyPassphrase,
} from '@/sync/syncKeyManager';
import { clearAllReflections } from '@/storage/ayahReflections';
import { clearAllConflictVersions } from '@/storage/reflectionConflicts';
import { clearAllFavorites } from '@/storage/favorites';
import { clearAccountReadingData } from '@/mushaf/khatmas';
import { clearRecentEmotions, subscribeToRecentEmotionChanges } from '@/storage/recentEmotions';
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
import type { AccountAgeDeclaration } from './ageConfirmation';
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

/**
 * أورادي وختماتي: a reading change (saving a page, confirming a Khatma…) is
 * uploaded this long after the last one, so a few saves in a row make one
 * sync, not one each. Everything is already saved on the device meanwhile.
 */
const READING_CHANGE_DEBOUNCE_MS = 2_000;
/**
 * When a sync fails or leaves something not yet on the account or this
 * device (offline, a server error, a favorite not restorable yet), the
 * whole sync — settings, أورادي وختماتي, favorites, reflections — is
 * retried while the app stays open, once after each of these delays and
 * then no more: the app has no network-status module, so this, the
 * foreground resync, pull-to-refresh, screen focus and the next change are
 * how a returning connection is noticed. The retry is the same single-flight
 * sync as sign-in, so it never overlaps another and never bypasses the Sync
 * Password: favorites and reflections sync only once this account's key is
 * unlocked on this device (sync/syncKeyManager.ts). A complete sync, a
 * return to the foreground or a pull starts the delays again. Stops in the
 * background and on sign-out.
 */
const SYNC_RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000];

/**
 * A screen showing synced data gaining focus (Favorites, My Reading)
 * refreshes it only if nothing of the kind synced this recently — switching
 * tabs back and forth never starts a sync each time.
 */
const FOCUS_RESYNC_THROTTLE_MS = 30_000;

/** Why a sync started — for dev-only timing logs (devLog), and so a local change is never dropped while another sync runs. */
type SyncTrigger = 'session' | 'foreground' | 'pull' | 'local-change' | 'retry' | 'focus';

/** What a focused screen shows: أورادي وختماتي only (no Sync Password), or everything the account syncs. */
export type FocusSyncScope = 'reading' | 'all';

export type AuthContextValue = {
  status: AuthStatus;
  user: AuthUser | null;
  lastError: string | null;
  signInWithGoogleIdToken: (idToken: string, ageDeclaration?: AccountAgeDeclaration) => Promise<void>;
  signInWithAppleIdToken: (idToken: string, authorizationCode?: string | null, ageDeclaration?: AccountAgeDeclaration) => Promise<void>;
  signOut: () => Promise<void>;
  clearLastError: () => void;
  /** Re-runs the same favorites/preferences/reflections sync as sign-in/foreground (runFullSync) — a no-op for a guest. The one function pull-to-refresh screens call; never a separate sync implementation. */
  refreshSync: () => Promise<void>;
  /**
   * أورادي وختماتي's pull-to-refresh: the same reading-only account sync a
   * reading change triggers (sync/readingSync.ts) — no Sync Password, one
   * per account at a time (a sync already running is waited for, never
   * duplicated). Resolves when it has finished; never throws (a failure
   * leaves everything on the device and schedules the usual retry). A
   * no-op for a guest.
   */
  refreshReading: () => Promise<void>;
  /**
   * A screen showing synced data gained focus: 'reading' runs refreshReading's
   * sync, 'all' refreshSync's — each only if no such sync started in the
   * last FOCUS_RESYNC_THROTTLE_MS, and never alongside one already running.
   * Fire-and-forget; a no-op for a guest.
   */
  syncOnFocus: (scope: FocusSyncScope) => void;
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
  // A local change saved while that sync was already running (possibly past
  // its upload step): the epoch that owes exactly one more sync once it ends.
  const syncAgainForEpochRef = useRef<number | null>(null);
  // A sign-out still clearing storage; a sign-in waits for it to finish.
  const pendingSignOutRef = useRef<Promise<void>>(Promise.resolve());
  // Throttles only the *automatic* AppState-triggered resync below — see
  // FOREGROUND_RESYNC_THROTTLE_MS.
  const lastForegroundSyncAtRef = useRef(0);
  // أورادي وختماتي: the pending debounced upload, and the retry schedule (see SYNC_RETRY_DELAYS_MS).
  const readingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  // The full sync a retry runs (set below, once runSyncAfterSignIn exists).
  const retrySyncRef = useRef<() => void>(() => {});
  // When the last أورادي وختماتي-only sync started (screen-focus throttle).
  const lastReadingSyncAtRef = useRef(0);
  const clearSyncTimers = useCallback(() => {
    if (readingDebounceRef.current) clearTimeout(readingDebounceRef.current);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    readingDebounceRef.current = null;
    retryTimerRef.current = null;
  }, []);
  /** After a failed or incomplete sync: one retry, later each time, until SYNC_RETRY_DELAYS_MS runs out (never two scheduled at once). */
  const scheduleSyncRetry = useCallback(() => {
    if (retryTimerRef.current || AppState.currentState !== 'active') return;
    if (retryAttemptRef.current >= SYNC_RETRY_DELAYS_MS.length) return;
    const delay = SYNC_RETRY_DELAYS_MS[retryAttemptRef.current];
    retryAttemptRef.current += 1;
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      retrySyncRef.current();
    }, delay);
  }, []);

  const { setLocale, isReady: isLocaleReady } = useAppLocale();
  const { setDisplayMode, applySyncedTranslationMode, isReady: isTranslationPreferenceReady } = useQuranTranslationPreference();
  const { setMode: setAppearanceMode, isReady: isAppearanceReady } = useAppearancePreference();
  const { applySyncedSize, isReady: isFontSizeReady } = useQuranFontSizeSync();
  const { isReady: isEmotionsLanguageReady } = useEmotionsLanguage();
  const { setReciterId, isReady: isReciterReady } = useFavoriteReciter();
  const { setEnabled: setKeepAwake, isReady: isKeepAwakeReady } = useKeepAwakePreference();
  const { setVisible: setWordMeaningsVisible, isReady: isWordMeaningsReady } = useWordMeaningsVisibility();
  const { setVisible: setMemorizationModeVisible, isReady: isMemorizationModeReady } = useMemorizationModeSetting();
  const preferencesHydrated = isLocaleReady && isTranslationPreferenceReady && isAppearanceReady && isFontSizeReady && isEmotionsLanguageReady
    && isReciterReady && isKeepAwakeReady && isWordMeaningsReady && isMemorizationModeReady;

  // Applies one of the signed-in account's settings on this device
  // (sync/preferenceFields.ts), through each setting's own setter with
  // `fromSync`, so it is never recorded as this device's change.
  const applyPreferenceRef = useRef<ApplyPreference>(() => {});
  applyPreferenceRef.current = (field, value) => {
    switch (field) {
      case 'locale':
        setLocale(value as AppLocale, { fromSync: true });
        break;
      case 'translationDisplayMode':
        setDisplayMode(value as TranslationDisplayMode, { fromSync: true });
        break;
      case 'translationId':
        // Only one translation exists (PICKTHALL_TRANSLATION_ID): nothing to
        // apply yet. Kept per account, so a second translation needs only a setter here.
        break;
      case 'quranLanguage':
        void applySyncedQuranReadingMode(value as QuranReadingMode);
        break;
      case 'emotionsLanguage':
        void saveEmotionsLanguage(value as EmotionsLanguage);
        break;
      case 'appearance':
        setAppearanceMode(value as AppearanceMode, { fromSync: true });
        break;
      case 'quranFontSize':
        applySyncedSize(value as number);
        break;
      case 'translationEnabledMode':
        applySyncedTranslationMode(value as EnabledTranslationMode);
        break;
      case 'favoriteReciter':
        // One this app version does not list is ignored by the setter.
        setReciterId(value as string, { fromSync: true });
        break;
      case 'keepAwake':
        // The reader still holds the screen awake only while it is focused and the app active (useMushafKeepAwake.ts).
        setKeepAwake(value as boolean, { fromSync: true });
        break;
      case 'wordMeaningsVisible':
        setWordMeaningsVisible(value as boolean, { fromSync: true });
        break;
      case 'memorizationModeVisible':
        setMemorizationModeVisible(value as boolean, { fromSync: true });
        break;
      case 'notificationWird':
        // Applied by the reminders' provider once its settings have loaded (notifications/accountReminders.ts) and
        // rescheduled as far as this device's own OS permission allows; never asks for it.
        applyAccountReminder('wird', value);
        break;
      case 'notificationRandomAyah':
        applyAccountReminder('randomAyah', value);
        break;
      case 'notificationEmotionCheckIn':
        applyAccountReminder('emotionCheckIn', value);
        break;
      case 'mushafGuide':
        void applySyncedGuideCompletion(value as 'closed' | 'finished');
        break;
      case 'memorizationGuide':
        void applySyncedMemorizationGuideDone();
        break;
    }
  };
  const applyPreference = useCallback<ApplyPreference>((field, value) => applyPreferenceRef.current(field, value), []);
  // The earlier versions' device-wide settings timestamp: claimed by a
  // restored session's account, discarded by an interactive sign-in or a
  // sign-out (sync/preferencesSyncState.ts). Every sync waits for it.
  const legacyPreferencesRef = useRef<Promise<void>>(Promise.resolve());

  // Sync must never apply an account value before a provider has loaded
  // what was persisted on this device (the provider's own load would then
  // replace it) — it waits until every synced setting has loaded.
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
    async (token: string, trigger: SyncTrigger = 'session') => {
      // The session this sync is for. Every step below stops as soon as it
      // is no longer current (sign-out, or another account signed in), and
      // only ever touches `ownerUserId`'s own data and server account.
      const epoch = currentAuthEpoch();
      const isCurrent = () => epoch === currentAuthEpoch();
      // The user is back (or asked): failed syncs get the full retry schedule again.
      if (trigger === 'foreground' || trigger === 'pull') retryAttemptRef.current = 0;
      const previous = syncInFlightRef.current;
      if (previous) {
        if (previous.epoch === epoch) {
          // The running sync may already be past its upload: a local change
          // gets one more sync after it (any number of changes meanwhile
          // share that one), never a second sync in parallel.
          if (trigger === 'local-change') syncAgainForEpochRef.current = epoch;
          return;
        }
        await previous.promise.catch(() => undefined);
        if (!isCurrent() || syncInFlightRef.current) return;
      }

      const run = async (runTrigger: SyncTrigger) => {
        const startedAt = Date.now();
        devLog('sync', 'start', { trigger: runTrigger });
        lastForegroundSyncAtRef.current = startedAt;
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
          await legacyPreferencesRef.current;
          const latestToken = (await getSessionToken()) ?? token;
          if (!isCurrent()) return;
          sessionTokenRef.current = latestToken;
          const result = await runFullSync(latestToken, {
            ownerUserId,
            applyPreference: (field, value) => {
              if (isCurrent()) applyPreference(field, value);
            },
            promptForPassphrase,
            isCurrent,
          });
          // Screens showing this account's data pick up what was downloaded.
          if (isCurrent() && (result.favoritesSynced || result.reflectionsSynced)) notifyLocalDataChanged();
          if (isCurrent()) {
            const complete = result.preferencesSynced && result.readingSynced && result.favoritesSynced && result.reflectionsSynced;
            if (complete) retryAttemptRef.current = 0;
            // Something is still not on the account or this device (e.g. a
            // refused reading upload, a favorite not restorable yet): try again.
            else scheduleSyncRetry();
          }
          devLog('sync', 'done', { trigger: runTrigger, elapsedMs: Date.now() - startedAt, ...result });
        } catch (error) {
          // Sync failures never undo a successful sign-in or block app
          // usage (Part H §33) — the user is signed in and can keep using
          // the app; sync can be retried later (e.g. next app foreground).
          devLog('sync', 'failed', { trigger: runTrigger, elapsedMs: Date.now() - startedAt, kind: error instanceof Error ? error.name : 'unknown' });
          if (isCurrent()) scheduleSyncRetry();
        }
      };

      let runTrigger = trigger;
      for (;;) {
        const promise = run(runTrigger);
        syncInFlightRef.current = { epoch, promise };
        try {
          await promise;
        } finally {
          if (syncInFlightRef.current?.promise === promise) syncInFlightRef.current = null;
        }
        if (syncAgainForEpochRef.current !== epoch || !isCurrent() || syncInFlightRef.current) break;
        syncAgainForEpochRef.current = null;
        runTrigger = 'local-change';
      }
    },
    [promptForPassphrase, promptForGuestData, applyPreference, waitForPreferenceHydration, scheduleSyncRetry],
  );

  /**
   * أورادي وختماتي alone, for a reading change and for retries: the session
   * is all it needs, so it never waits for (or shows) the Sync Password
   * prompt, and runs whether reflections are unlocked or not. Pinned to the
   * signed-in account; stops if that session ends (auth/authEpoch.ts).
   * readingSync.ts runs one sync per account at a time.
   */
  const runReadingSync = useCallback(async () => {
    const ownerUserId = currentUserIdRef.current;
    if (!ownerUserId) return;
    const epoch = currentAuthEpoch();
    const isCurrent = () => epoch === currentAuthEpoch();
    lastReadingSyncAtRef.current = Date.now();
    try {
      const token = (await getSessionToken()) ?? sessionTokenRef.current;
      if (!token || !isCurrent()) return;
      const synced = await syncReading(token, ownerUserId, { isCurrent });
      if (!isCurrent()) return;
      // Success leaves the retry schedule alone: only a complete full sync
      // shows that everything else has synced too.
      if (!synced) scheduleSyncRetry();
    } catch {
      if (isCurrent()) scheduleSyncRetry();
    }
  }, [scheduleSyncRetry]);
  useEffect(() => {
    retrySyncRef.current = () => {
      const token = sessionTokenRef.current;
      if (token) void runSyncAfterSignIn(token, 'retry');
    };
  }, [runSyncAfterSignIn]);

  // Uploads a setting the user changes while signed in, as soon as it is
  // recorded for this account (sync/preferencesSyncState.ts). Best-effort:
  // offline or failed, it stays pending and the next full sync sends it.
  // Values applied from the account are never recorded, so they never echo
  // back here; a change recorded for another account is never sent with
  // this session's token.
  // Home's recent emotions: a choice made while signed in goes up the same way.
  useEffect(() => {
    const push = (owner: string) => {
      if (owner !== currentUserIdRef.current) return;
      const epoch = currentAuthEpoch();
      const isCurrent = () => epoch === currentAuthEpoch() && currentUserIdRef.current === owner;
      void (async () => {
        try {
          const token = (await getSessionToken()) ?? sessionTokenRef.current;
          if (!token || !isCurrent()) return;
          await pushPreferences(token, owner, applyPreference, { isCurrent });
        } catch {
          // Left for the next full sync — see above.
        }
      })();
    };
    const unsubscribeSettings = subscribeToLocalPreferenceChanges(push);
    const unsubscribeEmotions = subscribeToRecentEmotionChanges(push);
    return () => {
      unsubscribeSettings();
      unsubscribeEmotions();
    };
  }, [applyPreference]);

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
        // Then the settings made account settings on 2026-10-27, once (sync/devicePreferencesClaim.ts).
        legacyPreferencesRef.current = claimLegacyPreferenceChanges(userId).then(() => claimDevicePreferences(userId));
        void activateLocalDataForAccount(userId, () => epoch === currentAuthEpoch()).catch(() => {
          // Retried by the sync below; local data stays where it is.
        });
      } else if (session.status === 'signed-in') {
        void confirmRestoredLocalDataOwner().catch(() => {});
      } else {
        void activateGuestLocalData().catch(() => {
          // Re-evaluated on the next launch.
        });
        // A guest's settings on this device are never claimed by an account.
        void forgoDevicePreferencesClaim();
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
      void runSyncAfterSignIn(token, 'foreground');
    });
    return () => subscription.remove();
  }, [runSyncAfterSignIn]);

  // A reflection saved or deleted on this device is uploaded now, through
  // the same single-flight sync — not left waiting for the next foreground
  // or pull-to-refresh. Nothing happens for a guest (no session token).
  // Other devices still see it only at their own next sync.
  useEffect(() => subscribeToLocalChanges(() => {
    const token = sessionTokenRef.current;
    if (!token) return;
    void runSyncAfterSignIn(token, 'local-change');
  }), [runSyncAfterSignIn]);

  // أورادي وختماتي: a ورد, Khatma or active-ورد change made here is uploaded
  // shortly after (debounced), by the reading-only sync (no Sync Password).
  // A guest has no session token: nothing happens.
  useEffect(() => subscribeToLocalReadingChanges(() => {
    if (!sessionTokenRef.current) return;
    markReadingChangedLocally();
    if (readingDebounceRef.current) clearTimeout(readingDebounceRef.current);
    readingDebounceRef.current = setTimeout(() => {
      readingDebounceRef.current = null;
      void runReadingSync();
    }, READING_CHANGE_DEBOUNCE_MS);
  }), [runReadingSync]);
  useEffect(() => clearSyncTimers, [clearSyncTimers]);
  // No retry timer in the background; coming back runs the foreground sync.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' || !retryTimerRef.current) return;
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    });
    return () => subscription.remove();
  }, []);

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
      clearSyncTimers();
      retryAttemptRef.current = 0;
      resetReadingSyncStatus();
      // Before anything can sync: switch local data to this account's own
      // partition. Nothing moves into it here — guest data only on request
      // (see storage/localDataOwnership.ts). A storage failure here cannot
      // route data to the wrong account — every sync names its account
      // explicitly — so it does not block signing in.
      await activateLocalDataForAccount(signedInUser.id, isCurrent).catch(() => {});
      // An interactive sign-in asks about guest data again.
      await forgetGuestDataDecision(signedInUser.id).catch(() => {});
      // Settings: only this account's own are synced — never ones chosen as a guest or under another account.
      legacyPreferencesRef.current = Promise.all([discardLegacyPreferenceChanges(), forgoDevicePreferencesClaim()]).then(() => undefined);
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
    [runSyncAfterSignIn, rejectOpenPrompts, clearSyncTimers],
  );

  const signInWithGoogle = useCallback(
    async (idToken: string, ageDeclaration?: AccountAgeDeclaration) => {
      try {
        const { token, refreshToken, user: signedInUser } = await signInWithGoogleIdToken(idToken, ageDeclaration);
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
    async (idToken: string, authorizationCode?: string | null, ageDeclaration?: AccountAgeDeclaration) => {
      try {
        const { token, refreshToken, user: signedInUser } = await signInWithAppleIdToken(idToken, authorizationCode, ageDeclaration);
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
    clearSyncTimers();
    retryAttemptRef.current = 0;
    resetReadingSyncStatus();
    rejectOpenPrompts();
    discardUnfinishedKeySetup();
    hideAccountDataNow();
    setUser(null);
    setStatus('guest');
    legacyPreferencesRef.current = discardLegacyPreferenceChanges();
    discardWaitingAccountReminders();
    const cleared = (async () => {
      await activateGuestLocalData().catch(() => {});
      await clearPersistedSession(epoch);
    })();
    pendingSignOutRef.current = cleared;
    return cleared;
  }, [rejectOpenPrompts, clearSyncTimers]);

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
    await runSyncAfterSignIn(token, 'pull');
  }, [runSyncAfterSignIn]);

  const refreshReading = useCallback(async () => {
    if (!sessionTokenRef.current) return;
    await runReadingSync();
  }, [runReadingSync]);

  const syncOnFocus = useCallback((scope: FocusSyncScope) => {
    const token = sessionTokenRef.current;
    if (!token) return;
    const now = Date.now();
    // A full sync includes أورادي وختماتي, so it counts for both.
    const lastAt = scope === 'reading' ? Math.max(lastReadingSyncAtRef.current, lastForegroundSyncAtRef.current) : lastForegroundSyncAtRef.current;
    if (now - lastAt < FOCUS_RESYNC_THROTTLE_MS) return;
    if (scope === 'reading') void runReadingSync();
    // Single-flight: one already running is left to finish.
    else void runSyncAfterSignIn(token, 'focus');
  }, [runReadingSync, runSyncAfterSignIn]);

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
    // Kept other versions (D5) are this account's reflections too.
    if (deletedUserId) await clearAllConflictVersions(deletedUserId);
    await clearAllFavorites(deletedUserId ?? undefined);
    // The account's reading stops, Khatmas (also deleted on the server with the account), recent emotions and
    // settings-sync record on this device. The settings shown here stay as they are (device settings).
    if (deletedUserId) {
      await clearAccountReadingData(deletedUserId);
      await clearRecentEmotions(deletedUserId);
      await clearAccountPreferenceState(deletedUserId).catch(() => undefined);
    }
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
      refreshReading,
      syncOnFocus,
      deleteAccount,
    }),
    [status, user, lastError, signInWithGoogle, signInWithApple, signOut, clearLastError, refreshSync, refreshReading, syncOnFocus, deleteAccount],
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
