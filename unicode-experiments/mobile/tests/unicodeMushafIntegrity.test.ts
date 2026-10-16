import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AYAH_MARKER_INK } from '@/mushaf/generated/ayahMarkerInk';
import { PAGE_FIRST_AYAH } from '@/mushaf/generated/pageStarts';
import { checkUnicodePage } from '@/mushaf/unicode/integrity';
import { displayChars, displayRuns, fromDisplay, toDisplay } from '@/mushaf/unicode/encoding';
import { decodePage, groupMetrics, layoutPage, LINE_MEASURE_EM, pageVerseIndexes, verseIndexOf, verseKeyOf } from '@/mushaf/unicode/layout';
import { colourRuns, TAJWEED_PALETTES, tajweedSpans } from '@/mushaf/unicode/tajweed';
import { PAUSE_MARK, TATWEEL, withoutKashida, wordGroups } from '@/mushaf/unicode/words';
import { UNICODE_MUSHAF_DATA as data, TAJWEED_RULES, UNICODE_MUSHAF_FONTS } from '@/mushaf/unicode/data';

/**
 * Unicode Mushaf prototype — Quran text integrity (separate from rendering, which unicodeMushafPage.test.ts and the
 * screenshots check). The reference is the verified Tanzil SQLite (114 Surahs, 6,236 ayahs); the prototype never
 * stores Quran text of its own, only where each verified word stands.
 */
