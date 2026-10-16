// Shared by the Unicode Mushaf prototype's tools: reads quran-madina-html's
// Madina05 layout (pinned in madina05.lock.json) and the app's verified Tanzil
// text, and places every Tanzil token on its Madina05 page and line.
//
// Only the placement is taken from Madina05. Its text is compared with the
// verified Tanzil text token by token (ignoring tatweel, which the library
// inserts for kashida justification) and never used for rendering.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
export const lock = JSON.parse(readFileSync(new URL('./madina05.lock.json', import.meta.url), 'utf8'));

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * One pinned Madina05 file, from `cacheDir` (outside the repository) or downloaded from the pinned commit into it.
 * Refuses any file whose SHA-256 differs from the lock.
 */
export async function loadMadina05(cacheDir, file = 'assets/db/Madina05-Hafs-16px.json') {
  const expected = lock.files[file];
  if (!expected) throw new Error(`${file} is not pinned in madina05.lock.json`);
  const dir = resolve(cacheDir);
  if (!relative(repoRoot, dir).startsWith('..')) throw new Error(`Refusing to cache Madina05 inside the repository (${dir}).`);
  const path = join(dir, lock.commit, file);
  let bytes = existsSync(path) ? readFileSync(path) : null;
  if (!bytes || sha256(bytes) !== expected) {
    const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/${file}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== expected) throw new Error(`${file} does not match its pinned SHA-256`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  return JSON.parse(bytes.toString('utf8'));
}

/** The verified Tanzil text (mobile/assets/quran/quran.sqlite), in reading order. */
export function loadTanzil() {
  const db = new DatabaseSync(join(repoRoot, 'mobile/assets/quran/quran.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT surah, ayah, verse_key AS verseKey, arabic_text AS text FROM verses ORDER BY surah, ayah').all();
  db.close();
  return rows;
}

/** Standalone pause, rub' al-hizb and sajdah signs: separate tokens in Tanzil, not words (as in the reader's checks). */
export const PAUSE_MARK = /^[ۖ-ۜ۞۩]+$/;
const TATWEEL = /ـ/g;
/** Madina05's ayah-number token for Hafs (ornate parentheses around Arabic-Indic digits) or Amiri (U+06DD). */
const MARKER = /^(?:﴿[٠-٩]+﴾|۝[٠-٩]+)$/;
export const tokensOf = (text) => text.split(' ');
export const withoutTatweel = (token) => token.replace(TATWEEL, '');

/** How many leading Tanzil tokens of an ayah are the Basmala the print sets on its own line (ayah 1 of 112 Surahs). */
export function basmalaTokenCount(surah, ayah) {
  return ayah === 1 && surah !== 1 && surah !== 9 ? 4 : 0;
}

/**
 * Every Tanzil token on its Madina05 page and line, per ayah, plus each ayah's marker line.
 * Returns { ayahs: [{ surah, ayah, verseKey, tokens: [{ text, index, page, line, pause }], marker: { page, line } }],
 * problems } — `problems` lists every token whose text differs from Madina05's (ignoring tatweel) and every count
 * mismatch; the placement is only meaningful when it is empty.
 */
export function placeTanzilOnMadina05(madina, tanzil) {
  const problems = [];
  const ayahs = [];
  let row = 0;
  let rubOrnaments = 0;
  madina.suras.forEach((sura, surahIndex) => {
    const surah = surahIndex + 1;
    // Index 0 and 1 are the title and Basmala slots; real ayah A is at index A + 1.
    sura.ayas.slice(2).forEach((entry, ayahIndex) => {
      const ayah = ayahIndex + 1;
      const verse = tanzil[row++];
      if (!verse || verse.surah !== surah || verse.ayah !== ayah) throw new Error(`Madina05 ${surah}:${ayah} does not line up with Tanzil row ${row}`);
      const placed = [];
      let page = entry.p;
      let previousLine = 0;
      let marker = null;
      for (const part of entry.r) {
        if (part.l < previousLine) page += 1; // the ayah continues at the top of the next page
        previousLine = part.l;
        for (const raw of part.t.split(/\s+/).filter(Boolean)) {
          if (MARKER.test(raw)) { marker = { page, line: part.l }; continue; }
          // Madina05's own rub' al-hizb sign (U+06DE): not in the verified Tanzil text (the app marks quarters itself).
          const token = raw.replace(/۞/g, '');
          if (token) placed.push({ text: token, page, line: part.l });
          else rubOrnaments += 1;
        }
      }
      const own = tokensOf(verse.text);
      const skip = basmalaTokenCount(surah, ayah);
      const tokens = own.map((text, index) => ({ text, index, page: 0, line: 0, pause: PAUSE_MARK.test(text), basmala: index < skip }));
      const body = tokens.filter((token) => !token.basmala);
      // Madina05 attaches pause marks to the word before them and inserts tatweels, so tokens are compared as one
      // character stream: without spaces and tatweel both must be identical, letter for letter and mark for mark.
      // Each Tanzil token then takes the line of the Madina05 token holding its first character (a standalone pause
      // mark: the word it is printed over).
      const madinaStream = placed.map((p) => withoutTatweel(p.text)).join('');
      const tanzilStream = body.map((t) => withoutTatweel(t.text)).join('');
      if (madinaStream !== tanzilStream) {
        let at = 0;
        while (at < Math.min(madinaStream.length, tanzilStream.length) && madinaStream[at] === tanzilStream[at]) at += 1;
        const hex = (s) => [...s].map((c) => c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
        problems.push(`${verse.verseKey}: text differs at character ${at + 1}: Tanzil ${hex(tanzilStream.slice(at, at + 4))}, Madina05 ${hex(madinaStream.slice(at, at + 4))}`);
      }
      const owner = []; // stream offset -> Madina05 token
      placed.forEach((p, i) => { for (let k = 0; k < withoutTatweel(p.text).length; k++) owner.push(i); });
      let offset = 0;
      for (const token of body) {
        const at = placed[owner[Math.min(offset, owner.length - 1)]];
        offset += withoutTatweel(token.text).length;
        if (!at) continue;
        token.page = at.page;
        token.line = at.line;
      }
      if (!marker) problems.push(`${verse.verseKey}: no ayah marker in Madina05`);
      ayahs.push({ surah, ayah, verseKey: verse.verseKey, text: verse.text, tokens, marker });
    });
  });
  if (row !== tanzil.length) problems.push(`Madina05 has ${row} ayahs, Tanzil ${tanzil.length}`);
  return { ayahs, problems, rubOrnaments };
}

/** The decoration slots (title, Basmala) of every Surah: where Madina05 puts its heading and Basmala lines. */
export function surahOpeningsOf(madina) {
  return madina.suras.map((sura, surahIndex) => {
    const surah = surahIndex + 1;
    const [first, second] = sura.ayas;
    // Al-Fatiha's slots are [blank, title]; At-Tawba's [title, blank]; the rest [title, Basmala].
    const title = surah === 1 ? second : first;
    const basmala = surah === 1 || surah === 9 ? null : second;
    return {
      surah,
      heading: { page: title.p, line: title.r[0].l },
      basmala: basmala ? { page: basmala.p, line: basmala.r[0].l } : null,
    };
  });
}
