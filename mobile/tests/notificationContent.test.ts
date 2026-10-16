import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

const focus = vi.hoisted(() => ({ focused: true }));
vi.mock('expo-router', () => ({ useIsFocused: () => focus.focused }));

const { ANDROID_CHANNEL_IDS, channelNames, emotionCheckInContent, kindOfNotificationId, notificationIdPrefix, wirdReminderContent } = await import('@/notifications/content');
const { formatReminderTime, scheduleSummary } = await import('@/notifications/format');
const { MESSAGES } = await import('@/localization/messages');
const { isMushafReadingFocused, useQuietRemindersWhileReading } = await import('@/notifications/foreground');

describe('Notification copy (App Language)', () => {
  it('Wird Reminder: the approved English and Modern Standard Arabic wording', () => {
    expect(wirdReminderContent('en')).toMatchObject({ title: 'Time for your Quran reading', body: 'Continue your Reciting and reconnect with the Quran.' });
    expect(wirdReminderContent('ar')).toMatchObject({ title: 'حان وقت وِردك من القرآن', body: 'واصل وِردك اليوم وخصص وقتًا لقراءة القرآن.' });
  });

  it('Emotional Check-in: the approved wording', () => {
    expect(emotionCheckInContent('en')).toMatchObject({ title: 'You Deserve Peace ❤️', body: 'How are you feeling today? Let the Quran bring comfort to your heart.' });
    expect(emotionCheckInContent('ar')).toMatchObject({ title: 'تستحق الطمأنينة ❤️', body: 'كيف تشعر اليوم؟ دع القرآن يطمئن قلبك.' });
    // The heart is U+2764 with the emoji presentation selector (U+FE0F), at the end of the title only.
    expect([...emotionCheckInContent('en').title.slice(-2)].map((c) => c.codePointAt(0))).toEqual([0x2764, 0xfe0f]);
    expect([...emotionCheckInContent('ar').title.slice(-2)].map((c) => c.codePointAt(0))).toEqual([0x2764, 0xfe0f]);
  });

  it('payloads carry only the type and version — no ورد name or page, no account, emotion or reflection data', () => {
    expect(wirdReminderContent('en').data).toEqual({ v: 1, kind: 'wird' });
    expect(emotionCheckInContent('ar').data).toEqual({ v: 1, kind: 'emotionCheckIn' });
  });

  it('ar-EG uses the same Modern Standard Arabic copy as ar for every reminder string', () => {
    expect(MESSAGES['ar-EG'].notifications).toEqual(MESSAGES.ar.notifications);
  });

  it('the permission explanation (Settings → Allow notifications?): the approved wording; ar-EG as Arabic', () => {
    expect(MESSAGES.en.notifications.permissionSheetBody).toBe('Allow notifications to receive reminders for your Reciting, a Quran ayah, and a moment of peace for your heart.');
    expect(MESSAGES.ar.notifications.permissionSheetBody).toBe('اسمح بالإشعارات لتصلك تذكيرات بوِردك، وآية من القرآن، ولحظة طمأنينة لقلبك.');
    expect(MESSAGES['ar-EG'].notifications.permissionSheetBody).toBe(MESSAGES.ar.notifications.permissionSheetBody);
    // Its second paragraph: true of the implementation (local notifications only, scheduled with the OS on the device,
    // no push token or server; each reminder's content is built on the device, so delivery needs no connection).
    expect(MESSAGES.en.notifications.permissionSheetPrivacy).toBe('Reminders are scheduled on your device and work offline.');
    expect(MESSAGES.ar.notifications.permissionSheetPrivacy).toBe('تُجدول التذكيرات على جهازك، وتعمل دون اتصال بالإنترنت.');
    expect(MESSAGES['ar-EG'].notifications.permissionSheetPrivacy).toBe(MESSAGES.ar.notifications.permissionSheetPrivacy);
  });

  it('settings labels: the approved names and frequency words', () => {
    expect(MESSAGES.en.notifications).toMatchObject({ wirdReminderTitle: 'Reciting Reminder', randomAyahTitle: 'Random Quran Ayah', emotionCheckInTitle: 'You Deserve Peace', frequencyDaily: 'Daily', frequencyEvery3Days: 'Every 3 days', frequencyWeekly: 'Weekly', permissionRequired: 'Permission required' });
    expect(MESSAGES.ar.notifications).toMatchObject({ wirdReminderTitle: 'تذكير الوِرد', randomAyahTitle: 'آية من القرآن', emotionCheckInTitle: 'تستحق الطمأنينة', frequencyDaily: 'يوميًا', frequencyEvery3Days: 'كل ٣ أيام', frequencyWeekly: 'أسبوعيًا', permissionRequired: 'يلزم السماح بالإشعارات', chooseDay: 'اختيار اليوم', reminderTimeLabel: 'وقت التذكير' });
    expect(MESSAGES.en.settings).toMatchObject({ appSection: 'App', emotionsSection: 'Emotions', quranSection: 'Quran', supportSection: 'Support', showTranslationTitle: 'Show Translation', showTranslationDescription: 'The English translation under each ayah.' });
    expect(MESSAGES.ar.settings).toMatchObject({ appSection: 'التطبيق', emotionsSection: 'المشاعر', quranSection: 'القرآن', supportSection: 'الدعم', showTranslationTitle: 'إظهار الترجمة', showTranslationDescription: 'الترجمة الإنجليزية تحت كل آية.', legalSection: 'السياسات والشروط' });
    expect(MESSAGES['ar-EG'].settings.showTranslationDescription).toBe(MESSAGES.ar.settings.showTranslationDescription);
  });
});

