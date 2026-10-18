import type { AppLanguage } from '@/localization/locales';
import { getMessages } from '@/localization/messages';
import { MUSHAF_PAGE_COUNT, toArabicIndicDigits } from '@/mushaf/mushafPage';
import { getSurahName } from '@/services/surahNames';
import { parseAyahLinkParams } from '@/utils/ayahLink';

import { ayahNotificationExcerpt } from './ayahExcerpt';
import type { NotificationKind } from './types';

/**
 * What each reminder says and carries.
 *
 * Copy is in the App Language (English or Modern Standard Arabic), the final
 * approved wording (2026-10-17). The payload (`data`) holds only what the tap
 * needs — never a reflection, an account id, a token, or anything about the user:
 *  - Wird Reminder: its type and, when the copy names a ورد, that ورد's id
 *    (wirdTarget.ts: the one Home's Continue Reciting shows). The ورد's name and
 *    saved page are in the visible copy only, as of the last reconciliation (the
 *    OS shows what was scheduled; scheduler.ts reschedules on every change). The
 *    tap opens that ورد if it still exists for whoever is using the app then
 *    (responseRouting.ts), so a deleted ورد or another account's data is never opened.
 *  - Random Quran Ayah: its type and the verse (canonical "surah:ayah" key
 *    plus both numbers): the public Quran reference shown on the lock screen
 *    is exactly the one opened.
 *  - Emotional Check-in: its type. No emotion is chosen or recorded.
 * `v` is the payload version: a tap on an older version is still understood
 * (parseNotificationPayload), a newer unknown one opens the app without
 * navigating. Version 2 (2026-10-17): the Wird Reminder's `stopId`, and the new copy.
 */
export const NOTIFICATION_PAYLOAD_VERSION = 2;

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

/** The ورد a Wird Reminder names: its id, its name exactly as saved, and its saved page (1–604). */
export type WirdReminderTarget = { stopId: string; name: string; page: number };

export function isValidWirdTarget(target: WirdReminderTarget | null | undefined): target is WirdReminderTarget {
  return (
    !!target &&
    typeof target.stopId === 'string' &&
    target.stopId.length > 0 &&
    typeof target.name === 'string' &&
    target.name.trim().length > 0 &&
    Number.isInteger(target.page) &&
    target.page >= 1 &&
    target.page <= MUSHAF_PAGE_COUNT
  );
}

const RTL_CHARACTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_ONLY = /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF\s]+$/;
/** First-strong isolate (as the reader's Apply-to-ورد label), only for a name whose script runs against the copy's direction. */
const isolate = (text: string) => `\u2068${text}\u2069`;

/**
 * The ورد's name exactly as the user saved it — never translated — placed in the copy:
 *   en: "Continue your Evening reciting from page 125."
 *   ar: «أكمل وردك المسائي من الصفحة ١٢٥.» for a name that is an Arabic adjective («ال…»),
 *       «أكمل ورد رمضان من الصفحة ١٢٥.» for any other.
 * Arabic shows the page in Arabic-Indic digits.
 */
export function wirdReminderBody(locale: AppLanguage, target: WirdReminderTarget): string {
  const { notifications } = getMessages(locale);
  const { name } = target;
  if (locale === 'ar') {
    const template = name.startsWith('ال') ? notifications.wirdNotificationBodyPageDefinite : notifications.wirdNotificationBodyPage;
    return template.replace('{name}', ARABIC_ONLY.test(name) ? name : isolate(name)).replace('{page}', toArabicIndicDigits(target.page));
  }
  return notifications.wirdNotificationBodyPage.replace('{name}', RTL_CHARACTER.test(name) ? isolate(name) : name).replace('{page}', String(target.page));
}

/** With a valid ورد: its name and page, and its id for the tap. Without (none yet, or not known): the generic copy, nothing invented. */
export function wirdReminderContent(locale: AppLanguage, target: WirdReminderTarget | null = null): NotificationContent {
  const { notifications } = getMessages(locale);
  if (!isValidWirdTarget(target)) {
    return { title: notifications.wirdNotificationTitle, body: notifications.wirdNotificationBody, data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'wird' } };
  }
  return {
    title: notifications.wirdNotificationTitle,
    body: wirdReminderBody(locale, target),
    data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'wird', stopId: target.stopId },
  };
}

export function emotionCheckInContent(locale: AppLanguage): NotificationContent {
  const { notifications } = getMessages(locale);
  return { title: notifications.checkInNotificationTitle, body: notifications.checkInNotificationBody, data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'emotionCheckIn' } };
}

/**
 * The verse's reference under it, from the verified local surah names (services/surahNames.ts):
 *   en: "Ash-Sharh · 94:5"     ar: «سورة الشرح · الآية ٥» (Arabic-Indic digits)
 */
export function randomAyahReference(locale: AppLanguage, surah: number, ayah: number): string {
  const { nameEnglish, nameArabic } = getSurahName(surah);
  const template = getMessages(locale).notifications.randomAyahNotificationReference;
  if (locale === 'ar') return template.replace('{surah}', nameArabic).replace('{ayah}', toArabicIndicDigits(ayah));
  return template.replace('{surah}', nameEnglish).replace('{chapter}', String(surah)).replace('{ayah}', String(ayah));
}

/**
 * The verse exactly as quran.sqlite holds it (or an exact whole-word excerpt), a blank line, then its reference, all in
 * the body (Android shows no subtitle, so both platforms read the same).
 */
export function randomAyahContent(locale: AppLanguage, verse: { surah: number; ayah: number; verseKey: string; arabicText: string }): NotificationContent {
  const { notifications } = getMessages(locale);
  return {
    title: notifications.randomAyahNotificationTitle,
    body: `${ayahNotificationExcerpt(verse.arabicText).text}\n\n${randomAyahReference(locale, verse.surah, verse.ayah)}`,
    data: { v: NOTIFICATION_PAYLOAD_VERSION, kind: 'randomAyah', verseKey: verse.verseKey, surah: verse.surah, ayah: verse.ayah },
  };
}

export type NotificationPayload =
  | { kind: 'wird'; stopId?: string }
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
  if (payload.kind === 'wird') {
    // Version 1 carried no ورد; a damaged id is ignored (the tap then falls back as version 1 did).
    const { stopId } = payload;
    return typeof stopId === 'string' && stopId.length > 0 && stopId.length <= 100 ? { kind: 'wird', stopId } : { kind: 'wird' };
  }
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
