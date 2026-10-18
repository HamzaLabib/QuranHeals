import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AYAH_NOTIFICATION_MAX_LENGTH, EXCERPT_MARKER, ayahNotificationExcerpt } from '@/notifications/ayahExcerpt';
import { parseNotificationPayload, randomAyahContent } from '@/notifications/content';
import { createQuranRepository } from '@/services/quranRepository';

import { openTestDatabase } from './helpers/sqlite';

/**
 * The Random Quran Ayah's text, checked against the verified bundled
 * quran.sqlite itself (read-only): every one of the 6,236 verses goes through
 * the notification excerpt, and the database file is unchanged afterwards.
 */
const DB_PATH = resolve(__dirname, '../assets/quran/quran.sqlite');
const hashBefore = createHash('sha256').update(readFileSync(DB_PATH)).digest('hex');
const repository = createQuranRepository(async () => openTestDatabase());
const COMBINING = /\p{M}/u;

describe('Random Quran Ayah text: every verse of the verified Quran', () => {
  it('the source is the complete verified Quran (6,236 verses, 114 surahs)', async () => {
    const verses = await repository.getAllVerses();
    expect(verses).toHaveLength(6236);
    expect(new Set(verses.map((v) => v.surah)).size).toBe(114);
  });

  it('short verses are shown exactly as stored; long ones as an exact whole-word prefix plus " …", never splitting a letter from its marks', async () => {
    const verses = await repository.getAllVerses();
    let truncated = 0;
    for (const verse of verses) {
      const { text, truncated: cut } = ayahNotificationExcerpt(verse.arabicText);
      if (!cut) {
        expect(text).toBe(verse.arabicText);
        continue;
      }
      truncated += 1;
      expect(text.endsWith(` ${EXCERPT_MARKER}`)).toBe(true);
      const prefix = text.slice(0, -(EXCERPT_MARKER.length + 1));
      expect(prefix.length).toBeGreaterThan(0);
      expect(prefix.length).toBeLessThanOrEqual(AYAH_NOTIFICATION_MAX_LENGTH);
      // Exact prefix of the stored text, cut at a space: nothing changed, removed, or normalized.
      expect(verse.arabicText.startsWith(prefix)).toBe(true);
      expect(verse.arabicText[prefix.length]).toBe(' ');
      // The prefix ends on a non-space character (a whole word, with any trailing marks it carries in the source).
      expect(/\s/.test(prefix.at(-1)!)).toBe(false);
      // Every combining mark in the excerpt still follows the same character it follows in the source.
      for (let i = 0; i < prefix.length; i += 1) if (COMBINING.test(prefix[i])) expect(prefix[i - 1]).toBe(verse.arabicText[i - 1]);
    }
    // Long verses exist (2:282, the longest, among them) and short ones are untouched.
    expect(truncated).toBeGreaterThan(100);
    expect(truncated).toBeLessThan(6236);
  });

  it('the longest verse (2:282) becomes a whole-word excerpt; tapping still opens 2:282 in full', async () => {
    const verse = await repository.getVerseByKey('2:282');
    const content = randomAyahContent('en', verse);
    const [excerpt, reference] = content.body.split('\n\n');
    expect(excerpt.endsWith(EXCERPT_MARKER)).toBe(true);
    expect(verse.arabicText.startsWith(excerpt.slice(0, -2))).toBe(true);
    expect(reference).toBe('Al-Baqara · 2:282');
    expect(parseNotificationPayload(content.data)).toEqual({ kind: 'randomAyah', verseKey: '2:282', surah: 2, ayah: 282 });
  });

  it('a short verse is the body verbatim, then a blank line and its localized reference (no subtitle), in either App Language', async () => {
    const verse = await repository.getVerseByKey('94:5');
    const en = randomAyahContent('en', verse);
    const ar = randomAyahContent('ar', verse);
    expect(en).toMatchObject({ title: 'A Verse for You Today', body: `${verse.arabicText}\n\nAsh-Sharh · 94:5` });
    expect(ar).toMatchObject({ title: 'آية من القرآن لك اليوم', body: `${verse.arabicText}\n\nسورة الشرح · الآية ٥` });
    expect(en.subtitle).toBeUndefined();
    expect(ar.subtitle).toBeUndefined();
    expect(parseNotificationPayload(ar.data)).toEqual({ kind: 'randomAyah', verseKey: '94:5', surah: 94, ayah: 5 });
  });

  it('every verse: the body starts with its verified text (or exact excerpt) and ends with its own reference, never another verse\'s', async () => {
    const verses = await repository.getAllVerses();
    const digits = (n: number) => String(n).replace(/\d/g, (x) => '٠١٢٣٤٥٦٧٨٩'[Number(x)]);
    for (const verse of verses) {
      for (const locale of ['en', 'ar'] as const) {
        const { body, data } = randomAyahContent(locale, verse);
        const [text, reference, ...rest] = body.split('\n\n');
        expect(rest).toEqual([]);
        expect(text).toBe(ayahNotificationExcerpt(verse.arabicText).text);
        if (locale === 'en') expect(reference.endsWith(` · ${verse.surah}:${verse.ayah}`)).toBe(true);
        else expect(reference.startsWith('سورة ') && reference.endsWith(` · الآية ${digits(verse.ayah)}`)).toBe(true);
        expect(data).toMatchObject({ verseKey: verse.verseKey, surah: verse.surah, ayah: verse.ayah });
      }
    }
  });

  it('selection is from the whole verified Quran (not emotion-mapped ayahs), and excluded recent verses are skipped', async () => {
    const all = (await repository.getAllVerses()).map((v) => v.verseKey);
    const excluded = all.slice(0, 150);
    for (let i = 0; i < 50; i += 1) expect(excluded).not.toContain(await repository.getRandomVerseKey(excluded));
    const picked = new Set<string>();
    for (let i = 0; i < 200; i += 1) picked.add(await repository.getRandomVerseKey());
    for (const k of picked) expect(all).toContain(k);
    // 200 uniform picks from 6,236 are almost surely spread across many surahs.
    expect(new Set([...picked].map((k) => k.split(':')[0])).size).toBeGreaterThan(30);
  });

  it('the verified database file is unchanged by all of the above', () => {
    expect(createHash('sha256').update(readFileSync(DB_PATH)).digest('hex')).toBe(hashBefore);
  });
});
