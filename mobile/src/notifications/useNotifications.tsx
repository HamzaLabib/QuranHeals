import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { subscribeToReadingData } from '@/mushaf/readingStops';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';

import type { NotificationsApi } from './api';
import { asyncStorageAyahQueueStore } from './ayahQueue';
import { isMushafReadingFocused } from './foreground';
import { platformNotificationsApi } from './platformApi';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  applyReminderChange,
  completeSchedules,
  loadNotificationPreferences,
  saveNotificationPreferences,
} from './preferences';
import { createNotificationScheduler, type NotificationScheduler } from './scheduler';
import type {
  LocalTime,
  NotificationKind,
  NotificationPermission,
  NotificationPreferences,
  ReminderFrequency,
  ReminderScheduleState,
  TwiceDailySlot,
  Weekday,
} from './types';
import { loadWirdReminderTarget, type WirdTargetLookup } from './wirdTarget';

/** One change from Settings. `twiceTime`: one of Twice Daily's two times (the single `time` is never touched by it). */
export type ReminderChange = { enabled?: boolean; frequency?: ReminderFrequency; time?: LocalTime; weekday?: Weekday; twiceTime?: { slot: TwiceDailySlot; time: LocalTime } };

export type NotificationsContextValue = {
  preferences: NotificationPreferences;
  /** OS authorization, apart from the user's wish (preferences[kind].enabled). */
  permission: NotificationPermission;
  /** What the last reconciliation actually registered, per type. */
  states: Record<NotificationKind, ReminderScheduleState | null>;
  isReady: boolean;
  supported: boolean;
  /** Saves at once and reschedules only what changed. */
  update: (kind: NotificationKind, change: ReminderChange) => void;
  /** Shows the OS prompt (only from a user's tap in Settings), then schedules what is ON. */
  requestPermission: () => Promise<NotificationPermission>;
  openSystemSettings: () => void;
};

const UNKNOWN_STATES: Record<NotificationKind, ReminderScheduleState | null> = { wird: null, randomAyah: null, emotionCheckIn: null };

const DEFAULT_CONTEXT: NotificationsContextValue = {
  preferences: DEFAULT_NOTIFICATION_PREFERENCES,
  permission: { status: 'unsupported', canAskAgain: false },
  states: UNKNOWN_STATES,
  isReady: true,
  supported: false,
  update: () => undefined,
  requestPermission: async () => ({ status: 'unsupported', canAskAgain: false }),
  openSystemSettings: () => undefined,
};

const NotificationsContext = createContext<NotificationsContextValue>(DEFAULT_CONTEXT);

/** The verified local Quran, loaded only when a Random Quran Ayah is actually scheduled (never on web or in tests). */
const localQuranVerses = {
  getVerseByKey: async (verseKey: string) => (await import('@/services/quran')).getVerseByKey(verseKey),
  getRandomVerseKey: async (excluded: string[]) => (await import('@/services/quran')).getRandomVerseKey(excluded),
};

type ProviderProps = {
  children?: ReactNode;
  /** Tests: a fake platform and scheduler inputs. */
  api?: NotificationsApi;
  now?: () => Date;
  verses?: typeof localQuranVerses;
  wirdTarget?: () => Promise<WirdTargetLookup>;
};

/**
 * The three reminders' settings and their schedule (docs/notifications.md).
 * Inside AppLocaleProvider: the reminders' copy follows the App Language.
 *
 * Reconciles (scheduler.ts) — never on an ordinary render — when:
 *  - the settings and the App Language have loaded (launch);
 *  - the app returns to the foreground (OS permission re-read: granted or
 *    revoked in device Settings meanwhile; the time zone or date may have
 *    changed; dated reminders are refilled);
 *  - a reminder setting changes, or the App Language changes (new copy; the
 *    same preselected verses);
 *  - the reading data changes (a page saved, a ورد renamed, deleted or chosen,
 *    another device's change synced) or the active owner does (sign-in,
 *    sign-out, the sign-in state resolved at launch): the Wird Reminder names
 *    the current ورد and page (wirdTarget.ts). Only a request whose copy
 *    changed is replaced (scheduler.ts).
 * Never asks for OS permission by itself.
 */
