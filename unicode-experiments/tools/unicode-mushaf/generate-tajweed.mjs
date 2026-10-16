#!/usr/bin/env node
// Generates the Unicode Mushaf prototype's Tajweed annotations:
//
//   node tools/unicode-mushaf/generate-tajweed.mjs <cacheDir> [--check]
//
// Source: cpfair/quran-tajweed (pinned below), rule-based annotations of the
// Hafs recitation produced by its decision trees (ghunnah, idghaam, ikhfa,
// iqlab, madd, qalqalah, hamzat al-wasl, lam shamsiyyah, silent letters),
// licensed CC BY 4.0. Its character offsets refer to its own copy of the
// Tanzil Uthmani text (2017), which differs from the app's verified Tanzil
// text only in encoding: ours adds tatweels before dagger alef / hamza /
// small yeh, standalone pause marks with their spaces, and the space of three
// joined pairs. Every annotation is carried onto our text through an exact
// character alignment and refused unless it covers the same letters there.
// Each range is then widened to whole letters (a base letter and all its
// marks), so a colour never splits a letter from its diacritics.
//
// Writes mobile/src/mushaf/unicode/generated/tajweedRules.ts: offsets into
// the verified text, never the text itself.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { loadTanzil, repoRoot } from './madina05.mjs';

const SOURCE = {
  repository: 'cpfair/quran-tajweed',
  commit: '496f71cd191da00fa2a37ded79dbbddb033bb0ad',
  license: 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)',
  annotations: { url: 'https://raw.githubusercontent.com/cpfair/quran-tajweed/496f71cd191da00fa2a37ded79dbbddb033bb0ad/output/tajweed.hafs.uthmani-pause-sajdah.json', sha256: '151d616ad37a4cc21a80f20d5e1104c5b408375107ddd4d71247dea4c05ebf67' },
  text: { url: 'https://github.com/cpfair/quran-tajweed/files/7281388/quran-uthmani.txt', sha256: 'abe6447a5d29bb126383ba9120628060cf96dc9ef5b402a506fc251f6ed0b9a2' },
};
/** One letter per rule (the reader's palette keys); order = drawing priority when two ranges overlap (later wins). */
export const RULE_CODES = {
  hamzat_wasl: 'b', lam_shamsiyyah: 'k', silent: 'r',
  madd_2: 'l', madd_246: 'm', madd_munfasil: 'o', madd_muttasil: 'p', madd_6: 'n',
  qalqalah: 'q',
  ikhfa: 'h', ikhfa_shafawi: 'i', iqlab: 'j', idghaam_ghunnah: 'c', idghaam_no_ghunnah: 'f', idghaam_shafawi: 'g',
  idghaam_mutajanisayn: 'd', idghaam_mutaqaribayn: 'e', ghunnah: 'a',
};

