import type { AppLanguage } from '@/localization/locales';
import { getMessages } from '@/localization/messages';
import { parseVerseKey } from '@/services/quranReference';

import type { NotificationsApi, PendingNotification, ReminderTrigger } from './api';
import { AYAH_RECENT_LIMIT, type AyahQueue, type AyahQueueStore } from './ayahQueue';
import {
  NOTIFICATION_PAYLOAD_VERSION,
  channelNames,
  emotionCheckInContent,
  kindOfNotificationId,
  notificationIdPrefix,
  randomAyahContent,
  wirdReminderContent,
  type NotificationContent,
  type WirdReminderTarget,
} from './content';
import { formatStoredTime } from './preferences';
import { nextOccurrences, weekdayOfDate, type Occurrence } from './recurrence';
import {
  type NotificationKind,
  type NotificationPermission,
  type NotificationPreferences,
  type ReminderPreference,
  type ReminderScheduleState,
} from './types';
import type { WirdTargetLookup } from './wirdTarget';

/**
 * The one place reminders are registered with the OS. `reconcile()` compares
 * what should be pending (the saved settings, the OS permission, the App
 * Language, today's date) with what is pending, and changes only the
 * difference:
 *  - a pending reminder whose identifier and signature (`data.sig`: trigger,
 *    copy, language, verse, payload version) match is left alone;
 *  - one no longer wanted, or with a different signature, is cancelled;
 *  - a missing one is added.
 * So running it again changes nothing (idempotent), changing one reminder
 * touches only that reminder's notifications, and identifiers never collide
 * across types (two reminders at 21:00 are two separate requests).
 *
 * Capacity (iOS keeps at most 64 pending local notifications per app; the
 * app uses at most PENDING_BUDGET = 60, leaving a margin):
 *  - Daily and Weekly Wird / Check-in: one repeating request each, repeated
 *    by the OS indefinitely for as long as it stays scheduled.
 *  - Twice Daily Check-in: two repeating daily requests (`checkin.twice.morning`,
 *    `checkin.twice.evening`), likewise repeated by the OS indefinitely; they
 *    take two fixed slots of the budget and never any dated ones, so the
 *    Wird and Random Ayah runs lose only one slot of horizon to them.
 *  - Everything else is a run of dated requests: Every-3-days Wird / Check-in
 *    (no OS trigger can express "every third calendar day at a local time"),
 *    and the Random Quran Ayah at any frequency (each delivery shows its own
 *    preselected verse; a repeating request cannot change its text, and app
 *    code cannot run when a local notification is delivered).
 * The dated runs share what the repeating requests leave of the budget,
 * filled earliest-first across all of them (allocateDated), so they all
 * reach the same horizon and no slot is wasted: with the defaults (Wird
 * Daily, Check-in Every 3 days, Random Ayah Daily) about 44 days ahead. They
 * are refilled at every launch and return to the app; if the app is not
 * opened for longer than that horizon, the dated reminders stop until it is.
 * The horizon depends on the three settings together, so changing one
 * reminder may lengthen or shorten the far end of another's run (only its
 * last entries; everything nearer is kept as it is).
 *
 * Content is fixed when a request is scheduled: the OS shows exactly what was
 * registered and runs no app code at delivery. So the Wird Reminder's copy
 * (the ورد's name and saved page, wirdTarget.ts) is read at every
 * reconciliation, and its signature includes them: a change of page, a rename,
 * a deletion or another active ورد replaces just that request (the provider
 * reconciles on every reading-data and owner change). A ورد changed on another
 * device reaches this one's reminder once this app syncs it.
 *
 * Calls are serialized: one reconciliation at a time, and requests arriving
 * meanwhile are merged into one more run afterwards (rapid taps, a foreground
 * event during a settings change), so they can never interleave and add
 * duplicates.
 */
export const IOS_PENDING_LIMIT = 64;
export const PENDING_BUDGET = 60;
const RECONCILE_ORDER: readonly NotificationKind[] = ['wird', 'emotionCheckIn', 'randomAyah'];

/** Whether a reminder needs a run of dated requests (rather than one OS-repeated request). */
export function needsDatedRun(kind: NotificationKind, preference: Pick<ReminderPreference, 'frequency'>): boolean {
  return kind === 'randomAyah' || preference.frequency === 'every3days';
}

