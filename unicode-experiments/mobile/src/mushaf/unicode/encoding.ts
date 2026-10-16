/**
 * Unicode Mushaf prototype: display encodings — how the verified Tanzil text is handed to a font that follows another
 * convention for the very same signs. Applied only to the characters drawn on screen; the verified text itself (copy,
 * share, reflections, favorites, every check) is never changed.
 *
 * 'kfgqpc': KFGQPC's Uthmanic Hafs fonts (v18 and later) follow KFGQPC's own text, in which the two sukun signs have
 * each other's code points relative to Tanzil:
 *  - Tanzil U+0652 (the Madina Mushaf's sukun, the head-of-khah shape) = KFGQPC U+06E1;
 *  - Tanzil U+06DF (the round zero over a letter that is written but not read) = KFGQPC U+0652.
 * Verified on every occurrence against KFGQPC's own text (hafsData_v18): word by word over the 77,135 words whose
 * letters match, all 36,901 Tanzil U+0652 are KFGQPC U+06E1 and all 3,988 Tanzil U+06DF are KFGQPC U+0652, with no
 * exception (docs/unicode-mushaf/feasibility-report.md). Without it the font draws every sukun as the round zero and
 * the real round zero as a placeholder circle. Tanzil never uses U+06E1, so the mapping is one-to-one: `fromDisplay`
 * gives back the verified text exactly.
 *
 * 'dk': DigitalKhatt fonts (QH Old Madina) draw a standalone pause sign (U+06D6–U+06DC: ۖ ۗ ۘ ۙ ۚ ۛ ۜ) as a mark over the
 * word it follows only when it is attached to it; after a space it falls between the words. So the space Tanzil puts
 * before a standalone pause sign is not drawn. Nothing else changes (the sajdah sign ۩ keeps its space). Not one for
 * one: drawn text is checked by recomputing it from the verified text (`toDisplay`), never by inverting it.
 *
 * Signs a font cannot draw at all in Tanzil's encoding are not re-encoded but drawn in a fallback font (words.ts,
 * LaidWord.fallback).
 */
export type DisplayEncoding = 'kfgqpc' | 'dk';

export const DISPLAY_ENCODINGS: Readonly<Record<'kfgqpc', Readonly<Record<string, string>>>> = {
  kfgqpc: { 'ْ': 'ۡ', '۟': 'ْ' },
};

const KFGQPC_INVERSE: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(DISPLAY_ENCODINGS.kfgqpc).map(([a, b]) => [b, a]));
const DK_PAUSE = /^[ۖ-ۜ]$/;

/**
 * What each character of `text` becomes when drawn (an empty string: not drawn). The unit for colour runs: a run is
 * drawn as the concatenation of its characters' outputs.
 */
export function displayChars(text: string, encoding: DisplayEncoding | null): string[] {
  const chars = [...text];
  if (encoding === 'kfgqpc') return chars.map((ch) => DISPLAY_ENCODINGS.kfgqpc[ch] ?? ch);
  if (encoding === 'dk') {
    // A space directly before a standalone pause sign: the sign's token is pause signs only, up to a space or the end.
    return chars.map((ch, i) => {
      if (ch !== ' ' || !DK_PAUSE.test(chars[i + 1] ?? '')) return ch;
      let j = i + 1;
      while (j < chars.length && DK_PAUSE.test(chars[j])) j++;
      return j === chars.length || chars[j] === ' ' ? '' : ch;
    });
  }
  return chars;
}

/** The characters a font is given for `text`. */
export function toDisplay(text: string, encoding: DisplayEncoding | null): string {
  if (!encoding) return text;
  return displayChars(text, encoding).join('');
}

/** Back from drawn characters to the verified text, for one-to-one encodings ('kfgqpc'); other encodings throw. */
export function fromDisplay(drawn: string, encoding: DisplayEncoding | null): string {
  if (!encoding) return drawn;
  if (encoding !== 'kfgqpc') throw new Error(`${encoding} is not one to one: compare toDisplay(verified) instead`);
  let out = '';
  for (const ch of drawn) out += KFGQPC_INVERSE[ch] ?? ch;
  return out;
}

/** Colour runs (consecutive pieces of one word's text) as drawn: each run's characters through displayChars. */
export function displayRuns<T extends { text: string }>(runs: readonly T[], encoding: DisplayEncoding | null): T[] {
  if (!encoding) return [...runs];
  const out = displayChars(runs.map((r) => r.text).join(''), encoding);
  let at = 0;
  return runs.map((run) => {
    const n = [...run.text].length;
    const text = out.slice(at, at + n).join('');
    at += n;
    return { ...run, text };
  });
}
