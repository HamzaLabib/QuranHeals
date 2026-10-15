import type { AppLanguage } from '@/localization/locales';
import { getMessages } from '@/localization/messages';
import { parseAyahLinkParams } from '@/utils/ayahLink';
import { formatAyahReference } from '@/utils/ayahReference';

import { ayahNotificationExcerpt } from './ayahExcerpt';
import type { NotificationKind } from './types';

/**
 * What each reminder says and carries.
 *
 * Copy is in the App Language (English or Modern Standard Arabic). The
 * payload (`data`) holds only what the tap needs — never a reflection, an
 * account id, a token, a ورد name or page, or anything about the user:
 *  - Wird Reminder: its type. Which ورد to open is decided when it is tapped,
 *    from the reading data of whoever is using the app then (responseRouting.ts),
 *    so a deleted ورد or another account's data is never involved.
 *  - Random Quran Ayah: its type and the verse (canonical "surah:ayah" key
 *    plus both numbers): the public Quran reference shown on the lock screen
 *    is exactly the one opened.
 *  - Emotional Check-in: its type. No emotion is chosen or recorded.
 * `v` is the payload version: a tap on an older version is still understood
 * (parseNotificationPayload), a newer unknown one opens the app without
 * navigating.
 */
export const NOTIFICATION_PAYLOAD_VERSION = 1;

/** Every identifier this app schedules starts with this; nothing else is ever cancelled. */
export const NOTIFICATION_ID_PREFIX = 'quranheals.';
const KIND_SLUGS: Record<NotificationKind, string> = { wird: 'wird', randomAyah: 'ayah', emotionCheckIn: 'checkin' };

export function notificationIdPrefix(kind: NotificationKind): string {
  return `${NOTIFICATION_ID_PREFIX}${KIND_SLUGS[kind]}.`;
}

/** The kind an identifier belongs to, or null for one this app did not create. */
export function kindOfNotificationId(identifier: string): NotificationKind | null {
  for (const kind of Object.keys(KIND_SLUGS) as NotificationKind[]) {
    if (identifier.startsWith(notificationIdPrefix(kind))) return kind;
  }
  return null;
}

/** Android notification channels: one per type, so each can be silenced on its own in the device settings. */
export const ANDROID_CHANNEL_IDS: Record<NotificationKind, string> = {
  wird: 'wird-reminder',
  randomAyah: 'random-ayah',
  emotionCheckIn: 'emotional-check-in',
};

export function channelNames(locale: AppLanguage): Record<NotificationKind, string> {
  const { notifications } = getMessages(locale);
  return { wird: notifications.wirdReminderTitle, randomAyah: notifications.randomAyahTitle, emotionCheckIn: notifications.emotionCheckInTitle };
}

export type NotificationContent = { title: string; subtitle?: string; body: string; data: Record<string, unknown> };

export function wirdReminderContent(locale: AppLanguage): NotificationContent {
  const { notifications } = getMessages(locale);
  return { title: notifications.wirdNotificationTitle, body: notifications.wirdNotificationBody, data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'wird' } };
}

export function emotionCheckInContent(locale: AppLanguage): NotificationContent {
  const { notifications } = getMessages(locale);
  return { title: notifications.checkInNotificationTitle, body: notifications.checkInNotificationBody, data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'emotionCheckIn' } };
}

/** The verse exactly as quran.sqlite holds it (or an exact whole-word excerpt), with its reference. */
export function randomAyahContent(locale: AppLanguage, verse: { surah: number; ayah: number; verseKey: string; arabicText: string }): NotificationContent {
  const { notifications } = getMessages(locale);
  return {
    title: notifications.randomAyahNotificationTitle,
    subtitle: formatAyahReference(verse.surah, verse.ayah),
    body: ayahNotificationExcerpt(verse.arabicText).text,
    data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'randomAyah', verseKey: verse.verseKey, surah: verse.surah, ayah: verse.ayah },
  };
}

export type NotificationPayload =
  | { kind: 'wird' }
  | { kind: 'emotionCheckIn' }
  | { kind: 'randomAyah'; verseKey: string; surah: number; ayah: number };

/**
 * A tapped notification's payload, validated. Null for anything this app did
 * not send, a newer payload version, or a verse reference that does not exist
 * or whose key and numbers disagree — never guessed, never re-randomized.
 */
export function parseNotificationPayload(data: unknown): NotificationPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const payload = data as Record<string, unknown>;
  if (typeof payload.v !== 'number' || !Number.isInteger(payload.v) || payload.v < 1 || payload.v > NOTIFICATION_PAYLOAD_VERSION) return null;
  if (payload.kind === 'wird') return { kind: 'wird' };
  if (payload.kind === 'emotionCheckIn') return { kind: 'emotionCheckIn' };
  if (payload.kind === 'randomAyah') {
    const { surah, ayah, verseKey } = payload;
    if (typeof surah !== 'number' || typeof ayah !== 'number') return null;
    const key = parseAyahLinkParams(String(surah), String(ayah));
    if (!key || key !== verseKey) return null;
    return { kind: 'randomAyah', verseKey: key, surah, ayah };
  }
  return null;
}