/** How many OS-repeated requests a reminder that needs no dated run keeps pending: two for Twice Daily, else one. */
export function repeatingSlots(preference: Pick<ReminderPreference, 'frequency' | 'twice'>): number {
  return preference.frequency === 'twiceDaily' && preference.twice && !sameLocalTime(preference.twice.morning, preference.twice.evening) ? 2 : 1;
}

function sameLocalTime(a: { hour: number; minute: number }, b: { hour: number; minute: number }): boolean {
  return a.hour === b.hour && a.minute === b.minute;
}

/**
 * Shares `budget` dated slots among the reminders that need them: the next
 * occurrences of all of them, merged in time order (ties: Wird, Check-in,
 * Random Ayah), first `budget` kept. So every run covers the same horizon,
 * and as days pass new slots are only ever added at the far end.
 */
export function allocateDated(
  dated: readonly { kind: NotificationKind; preference: ReminderPreference }[],
  budget: number,
  now: Date,
): Map<NotificationKind, Occurrence[]> {
  const merged = dated.flatMap(({ kind, preference }) => nextOccurrences(preference, now, Math.max(0, budget)).map((occurrence) => ({ kind, occurrence })));
  merged.sort((a, b) => a.occurrence.at.getTime() - b.occurrence.at.getTime() || RECONCILE_ORDER.indexOf(a.kind) - RECONCILE_ORDER.indexOf(b.kind));
  const result = new Map<NotificationKind, Occurrence[]>(dated.map(({ kind }) => [kind, []]));
  for (const { kind, occurrence } of merged.slice(0, Math.max(0, budget))) result.get(kind)!.push(occurrence);
  return result;
}

export type VerseSource = {
  getVerseByKey(verseKey: string): Promise<{ surah: number; ayah: number; verseKey: string; arabicText: string }>;
  getRandomVerseKey(excludedVerseKeys: string[]): Promise<string>;
};

export type SchedulerDeps = {
  api: NotificationsApi;
  now: () => Date;
  verses: VerseSource;
  ayahQueue: AyahQueueStore;
  /** The ورد the Wird Reminder names (wirdTarget.ts). Absent (tests): none, the generic copy. */
  wirdTarget?: () => Promise<WirdTargetLookup>;
};

/** What to schedule for: the saved settings and the App Language (the reminders' copy). */
export type ReconcileInputs = { preferences: NotificationPreferences; locale: AppLanguage };

export type ReconcileResult = { permission: NotificationPermission; states: Record<NotificationKind, ReminderScheduleState> };

type DesiredRequest = {
  identifier: string;
  signature: string;
  trigger: ReminderTrigger;
  build: () => Promise<NotificationContent>;
};

function triggerKey(trigger: ReminderTrigger): string {
  if (trigger.type === 'daily') return `daily@${formatStoredTime(trigger)}`;
  if (trigger.type === 'weekly') return `weekly@${trigger.weekday}@${formatStoredTime(trigger)}`;
  return `date@${trigger.date.getTime()}`;
}

function signatureOf(kind: NotificationKind, trigger: ReminderTrigger, locale: AppLanguage, contentKey: string): string {
  return [NOTIFICATION_PAYLOAD_VERSION, kind, triggerKey(trigger), locale, contentKey].join('|');
}

function verseKeyOf(value: unknown): string | null {
  try {
    return parseVerseKey(value).verseKey;
  } catch {
    return null;
  }
}

function allStates(state: ReminderScheduleState): Record<NotificationKind, ReminderScheduleState> {
  return { wird: state, randomAyah: state, emotionCheckIn: state };
}

