import { describe, expect, it } from 'vitest';

import { MESSAGES } from '@/localization/messages';
import { wirdReminderContent } from '@/notifications/content';

/**
 * English wording for a ورد and for listening is "Reciting" everywhere: never "Recitation(s)", the plural
 * "Recitings", or a misspelling. "Reciter(s)" (a Quran reader) is a different word and stays. Arabic is untouched.
 */
type Tree = { [key: string]: string | Tree };
const strings = (tree: Tree, path = ''): [string, string][] =>
  Object.entries(tree).flatMap(([key, value]) => (typeof value === 'string' ? [[`${path}${key}`, value] as [string, string]] : strings(value, `${path}${key}.`)));

const en = strings(MESSAGES.en as unknown as Tree);
const BANNED = /recitations?\b|recitings\b|recitating|recatit|recitatng|recitng|recitaion|recitaton/i;

describe('Reciting terminology (English)', () => {
  it('no English string says recitation, recitations, recitings or a misspelling', () => {
    expect(en.length).toBeGreaterThan(500);
    expect(en.filter(([, value]) => BANNED.test(value))).toEqual([]);
  });

  it('Reciter and Reciters (a Quran reader) are kept', () => {
    expect(MESSAGES.en.audio.reciter).toBe('Reciter');
    expect(MESSAGES.en.audio.favoriteTitle).toBe('Favorite Reciter');
    expect(MESSAGES.en.audio.chooseReciter).toBe('Choose a reciter');
  });

  it('the owner-approved Reciting labels, exactly (never "Wird" in English)', () => {
    expect(MESSAGES.en.tabs.myReading).toBe('My Reciting');
    expect(MESSAGES.en.myReading.title).toBe('My Reciting and Khatmas');
    expect(MESSAGES.en.continueReading.myReading).toBe('My Reciting and Khatmas');
    expect(MESSAGES.en.myReading.wirdsTitle).toBe('My Reciting');
    expect(MESSAGES.en.continueReading.title).toBe('Continue Reciting');
    expect(MESSAGES.en.myReading.continue).toBe('Continue Reciting');
    expect(MESSAGES.en.myReading.newWird).toBe('New Reciting');
    expect(MESSAGES.en.myReading.createTitle).toBe('New Reciting');
    expect(MESSAGES.en.mushaf.wirdChoose).toBe('Choose a Reciting');
    expect(MESSAGES.en.continueReading.chooseWird).toBe('Choose a Reciting');
    expect(MESSAGES.en.mushaf.wirdSelectorLabel).toBe('Active Reciting');
    expect(MESSAGES.en.mushaf.wirdNew).toBe('New Reciting on This Page');
    expect(MESSAGES.en.continueReading.firstTitle).toBe('Start Reciting');
    expect(MESSAGES.en.notifications.wirdReminderTitle).toBe('Reciting Reminder');
    expect(en.filter(([, value]) => /\bwirds?\b/i.test(value))).toEqual([]);
  });

  it('audio and playback wording for the player, downloads and credits', () => {
    expect(MESSAGES.en.audio.playPage).toBe('Play Audio from This Page');
    expect(MESSAGES.en.audio.followRecitation).toBe('Follow Along');
    expect(MESSAGES.en.audio.ended).toBe('Playback Complete');
    expect(MESSAGES.en.audio.errorNetwork).toBe("The audio couldn't load. Check your connection.");
    expect(MESSAGES.en.audio.deleteTitle).toBe('Delete Downloaded Audio?');
    expect(MESSAGES.en.audio.sourceNote).toBe('Audio Source: MP3Quran (mp3quran.net)');
    expect(MESSAGES.en.audio.stopHint).toBe('Touch and hold to stop playback.');
  });

  it('every placeholder is kept: English offers each one its translations use, and the reworded templates keep theirs', () => {
    const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const english = new Map(en);
    for (const locale of ['ar', 'ar-EG'] as const) {
      for (const [key, value] of strings(MESSAGES[locale] as unknown as Tree)) {
        const source = english.get(key);
        if (source !== undefined) for (const name of names(value)) expect(names(source), `${locale} ${key}`).toContain(name);
      }
    }
    expect(MESSAGES.en.audio.deleteBody).toBe("Removes {reciter}'s downloaded audio ({size}) from this device. You can download it again later.");
    expect(MESSAGES.en.notifications.wirdNotificationBodyPage).toBe('Continue your {name} reciting from page {page}.');
  });

  it('Morning and Evening reminders render with the saved name and page; Arabic keeps its approved wording', () => {
    const target = (name: string, page: number) => ({ stopId: 'stop-1', name, page });
    expect(wirdReminderContent('en', target('Morning', 1))).toMatchObject({ title: 'Time for your Quran reciting.', body: 'Continue your Morning reciting from page 1.' });
    expect(wirdReminderContent('en', target('Evening', 125))).toMatchObject({ title: 'Time for your Quran reciting.', body: 'Continue your Evening reciting from page 125.' });
    expect(wirdReminderContent('en')).toMatchObject({ title: 'Time for your Quran reciting.', body: 'Continue your Reciting and reconnect with the Quran.' });
    expect(wirdReminderContent('ar', target('المسائي', 125))).toMatchObject({ title: 'وقت وردك القرآني', body: 'أكمل وردك المسائي من الصفحة ١٢٥.' });
  });
});
