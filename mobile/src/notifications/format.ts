import type { AppLanguage } from '@/localization/locales';
import type { Messages } from '@/localization/messages';

import type { LocalTime, ReminderFrequency, TwiceDailyTimes, Weekday } from './types';

/**
 * How a reminder's schedule reads in Settings. Deterministic (no Intl): the
 * device's 12/24-hour setting decides the clock style (localization/
 * deviceLocale.ts; unknown → 12-hour in English, 24-hour in Arabic), and
 * Arabic uses Arabic-Indic digits like the rest of its copy ("كل ٣ أيام").
 *   en: "9:00 PM" / "21:00"     ar: "٩:٠٠ م" / "٢١:٠٠"
 */
const ARABIC_INDIC = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function localizeDigits(text: string, locale: AppLanguage): string {
  return locale === 'ar' ? text.replace(/[0-9]/g, (digit) => ARABIC_INDIC[Number(digit)]) : text;
}

export function formatReminderTime(time: LocalTime, locale: AppLanguage, messages: Messages, uses24HourClock: boolean | null): string {
  const minutes = String(time.minute).padStart(2, '0');
  const twentyFour = uses24HourClock ?? locale === 'ar';
  if (twentyFour) return localizeDigits(`${String(time.hour).padStart(2, '0')}:${minutes}`, locale);
  const hour12 = time.hour % 12 === 0 ? 12 : time.hour % 12;
  const suffix = time.hour < 12 ? messages.notifications.am : messages.notifications.pm;
  return `${localizeDigits(`${hour12}:${minutes}`, locale)} ${suffix}`;
}

export function weekdayName(weekday: Weekday, messages: Messages): string {
  return messages.notifications[`weekday${weekday}`];
}

export function frequencyLabel(frequency: ReminderFrequency, messages: Messages): string {
  if (frequency === 'daily') return messages.notifications.frequencyDaily;
  if (frequency === 'every3days') return messages.notifications.frequencyEvery3Days;
  if (frequency === 'twiceDaily') return messages.notifications.frequencyTwiceDaily;
  return messages.notifications.frequencyWeekly;
}

/** The full schedule in words, for screen readers: "Weekly · Sunday · 9:00 PM", "Twice Daily · Morning 9:00 AM · Evening 9:00 PM". */
export function scheduleSummary(
  preference: { frequency: ReminderFrequency; time: LocalTime; weekday: Weekday | null; twice?: TwiceDailyTimes | null },
  locale: AppLanguage,
  messages: Messages,
  uses24HourClock: boolean | null,
): string {
  const parts = [frequencyLabel(preference.frequency, messages)];
  if (preference.frequency === 'twiceDaily' && preference.twice) {
    const n = messages.notifications;
    parts.push(`${n.twiceMorning} ${formatReminderTime(preference.twice.morning, locale, messages, uses24HourClock)}`);
    parts.push(`${n.twiceEvening} ${formatReminderTime(preference.twice.evening, locale, messages, uses24HourClock)}`);
    return parts.join(' · ');
  }
  if (preference.frequency === 'weekly' && preference.weekday) parts.push(weekdayName(preference.weekday, messages));
  parts.push(formatReminderTime(preference.time, locale, messages, uses24HourClock));
  return parts.join(' · ');
}