export function createNotificationScheduler(deps: SchedulerDeps) {
  let channelsLocale: AppLanguage | null = null;

  /** Wird Reminder and Emotional Check-in: fixed copy, so Daily/Weekly repeat natively; Every 3 days is a run of dated requests. */
  function fixedDesired(
    kind: 'wird' | 'emotionCheckIn',
    preference: ReminderPreference,
    locale: AppLanguage,
    now: Date,
    dated: Occurrence[],
    wirdTarget: WirdReminderTarget | null,
  ): DesiredRequest[] {
    const content = kind === 'wird' ? wirdReminderContent(locale, wirdTarget) : emotionCheckInContent(locale);
    const contentKey = `${content.title}|${content.body}|${String(content.data.stopId ?? '')}`;
    const prefix = notificationIdPrefix(kind);
    const make = (identifier: string, trigger: ReminderTrigger): DesiredRequest => ({
      identifier,
      trigger,
      signature: signatureOf(kind, trigger, locale, contentKey),
      build: async () => content,
    });
    const { hour, minute } = preference.time;
    if (preference.frequency === 'daily') return [make(`${prefix}daily`, { type: 'daily', hour, minute })];
    if (preference.frequency === 'twiceDaily') {
      // Two daily repeating requests, one per time, with their own identifiers; the same copy and tap target.
      const twice = preference.twice ?? { morning: { hour: 9, minute: 0 }, evening: preference.time };
      const morning = make(`${prefix}twice.morning`, { type: 'daily', hour: twice.morning.hour, minute: twice.morning.minute });
      // Equal times (never saved: preferences.ts refuses them) would be one reminder twice: kept once.
      if (sameLocalTime(twice.morning, twice.evening)) return [morning];
      return [morning, make(`${prefix}twice.evening`, { type: 'daily', hour: twice.evening.hour, minute: twice.evening.minute })];
    }
    if (preference.frequency === 'weekly') {
      const weekday = preference.weekday ?? weekdayOfDate(now);
      return [make(`${prefix}weekly`, { type: 'weekly', weekday, hour, minute })];
    }
    return dated.map((occurrence) => make(`${prefix}d.${occurrence.date}`, { type: 'date', date: occurrence.at }));
  }

  /** Random Quran Ayah: one dated request per delivery, each with the verse preselected for its date (ayahQueue.ts). */
  async function randomAyahDesired(occurrences: Occurrence[], locale: AppLanguage, pending: PendingNotification[]): Promise<DesiredRequest[]> {
    const prefix = notificationIdPrefix('randomAyah');
    const wantedDates = new Set(occurrences.map((occurrence) => occurrence.date));
    const queue = await deps.ayahQueue.load();
    // A verse already scheduled is kept even if the stored queue was lost.
    const pendingVerse = new Map<string, string>();
    for (const entry of pending) {
      const key = verseKeyOf(entry.data.verseKey);
      if (key && entry.identifier.startsWith(prefix)) pendingVerse.set(entry.identifier.slice(prefix.length), key);
    }
    const next: AyahQueue = { entries: {}, recent: [...queue.recent] };
    let changed = false;
    for (const [date, key] of Object.entries(queue.entries)) {
      if (!wantedDates.has(date)) {
        next.recent.push(key);
        changed = true;
      }
    }
    const used = new Set<string>();
    for (const occurrence of occurrences) {
      let key: string | null = queue.entries[occurrence.date] ?? pendingVerse.get(occurrence.date) ?? null;
      if (key && used.has(key)) key = null;
      if (!key) {
        key = await deps.verses.getRandomVerseKey([...new Set([...next.recent.slice(-AYAH_RECENT_LIMIT), ...used])]);
      }
      if (queue.entries[occurrence.date] !== key) changed = true;
      used.add(key);
      next.entries[occurrence.date] = key;
    }
    next.recent = next.recent.slice(-AYAH_RECENT_LIMIT);
    if (changed) await deps.ayahQueue.save(next);

    const title = getMessages(locale).notifications.randomAyahNotificationTitle;
    return occurrences.map((occurrence) => {
      const verseKey = next.entries[occurrence.date];
      const trigger: ReminderTrigger = { type: 'date', date: occurrence.at };
      return {
        identifier: `${prefix}${occurrence.date}`,
        trigger,
        signature: signatureOf('randomAyah', trigger, locale, `${title}|${verseKey}`),
        build: async () => randomAyahContent(locale, await deps.verses.getVerseByKey(verseKey)),
      };
    });
  }

  async function reconcileKind(kind: NotificationKind, desired: DesiredRequest[], pending: PendingNotification[]): Promise<ReminderScheduleState> {
    const mine = pending.filter((entry) => kindOfNotificationId(entry.identifier) === kind);
    const wanted = new Map(desired.map((request) => [request.identifier, request]));
    const kept = new Set<string>();
    for (const entry of mine) {
      const request = wanted.get(entry.identifier);
      if (request && entry.data.sig === request.signature && !kept.has(entry.identifier)) {
        kept.add(entry.identifier);
        continue;
      }
      await deps.api.cancel(entry.identifier);
    }
    let failed = false;
    for (const request of desired) {
      if (kept.has(request.identifier)) continue;
      try {
        const content = await request.build();
        await deps.api.schedule({
          identifier: request.identifier,
          kind,
          content: { ...content, data: { ...content.data, sig: request.signature } },
          trigger: request.trigger,
        });
        kept.add(request.identifier);
      } catch {
        failed = true;
      }
    }
    if (failed && kept.size === 0) return { state: 'error' };
    return { state: 'scheduled', pending: kept.size };
  }

  async function run({ preferences, locale }: ReconcileInputs): Promise<ReconcileResult> {
    if (!deps.api.supported) return { permission: { status: 'unsupported', canAskAgain: false }, states: allStates({ state: 'unsupported' }) };
    const now = deps.now();
    let permission: NotificationPermission;
    try {
      permission = await deps.api.getPermission();
    } catch {
      return { permission: { status: 'undetermined', canAskAgain: false }, states: allStates({ state: 'error' }) };
    }
    if (channelsLocale !== locale) {
      try {
        await deps.api.ensureChannels(channelNames(locale));
        channelsLocale = locale;
      } catch {
        // Retried on the next run; Android then posts on the existing channel (or none yet) as before.
      }
    }
    let pending: PendingNotification[];
    try {
      pending = await deps.api.getPending();
    } catch {
      return { permission, states: allStates({ state: 'error' }) };
    }

    const allowed = permission.status === 'granted';
    const active = RECONCILE_ORDER.filter((kind) => allowed && preferences[kind].enabled);
    const repeating = active.filter((kind) => !needsDatedRun(kind, preferences[kind])).reduce((sum, kind) => sum + repeatingSlots(preferences[kind]), 0);
    const datedRuns = allocateDated(
      active.filter((kind) => needsDatedRun(kind, preferences[kind])).map((kind) => ({ kind, preference: preferences[kind] })),
      PENDING_BUDGET - repeating,
      now,
    );

    // The ورد the Wird Reminder names, read now (a failed read: the generic copy, never a guess).
    let wird: WirdTargetLookup = { known: true, target: null };
    if (allowed && preferences.wird.enabled && deps.wirdTarget) {
      wird = await deps.wirdTarget().catch((): WirdTargetLookup => ({ known: true, target: null }));
    }

    const states = {} as Record<NotificationKind, ReminderScheduleState>;
    // The fixed-copy reminders first: they never wait for the Quran database, which only the Random Quran Ayah reads.
    for (const kind of RECONCILE_ORDER) {
      const preference = preferences[kind];
      try {
        if (kind === 'wird' && preference.enabled && allowed && !wird.known) {
          // Whose ورد it is is not known yet (launch, sign-in state unresolved): what is scheduled stays as it is, and the
          // owner's resolution reconciles again. Nothing scheduled yet: the generic copy meanwhile.
          const mine = pending.filter((entry) => kindOfNotificationId(entry.identifier) === 'wird').length;
          if (mine > 0) {
            states[kind] = { state: 'scheduled', pending: mine };
            continue;
          }
        }
        let desired: DesiredRequest[] = [];
        if (preference.enabled && allowed) {
          const dated = datedRuns.get(kind) ?? [];
          const target = wird.known ? wird.target : null;
          desired = kind === 'randomAyah' ? await randomAyahDesired(dated, locale, pending) : fixedDesired(kind, preference, locale, now, dated, target);
        }
        // Turned off, or not allowed by the OS: this type's pending reminders are removed (only this type's).
        const result = await reconcileKind(kind, desired, pending);
        states[kind] = !preference.enabled ? { state: 'off' } : !allowed ? { state: 'needsPermission' } : result;
      } catch {
        states[kind] = { state: 'error' };
      }
    }
    return { permission, states };
  }

  let current: Promise<ReconcileResult> | null = null;
  let queued: Promise<ReconcileResult> | null = null;
  let latest: ReconcileInputs | null = null;

  /** Always schedules for the newest inputs: a run queued behind another uses whatever was passed last. */
  function reconcile(inputs: ReconcileInputs): Promise<ReconcileResult> {
    latest = inputs;
    if (!current) {
      current = run(latest).finally(() => {
        current = null;
      });
      return current;
    }
    queued ??= current.catch(() => undefined).then(() => {
      queued = null;
      return reconcile(latest!);
    });
    return queued;
  }

  return { reconcile };
}

export type NotificationScheduler = ReturnType<typeof createNotificationScheduler>;
