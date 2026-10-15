import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ayahCopyText } from '@/mushaf/ayahCopyText';

/**
 * The Mushaf's Copy text (mushaf/ayahCopyText.ts) over every ayah of the bundled, verified Quran database: the ayah's
 * own Arabic, whole, with every mark, and nothing else.
 */
const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
const verses = db.prepare('SELECT verse_key AS k, surah AS s, ayah AS a, arabic_text AS t FROM verses ORDER BY surah, ayah').all() as { k: string; s: number; a: number; t: string }[];
const basmala = verses[0].t;
/** QCF / presentation-form code points (the page fonts' glyphs), Latin letters and digits: never in copied text. */
const FOREIGN = /[-ﭐ-﷿ﹰ-﻿]|[A-Za-z0-9]/;

describe('Copy: the ayah`s verified Arabic only', () => {
  it('all 6,236 ayahs: the stored text exactly, except the Basmala Tanzil prefixes to 112 first ayahs', () => {
    expect(verses).toHaveLength(6236);
    const stripped: string[] = [];
    for (const v of verses) {
      const copied = ayahCopyText(v.k, v.t, basmala);
      expect(copied.length, v.k).toBeGreaterThan(0);
      expect(copied, v.k).not.toMatch(FOREIGN);
      if (copied === v.t) continue;
      stripped.push(v.k);
      // Only the leading Basmala went: the rest, character for character.
      expect(v.t.endsWith(copied), v.k).toBe(true);
      const prefix = v.t.slice(0, v.t.length - copied.length).trim();
      expect([basmala, basmala.slice(0, 1) + 'ّ' + basmala.slice(1)], v.k).toContain(prefix);
    }
    expect(stripped).toHaveLength(112);
    expect(stripped.every((k) => k.endsWith(':1') && k !== '1:1' && k !== '9:1')).toBe(true);
  });

  it('Al-Fatihah 1:1 is the Basmala itself, At-Tawbah 9:1 has none: both copied as they are', () => {
    const text = (key: string) => verses.find((v) => v.k === key)!.t;
    expect(ayahCopyText('1:1', text('1:1'), basmala)).toBe(text('1:1'));
    expect(ayahCopyText('9:1', text('9:1'), basmala)).toBe(text('9:1'));
  });

  it('examples: 2:1 is الٓمٓ alone; 95:1 and 97:1 (Tanzil`s بِّسْمِ with shadda) lose their Basmala too; marks are kept', () => {
    const text = (key: string) => verses.find((v) => v.k === key)!.t;
    expect(ayahCopyText('2:1', text('2:1'), basmala)).toBe('الٓمٓ');
    expect(ayahCopyText('112:1', text('112:1'), basmala)).toBe(text('112:1').slice(basmala.length + 1));
    expect(ayahCopyText('112:1', text('112:1'), basmala).startsWith('قُلْ')).toBe(true);
    for (const key of ['95:1', '97:1']) expect(ayahCopyText(key, text(key), basmala)).not.toMatch(/^بِ?ّ?ِ?سْمِ/);
    expect(ayahCopyText('2:255', text('2:255'), basmala)).toBe(text('2:255'));
    expect(text('2:255')).toMatch(/[ً-ْٰ]/);
  });
});
