import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AYAH_NOTIFICATION_MAX_LENGTH, EXCERPT_MARKER, ayahNotificationExcerpt } from '@/notifications/ayahExcerpt';
import { parseNotificationPayload, randomAyahContent } from '@/notifications/content';
import { createQuranRepository } from '@/services/quranRepository';
import { formatAyahReference } from '@/utils/ayahReference';

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
    expect(content.body.endsWith(EXCERPT_MARKER)).toBe(true);
    expect(verse.arabicText.startsWith(content.body.slice(0, -2))).toBe(true);
    expect(parseNotificationPayload(content.data)).toEqual({ kind: 'randomAyah', verseKey: '2:282', surah: 2, ayah: 282 });
  });

  it('a short verse (1:1) is the body verbatim, with the shared reference as subtitle, in either App Language', async () => {
    const verse = await repository.getVerseByKey('1:1');
    for (const locale of ['en', 'ar'] as const) {
      const content = randomAyahContent(locale, verse);
      expect(content.body).toBe(verse.arabicText);
      expect(content.subtitle).toBe(formatAyahReference(1, 1));
    }
    expect(randomAyahContent('en', verse).title).toBe('A Message from the Quran');
    expect(randomAyahContent('ar', verse).title).toBe('رسالة من القرآن');
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