export function NotificationsProvider({
  children,
  api = platformNotificationsApi,
  now = () => new Date(),
  verses = localQuranVerses,
  wirdTarget = loadWirdReminderTarget,
}: ProviderProps) {
  const { locale, isReady: isLocaleReady } = useAppLocale();
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [isLoaded, setIsLoaded] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(
    api.supported ? { status: 'undetermined', canAskAgain: true } : { status: 'unsupported', canAskAgain: false },
  );
  const [states, setStates] = useState(UNKNOWN_STATES);

  const preferencesRef = useRef(preferences);
  // Until the saved settings are read, nothing is scheduled, and a change made meanwhile is kept and replayed over them.
  const loadedRef = useRef(false);
  const changesBeforeLoad = useRef<{ kind: NotificationKind; change: ReminderChange }[]>([]);
  const localeRef = useRef(locale);
  const [clock] = useState(() => now);

  const [scheduler] = useState<NotificationScheduler>(() =>
    createNotificationScheduler({ api, now: clock, verses, ayahQueue: asyncStorageAyahQueueStore, wirdTarget }),
  );

  const reconcile = useCallback(() => {
    if (!loadedRef.current) return;
    void scheduler.reconcile({ preferences: preferencesRef.current, locale: localeRef.current }).then((result) => {
      setPermission(result.permission);
      setStates(result.states);
    }).catch(() => undefined);
  }, [scheduler]);

  useEffect(() => {
    api.setForegroundPresentation(isMushafReadingFocused);
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    void loadNotificationPreferences().then(async (loaded) => {
      const completed = completeSchedules(loaded, clock());
      let next = completed.preferences;
      for (const { kind, change } of changesBeforeLoad.current) next = applyReminderChange(next, kind, change, clock());
      const replayed = changesBeforeLoad.current.length > 0;
      changesBeforeLoad.current = [];
      if (completed.changed || replayed) await saveNotificationPreferences(next);
      if (cancelled) return;
      preferencesRef.current = next;
      loadedRef.current = true;
      setPreferences(next);
      setIsLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [clock]);

  const isReady = isLoaded && isLocaleReady;

  // Launch, and every App Language change (the ref first: the scheduler reads the language from it).
  useEffect(() => {
    localeRef.current = locale;
    if (isReady) reconcile();
  }, [isReady, locale, reconcile]);

  // The Wird Reminder's ورد or page changed, or whose data is shown did.
  useEffect(() => {
    if (!isReady) return undefined;
    const unsubscribeData = subscribeToReadingData(reconcile);
    const unsubscribeOwner = subscribeToLocalDataOwner(() => reconcile());
    return () => {
      unsubscribeData();
      unsubscribeOwner();
    };
  }, [isReady, reconcile]);

  // Return to the foreground.
  useEffect(() => {
    if (!isReady) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') reconcile();
    });
    return () => subscription.remove();
  }, [isReady, reconcile]);

  const update = useCallback((kind: NotificationKind, change: ReminderChange) => {
    const next = applyReminderChange(preferencesRef.current, kind, change, clock());
    preferencesRef.current = next;
    setPreferences(next);
    if (!loadedRef.current) {
      // Shown at once; saved (over the stored settings, not the defaults) and scheduled once they have loaded.
      changesBeforeLoad.current.push({ kind, change });
      return;
    }
    void saveNotificationPreferences(next);
    reconcile();
  }, [clock, reconcile]);

  const requestPermission = useCallback(async () => {
    let result: NotificationPermission;
    try {
      result = await api.requestPermission();
    } catch {
      result = await api.getPermission().catch(() => ({ status: 'undetermined' as const, canAskAgain: false }));
    }
    setPermission(result);
    reconcile();
    return result;
  }, [api, reconcile]);

  const openSystemSettings = useCallback(() => {
    api.openSystemSettings().catch(() => undefined);
  }, [api]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ preferences, permission, states, isReady, supported: api.supported, update, requestPermission, openSystemSettings }),
    [preferences, permission, states, isReady, api.supported, update, requestPermission, openSystemSettings],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** Outside the provider (a component rendered alone in a test): the defaults, unsupported, with setters that do nothing. */
export function useNotifications(): NotificationsContextValue {
  return useContext(NotificationsContext);
}