const db = new DatabaseSync(fileURLToPath(new URL('../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
const verses = db.prepare('SELECT surah, ayah, verse_key AS k, arabic_text AS t FROM verses ORDER BY surah, ayah').all() as { surah: number; ayah: number; k: string; t: string }[];
db.close();
const text = (i: number) => verses[i].t;

describe('the generated layout covers the verified text exactly once, in order', () => {
  it('114 Surahs, 6,236 ayahs; verse indexes and keys agree with the database', () => {
    expect(data.surahAyahCounts).toHaveLength(114);
    expect(data.surahAyahCounts.reduce((a, b) => a + b, 0)).toBe(6236);
    verses.forEach((v, i) => {
      expect(verseKeyOf(data, i)).toBe(v.k);
      expect(verseIndexOf(data, v.k)).toBe(i);
    });
    expect(verseIndexOf(data, '115:1')).toBe(-1);
    expect(verseIndexOf(data, '1:8')).toBe(-1);
    expect(verseIndexOf(data, '<script>')).toBe(-1);
  });

  it('604 pages; 15 lines each (pages 1–2: their own 8); every Tanzil token placed once, in reading order; one number per ayah', () => {
    expect(data.pages).toHaveLength(604);
    const placed = verses.map((v) => new Array(v.t.split(' ').length).fill(0) as number[]);
    const numbers = new Array(verses.length).fill(0);
    let last = -1;
    let headings = 0;
    let basmalas = 0;
    for (let page = 1; page <= 604; page++) {
      const lines = decodePage(data, page);
      expect(lines.length, `page ${page}`).toBe(page <= 2 ? 8 : 15);
      for (const line of lines) {
        if (line.kind === 'heading') { headings++; continue; }
        if (line.kind === 'basmala') { basmalas++; continue; }
        for (const s of line.segments) {
          expect(s.verseIndex).toBeGreaterThanOrEqual(last);
          last = s.verseIndex;
          for (let t = s.firstToken; t <= s.lastToken; t++) placed[s.verseIndex][t]++;
          if (s.marker) numbers[s.verseIndex]++;
        }
      }
    }
    expect(headings).toBe(114);
    expect(basmalas).toBe(112);
    verses.forEach((v, i) => {
      const basmalaTokens = v.ayah === 1 && v.surah !== 1 && v.surah !== 9 ? 4 : 0;
      placed[i].forEach((count, t) => expect(count, `${v.k} token ${t + 1}`).toBe(t < basmalaTokens ? 0 : 1));
      expect(numbers[i], v.k).toBe(1);
    });
  });

  it('page boundaries are the reader`s: every page starts with the ayah its navigation says (generated/pageStarts.ts)', () => {
    for (let page = 1; page <= 604; page++) {
      const first = pageVerseIndexes(decodePage(data, page))[0];
      const [surah, ayah] = PAGE_FIRST_AYAH[page - 1];
      expect(verseKeyOf(data, first), `page ${page}`).toBe(`${surah}:${ayah}`);
    }
  });

  it('every ayah number is on the page its QPC V1 medallion is on, so a ورد`s ayah (wirdAyah.ts) and its gold medallion carry over', () => {
    for (let page = 1; page <= 604; page++) {
      for (const line of decodePage(data, page)) {
        if (line.kind !== 'text') continue;
        for (const s of line.segments) if (s.marker) expect(AYAH_MARKER_INK[verseKeyOf(data, s.verseIndex)]?.[0], verseKeyOf(data, s.verseIndex)).toBe(page);
      }
    }
  });

  it('the width table has one entry per word group of every verse (the same grouping as the layout)', () => {
    verses.forEach((v, i) => expect(data.groupWidths[i].split(',').length, v.k).toBe(wordGroups(v.t).length));
  });
});

describe('every page draws exactly the verified text (text validation, all 604 pages)', () => {
  it('the drawn words, kashida taken out, are the verified words; nothing missing, repeated or reordered; numbers correct', () => {
    const failures: string[] = [];
    const drawnText = verses.map(() => [] as string[]);
    let kashidas = 0;
    for (let page = 1; page <= 604; page++) {
      const laid = layoutPage(data, page, 340, text);
      const check = checkUnicodePage(data, page, text, laid);
      if (!check.ok) failures.push(`page ${page}: ${check.problems.join('; ')}`);
      for (const row of laid.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          if (item.kashida) {
            kashidas += item.kashida.count;
            // Only tatweels were added, at a point after a letter's marks.
            expect(item.text.length - item.kashida.count).toBe(item.end - item.start);
          }
          drawnText[item.verseIndex].push(item.kashida ? withoutKashida(item.text, item.kashida.index, item.kashida.count) : item.text);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(kashidas).toBeGreaterThan(0);
    // Reassembled from all pages, each ayah is its verified text (without the Basmala Tanzil prefixes to 112 first ayahs).
    verses.forEach((v, i) => {
      const words = v.t.split(' ');
      const own = v.ayah === 1 && v.surah !== 1 && v.surah !== 9 ? words.slice(4).join(' ') : v.t;
      expect(drawnText[i].join(' '), v.k).toBe(own);
    });
  });

  it('refuses a page whose text is not the verified text (a changed diacritic, a missing word)', () => {
    const page = 3;
    const target = pageVerseIndexes(decodePage(data, page))[1];
    const changed = (i: number) => (i === target ? text(i).replace('َ', 'ُ') : text(i));
    expect(checkUnicodePage(data, page, changed).ok).toBe(false);
    const dropped = (i: number) => (i === target ? text(i).split(' ').slice(1).join(' ') : text(i));
    expect(checkUnicodePage(data, page, dropped).ok).toBe(false);
    expect(checkUnicodePage(data, page, text).ok).toBe(true);
  });

  it('pause and sajdah signs are drawn with the word before them, never alone', () => {
    for (const v of verses) for (const g of wordGroups(v.t)) expect(PAUSE_MARK.test(g.text.split(' ')[0]), v.k).toBe(false);
  });
});

describe('Tajweed colours change colour only', () => {
  it('on every page, colouring a word gives back exactly its drawn characters (layout identical ON and OFF)', () => {
    let coloured = 0;
    for (let page = 1; page <= 604; page++) {
      const laid = layoutPage(data, page, 340, text);
      for (const row of laid.rows) {
        if (row.kind !== 'text') continue;
        for (const item of row.items) {
          if (item.kind !== 'word') continue;
          const runs = colourRuns(item, tajweedSpans(TAJWEED_RULES, item.verseIndex), TAJWEED_PALETTES.light);
          expect(runs.map((r) => r.text).join('')).toBe(item.text);
          coloured += runs.filter((r) => r.colour).length;
          // Never a run starting with a combining mark: a colour never splits a letter from its diacritics.
          for (const run of runs) expect(/^\p{Mn}/u.test(run.text), `${item.verseKey} «${item.text}»`).toBe(false);
        }
      }
    }
    expect(coloured).toBeGreaterThan(50000);
  });

  it('every annotation lies inside its verse and covers whole letters', () => {
    verses.forEach((v, i) => {
      for (const span of tajweedSpans(TAJWEED_RULES, i)) {
        expect(span.end, v.k).toBeLessThanOrEqual(v.t.length);
        expect(/\p{Mn}/u.test(v.t[span.start]), `${v.k} ${span.rule}`).toBe(false);
        expect(span.end === v.t.length || !/\p{Mn}/u.test(v.t[span.end]), `${v.k} ${span.rule}`).toBe(true);
      }
    });
  });
});

describe('the display encoding and the fonts (text representation)', () => {
  it('KFGQPC`s sukun encoding is one-to-one on the verified text: every ayah comes back exactly; Tanzil never uses U+06E1', () => {
    for (const v of verses) {
      expect(v.t.includes('ۡ'), v.k).toBe(false);
      const drawn = toDisplay(v.t, 'kfgqpc');
      expect(drawn.length).toBe(v.t.length);
      expect(drawn.includes('۟'), v.k).toBe(false);
      expect(fromDisplay(drawn, 'kfgqpc'), v.k).toBe(v.t);
    }
    // Exactly the two signs swap; nothing else is touched.
    expect(toDisplay('ْٰ۟ۢ', 'kfgqpc')).toBe('ْٰۡۢ');
    expect(toDisplay('ْ۟', null)).toBe('ْ۟');
  });

  it('KFGQPC Hafs draws every word but two, which go to Amiri Quran (12:11, 52:37); Amiri Quran draws them all', () => {
    const fallbacks = (font: keyof typeof UNICODE_MUSHAF_FONTS) => verses.flatMap((v, i) => groupMetrics(UNICODE_MUSHAF_FONTS[font], i).flatMap((m, g) => (m.fallback ? [{ key: v.k, word: wordGroups(v.t)[g].text }] : [])));
    const hafs = fallbacks('hafs');
    expect(hafs.map((f) => f.key)).toEqual(['12:11', '52:37']);
    // The two words with the signs KFGQPC's fonts cannot draw in Tanzil's encoding: U+06EB and U+06E3.
    expect(hafs[0].word.includes('۫')).toBe(true);
    expect(hafs[1].word.includes('ۣ')).toBe(true);
    expect(fallbacks('amiri')).toEqual([]);
    expect(UNICODE_MUSHAF_FONTS.hafs.displayEncoding).toBe('kfgqpc');
    expect(UNICODE_MUSHAF_FONTS.amiri.displayEncoding).toBeNull();
  });

  it('QH Old Madina: only the space before a standalone pause sign is left undrawn (dk), so the sign sits over its word', () => {
    let removed = 0;
    for (const v of verses) {
      const out = displayChars(v.t, 'dk');
      out.forEach((ch, i) => {
        if (ch !== '') {
          expect(ch).toBe(v.t[i]);
          return;
        }
        removed++;
        expect(v.t[i], v.k).toBe(' ');
        expect(/^[ۖ-ۜ]+$/.test(v.t.slice(i + 1).split(' ')[0]), v.k).toBe(true);
      });
    }
    expect(removed).toBeGreaterThan(4000);
    // Runs keep their letters: concatenated, they are the whole drawn word.
    const runs = displayRuns([{ text: 'رَيْبَ ', colour: null }, { text: 'ۛ', colour: 'x' }], 'dk');
    expect(runs.map((r) => r.text).join('')).toBe('رَيْبَۛ');
    expect(() => fromDisplay('x', 'dk')).toThrow();
  });

  it('QH Old Madina draws every word but two, in Amiri Quran (11:41 U+06EA, 12:11 U+06EB)', () => {
    const fallbacks = verses.flatMap((v, i) => groupMetrics(UNICODE_MUSHAF_FONTS.madina, i).flatMap((m) => (m.fallback ? [v.k] : [])));
    expect(fallbacks).toEqual(['11:41', '12:11']);
    expect(UNICODE_MUSHAF_FONTS.madinaCalligraphic.groupWidths).toBe(UNICODE_MUSHAF_FONTS.madina.groupWidths);
    expect(UNICODE_MUSHAF_FONTS.madinaNatural.groupWidths).toBe(UNICODE_MUSHAF_FONTS.madina.groupWidths);
  });

  it('every rendering lays out all 604 pages with exactly the verified text', () => {
    for (const font of ['hafs', 'hafsPlus', 'madina', 'madinaCalligraphic', 'madinaNatural', 'amiri'] as const) {
      const failures: string[] = [];
      for (let page = 1; page <= 604; page++) {
        const check = checkUnicodePage(UNICODE_MUSHAF_FONTS[font], page, text, layoutPage(UNICODE_MUSHAF_FONTS[font], page, 340, text));
        if (!check.ok) failures.push(`${font} page ${page}: ${check.problems.join('; ')}`);
      }
      expect(failures).toEqual([]);
    }
  });
});

describe.each(['hafs', 'hafsPlus', 'madina', 'madinaCalligraphic', 'amiri'] as const)('layout quality (all 604 pages, a 340-px text area): %s', (font) => {
  it('justified lines fill the measure; a few long lines are drawn slightly smaller, never squeezed; gaps stay moderate', () => {
    const fontData = UNICODE_MUSHAF_FONTS[font];
    let shrunk = 0;
    let smallest = 1;
    let widestGap = 0;
    let centred = 0;
    let elongations = 0;
    let maxLevel = 0;
    let narrowed = 0;
    let kashidas = 0;
    for (let page = 1; page <= 604; page++) {
      const laid = layoutPage(fontData, page, 340, text);
      elongations += laid.stats.elongations;
      maxLevel = Math.max(maxLevel, laid.stats.maxLevel);
      narrowed += laid.stats.narrowed;
      kashidas += laid.stats.kashidas;
      shrunk += laid.stats.shrunk;
      smallest = Math.min(smallest, laid.stats.smallestScale);
      widestGap = Math.max(widestGap, laid.stats.widestGapEm);
      centred += laid.stats.centred;
      for (const row of laid.rows) {
        if (row.kind !== 'text' || row.centred || row.items.length < 2) continue;
        const left = Math.min(...row.items.map((i) => i.x));
        const right = Math.max(...row.items.map((i) => i.x + i.width));
        expect(left, `page ${page} line ${row.line}`).toBeCloseTo(0, 6);
        expect(right, `page ${page} line ${row.line}`).toBeCloseTo(340, 6);
      }
    }
    expect(LINE_MEASURE_EM).toBe(21);
    expect(shrunk).toBeLessThan(font === 'hafsPlus' ? 160 : 80);
    expect(smallest).toBeGreaterThan(0.9);
    // Sparse lines elongate further (looser kashida, or more calligraphic levels) rather than open wide gaps.
    // B justifies with spaces alone; C's widest gaps are a few 4–5-word lines whose words are all at their longest forms.
    expect(widestGap).toBeLessThan({ hafs: 1.4, hafsPlus: 1.4, madina: 3, madinaCalligraphic: 2, amiri: 1.8 }[font]);
    // Reported in docs/unicode-mushaf/visual-candidates.md.
    console.info(`[unicode layout ${font}] centred ${centred}, shrunk ${shrunk} (smallest ×${smallest.toFixed(3)}), widest gap ${widestGap.toFixed(2)} em, kashidas ${kashidas}, elongated words ${elongations} (max level ${maxLevel}), narrowed ${narrowed}`);
  });

  it('inserted kashida are tatweels only', () => {
    const laid = layoutPage(data, 595, 340, text);
    for (const row of laid.rows) if (row.kind === 'text') for (const item of row.items) if (item.kind === 'word' && item.kashida) expect(item.text.slice(item.kashida.index, item.kashida.index + item.kashida.count)).toBe(TATWEEL.repeat(item.kashida.count));
  });
});

describe('candidate C2 (natural fitting, all 604 pages, a 340-px text area)', () => {
  const fontData = UNICODE_MUSHAF_FONTS.madinaNatural;
  const reach = 340 * 0.01; // widthShare 1.02: 1% of the reader's text area into the paper margin on each side

  it('elongations stay mild, lines are at most 2 em short and centred, words never overlap', () => {
    let shrunk = 0;
    let smallest = 1;
    let widestGap = 0;
    let underfilled = 0;
    let elongated = 0;
    let words = 0;
    let longest = 0;
    for (let page = 1; page <= 604; page++) {
      const laid = layoutPage(fontData, page, 340, text);
      expect(laid.fontSize).toBeCloseTo((340 * 1.02) / 17.25, 9);
      shrunk += laid.stats.shrunk;
      smallest = Math.min(smallest, laid.stats.smallestScale);
      widestGap = Math.max(widestGap, laid.stats.widestGapEm);
      underfilled += laid.stats.underfilled;
      longest = Math.max(longest, laid.stats.longestStretchEm);
      expect(laid.stats.largestUnderfillEm, `page ${page}`).toBeLessThanOrEqual(2 + 1e-9);
      for (const row of laid.rows) {
        if (row.kind !== 'text') continue;
        const ordered = [...row.items].sort((a, b) => b.x - a.x);
        for (let i = 1; i < ordered.length; i++) expect(ordered[i].x + ordered[i].width, `page ${page} line ${row.line}`).toBeLessThanOrEqual(ordered[i - 1].x + 1e-6);
        row.items.forEach((item, i) => {
          if (item.kind !== 'word') return;
          words++;
          if (item.elongation === 0) return;
          elongated++;
          const m = groupMetrics(fontData, item.verseIndex)[item.group];
          expect(item.elongation).toBeLessThanOrEqual(3);
          expect(m.stretch[item.elongation]).toBeLessThanOrEqual(Math.min(0.42, 0.35 * m.width) + 1e-9);
          expect(m.width).toBeGreaterThanOrEqual(1);
          const neighbour = [row.items[i - 1], row.items[i + 1]].some((n) => n?.kind === 'word' && n.elongation > 0);
          expect(neighbour, `page ${page} line ${row.line}`).toBe(false);
        });
        if (row.centred || row.items.length < 2) continue;
        const left = Math.min(...row.items.map((i) => i.x));
        const right = Math.max(...row.items.map((i) => i.x + i.width));
        const short = row.underfill;
        expect(left, `page ${page} line ${row.line}`).toBeCloseTo(-reach + short / 2, 6);
        expect(right, `page ${page} line ${row.line}`).toBeCloseTo(340 + reach - short / 2, 6);
      }
    }
    expect(shrunk).toBeLessThan(260);
    expect(smallest).toBeGreaterThan(0.86);
    expect(widestGap).toBeLessThan(2);
    // Reported in docs/unicode-mushaf/visual-candidates.md.
    console.info(`[unicode layout madinaNatural] shrunk ${shrunk} (smallest ×${smallest.toFixed(3)}), widest gap ${widestGap.toFixed(2)} em, short lines ${underfilled}, elongated words ${elongated} of ${words}, longest ${longest.toFixed(2)} em`);
  });
});