const args = process.argv.slice(2);
const check = args.includes('--check');
const cacheDir = args.find((a) => !a.startsWith('--'));
if (!cacheDir) throw new Error('Usage: node tools/unicode-mushaf/generate-tajweed.mjs <cacheDir> [--check]');
if (!relative(repoRoot, resolve(cacheDir)).startsWith('..')) throw new Error('Refusing to cache inside the repository');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function pinned({ url, sha256: expected }, name) {
  const path = join(resolve(cacheDir), 'quran-tajweed', SOURCE.commit, name);
  let bytes = existsSync(path) ? readFileSync(path) : null;
  if (!bytes || sha256(bytes) !== expected) {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== expected) throw new Error(`${name} does not match its pinned SHA-256`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  return bytes.toString('utf8');
}

const annotations = JSON.parse(await pinned(SOURCE.annotations, 'tajweed.json'));
const oldText = new Map();
for (const line of (await pinned(SOURCE.text, 'quran-uthmani-2017.txt')).split('\n')) {
  const [s, a, ...rest] = line.replace(/\r$/, '').split('|');
  if (rest.length) oldText.set(`${s}:${a}`, rest.join('|'));
}
const verses = loadTanzil();
if (annotations.length !== verses.length || oldText.size !== verses.length) throw new Error('verse counts differ');

const TATWEEL = 'ـ';
const INSERTABLE = /[ـ ۖ-ۜ۩]/; // what our text adds: tatweel, spaces, pause and sajdah signs
const isMark = (ch) => /\p{Mn}/u.test(ch);

/** old offset → [first, last] offsets in ours; throws when the texts are not the same letters. */
function align(ours, old, verseKey) {
  const map = new Array(old.length);
  let i = 0;
  let j = 0;
  while (j < old.length) {
    if (i >= ours.length) throw new Error(`${verseKey}: ran out of text at old ${j}`);
    if (ours[i] === old[j]) { map[j++] = [i, i]; i++; continue; }
    // Encoding replacements: ours ـٔ / ـۧ for old ء / ۦ, and ours ـ for old ى (12:39, 12:41).
    if (ours[i] === TATWEEL && ours[i + 1] === 'ٔ' && old[j] === 'ء') { map[j++] = [i, i + 1]; i += 2; continue; }
    if (ours[i] === TATWEEL && ours[i + 1] === 'ۧ' && old[j] === 'ۦ') { map[j++] = [i, i + 1]; i += 2; continue; }
    if (ours[i] === TATWEEL && old[j] === 'ى' && (verseKey === '12:39' || verseKey === '12:41')) { map[j++] = [i, i]; i++; continue; }
    if (INSERTABLE.test(ours[i])) { i++; continue; }
    throw new Error(`${verseKey}: cannot align ours[${i}] U+${ours.codePointAt(i).toString(16)} with old[${j}] U+${old.codePointAt(j).toString(16)}`);
  }
  for (; i < ours.length; i++) if (!INSERTABLE.test(ours[i])) throw new Error(`${verseKey}: ours has more letters at ${i}`);
  return map;
}
const lettersOf = (s) => s.replace(/[ـ ۖ-ۜ۩]/g, '').replace(/ٔ/g, 'ء').replace(/ۧ/g, 'ۦ');

const out = [];
let total = 0;
let widened = 0;
const counts = {};
for (let v = 0; v < verses.length; v++) {
  const { verseKey, text: ours } = verses[v];
  const entry = annotations[v];
  if (`${entry.surah}:${entry.ayah}` !== verseKey) throw new Error(`annotation order differs at ${verseKey}`);
  const old = oldText.get(verseKey);
  const map = align(ours, old, verseKey);
  const cells = [];
  for (const { rule, start, end } of entry.annotations) {
    const code = RULE_CODES[rule];
    if (!code) throw new Error(`unknown rule ${rule}`);
    if (!(start >= 0 && end > start && end <= old.length)) throw new Error(`${verseKey}: bad range ${start}-${end}`);
    let s = map[start][0];
    let e = map[end - 1][1] + 1;
    const oldLetters = lettersOf(old.slice(start, end));
    const ourLetters = lettersOf(ours.slice(s, e));
    if (oldLetters !== ourLetters && oldLetters.replace(/ى/g, '') !== ourLetters) throw new Error(`${verseKey} ${rule}: «${old.slice(start, end)}» became «${ours.slice(s, e)}»`);
    // Whole letters: back to the base of the first letter, on to the last mark of the last.
    const [s0, e0] = [s, e];
    while (s > 0 && isMark(ours[s])) s--;
    while (e < ours.length && isMark(ours[e])) e++;
    if (s !== s0 || e !== e0) widened++;
    cells.push(`${code}${s.toString(36)}-${e.toString(36)}`);
    counts[rule] = (counts[rule] ?? 0) + 1;
    total++;
  }
  out.push(cells.join(','));
}
if (total !== 60057) throw new Error(`${total} annotations, expected 60057`);

const body = `// GENERATED by tools/unicode-mushaf/generate-tajweed.mjs — do not edit.
//
// Tajweed rule annotations (Hafs) for the Unicode Mushaf prototype (development builds only), from
// ${SOURCE.repository} (commit ${SOURCE.commit}) by Collin Fair, licensed ${SOURCE.license}.
// Modified by Quran Heals: offsets carried onto the app's verified Tanzil text (mobile/assets/quran/quran.sqlite)
// through an exact character alignment (every annotation covers the same letters), and widened to whole letters
// (a base letter with all its marks) — ${widened} of ${total} ranges.
//
// Offsets into the Tanzil Quran Text (Uthmani, Version 1.1), Copyright (C) 2007-2026 Tanzil Project, CC BY 3.0 —
// used verbatim, unchanged (https://tanzil.net); full notice: mobile/assets/quran/TANZIL-NOTICE.txt.
//
// Per verse (index 0 = 1:1): comma-separated "<rule><start>-<end>", start and end (exclusive) in base 36, as UTF-16
// offsets into that verse's verified text. Rule letters: ${Object.entries(RULE_CODES).map(([r, c]) => `${c} ${r}`).join(', ')}.

export const TAJWEED_SOURCE = ${JSON.stringify({ repository: SOURCE.repository, commit: SOURCE.commit, license: SOURCE.license, annotations: total })} as const;

export const TAJWEED_RULES: readonly string[] = [
${out.map((line) => `${JSON.stringify(line)},`).join('\n')}
];
`;
const target = join(repoRoot, 'mobile/src/mushaf/unicode/generated/tajweedRules.ts');
if (check) {
  if (readFileSync(target, 'utf8') !== body) throw new Error(`${target} is out of date: run without --check`);
  console.log('tajweedRules.ts is up to date');
} else {
  writeFileSync(target, body);
  console.log(`Wrote ${target} (${(body.length / 1024).toFixed(0)} KB): ${total} annotations on 6236 verses, ${widened} widened to whole letters`);
  console.log(Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(', '));
}