describe('Identifiers and channels', () => {
  it('each type has its own identifier prefix and Android channel; foreign identifiers belong to none', () => {
    expect(['wird', 'randomAyah', 'emotionCheckIn'].map((k) => notificationIdPrefix(k as never))).toEqual(['quranheals.wird.', 'quranheals.ayah.', 'quranheals.checkin.']);
    expect(kindOfNotificationId('quranheals.checkin.d.2026-10-14')).toBe('emotionCheckIn');
    expect(kindOfNotificationId('quranheals.ayah.2026-10-14')).toBe('randomAyah');
    expect(kindOfNotificationId('expo-something')).toBeNull();
    expect(new Set(Object.values(ANDROID_CHANNEL_IDS)).size).toBe(3);
    expect(channelNames('ar')).toEqual({ wird: 'تذكير الوِرد', randomAyah: 'آية من القرآن', emotionCheckIn: 'تستحق الطمأنينة' });
  });
});

describe('Time display', () => {
  it('follows the device clock style; unknown → 12-hour in English, 24-hour in Arabic (Arabic-Indic digits)', () => {
    const en = MESSAGES.en;
    const ar = MESSAGES.ar;
    expect(formatReminderTime({ hour: 21, minute: 0 }, 'en', en, null)).toBe('9:00 PM');
    expect(formatReminderTime({ hour: 0, minute: 5 }, 'en', en, false)).toBe('12:05 AM');
    expect(formatReminderTime({ hour: 12, minute: 0 }, 'en', en, false)).toBe('12:00 PM');
    expect(formatReminderTime({ hour: 8, minute: 0 }, 'en', en, true)).toBe('08:00');
    expect(formatReminderTime({ hour: 21, minute: 0 }, 'ar', ar, null)).toBe('٢١:٠٠');
    expect(formatReminderTime({ hour: 21, minute: 0 }, 'ar', ar, false)).toBe('٩:٠٠ م');
    expect(formatReminderTime({ hour: 8, minute: 30 }, 'ar', ar, false)).toBe('٨:٣٠ ص');
  });

  it('the schedule summary: "Weekly · Sunday · 9:00 PM"', () => {
    expect(scheduleSummary({ frequency: 'weekly', weekday: 1, time: { hour: 21, minute: 0 } }, 'en', MESSAGES.en, false)).toBe('Weekly · Sunday · 9:00 PM');
    expect(scheduleSummary({ frequency: 'every3days', weekday: 1, time: { hour: 21, minute: 0 } }, 'ar', MESSAGES.ar, true)).toBe('كل ٣ أيام · ٢١:٠٠');
  });
});

describe('Quiet while reading the Mushaf', () => {
  it('only while the reader is the focused screen', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    function Reader() {
      useQuietRemindersWhileReading();
      return null;
    }
    expect(isMushafReadingFocused()).toBe(false);
    let root!: ReturnType<typeof create>;
    await act(async () => { root = create(createElement(Reader)); });
    expect(isMushafReadingFocused()).toBe(true);
    focus.focused = false;
    await act(async () => root.update(createElement(Reader)));
    expect(isMushafReadingFocused()).toBe(false);
    focus.focused = true;
    await act(async () => root.update(createElement(Reader)));
    await act(async () => root.unmount());
    expect(isMushafReadingFocused()).toBe(false);
  });
});
