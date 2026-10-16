import type { LaidWord } from './layout';

/**
 * Unicode Mushaf prototype (development builds only): Tajweed colours, OFF by default.
 *
 * The rules are cpfair/quran-tajweed's (CC BY 4.0), carried onto the verified Tanzil text
 * (tools/unicode-mushaf/generate-tajweed.mjs): each annotation is one recitation rule over exact letters — never a
 * whole word for its own sake — and every range covers whole letters (a base letter and all its marks), so a colour
 * never separates a letter from its diacritics.
 *
 * Colouring changes nothing but colour: the same characters are drawn in the same runs of the same font at the same
 * positions (the layout never looks at this module), so pages and lines are identical with Tajweed ON and OFF. The ورد's
 * gold medallion is drawn separately and is never touched.
 *
 * Palette: the usual colour-coded Tajweed Mushaf convention (Dar al-Maarifah): reds and oranges for the prolongations
 * (madd) by length, green for nasalisation (ghunnah, ikhfa, iqlab, idgham with ghunnah), blue for qalqalah, grey for
 * letters written but not pronounced (hamzat al-wasl, lam shamsiyyah, silent letters, idgham without ghunnah). Each has
 * a Light and a Dark value chosen against the page's own paper.
 */

export type TajweedRule =
  | 'hamzat_wasl' | 'lam_shamsiyyah' | 'silent'
  | 'madd_2' | 'madd_246' | 'madd_munfasil' | 'madd_muttasil' | 'madd_6'
  | 'qalqalah'
  | 'ikhfa' | 'ikhfa_shafawi' | 'iqlab' | 'idghaam_ghunnah' | 'idghaam_no_ghunnah' | 'idghaam_shafawi'
  | 'idghaam_mutajanisayn' | 'idghaam_mutaqaribayn' | 'ghunnah';

/** generated/tajweedRules.ts's letters, in drawing priority (a later rule wins where two overlap). */
export const TAJWEED_RULE_CODES: Readonly<Record<string, TajweedRule>> = {
  b: 'hamzat_wasl', k: 'lam_shamsiyyah', r: 'silent',
  l: 'madd_2', m: 'madd_246', o: 'madd_munfasil', p: 'madd_muttasil', n: 'madd_6',
  q: 'qalqalah',
  h: 'ikhfa', i: 'ikhfa_shafawi', j: 'iqlab', c: 'idghaam_ghunnah', f: 'idghaam_no_ghunnah', g: 'idghaam_shafawi',
  d: 'idghaam_mutajanisayn', e: 'idghaam_mutaqaribayn', a: 'ghunnah',
};
const PRIORITY = Object.keys(TAJWEED_RULE_CODES);

type ColourKey = 'maddNecessary' | 'maddObligatory' | 'maddPermissible' | 'maddNatural' | 'ghunnah' | 'qalqalah' | 'unpronounced';

const RULE_COLOUR: Readonly<Record<TajweedRule, ColourKey>> = {
  madd_6: 'maddNecessary',
  madd_muttasil: 'maddObligatory',
  madd_munfasil: 'maddPermissible',
  madd_246: 'maddPermissible',
  madd_2: 'maddNatural',
  ghunnah: 'ghunnah',
  ikhfa: 'ghunnah',
  ikhfa_shafawi: 'ghunnah',
  iqlab: 'ghunnah',
  idghaam_ghunnah: 'ghunnah',
  idghaam_shafawi: 'ghunnah',
  qalqalah: 'qalqalah',
  hamzat_wasl: 'unpronounced',
  lam_shamsiyyah: 'unpronounced',
  silent: 'unpronounced',
  idghaam_no_ghunnah: 'unpronounced',
  idghaam_mutajanisayn: 'unpronounced',
  idghaam_mutaqaribayn: 'unpronounced',
};

/** Light: on Warm Cream #F9EFD2. Dark: on Warm Midnight Olive #222820. */
export const TAJWEED_PALETTES: Readonly<Record<'light' | 'dark', Readonly<Record<ColourKey, string>>>> = {
  light: {
    maddNecessary: '#9C1C1C',
    maddObligatory: '#D2302A',
    maddPermissible: '#D9650F',
    maddNatural: '#A87A00',
    ghunnah: '#13863A',
    qalqalah: '#1C69B5',
    unpronounced: '#8A8A86',
  },
  dark: {
    maddNecessary: '#FF7C7C',
    maddObligatory: '#FF9479',
    maddPermissible: '#FFAD5C',
    maddNatural: '#E2C05A',
    ghunnah: '#74CF8E',
    qalqalah: '#7DB8F2',
    unpronounced: '#959B8F',
  },
};

/** The legend's rows, in order: a colour, and the rules it marks. */
export const TAJWEED_LEGEND: readonly { colour: ColourKey; en: string; ar: string }[] = [
  { colour: 'maddNecessary', en: 'Necessary prolongation, 6', ar: 'مد لازم ٦ حركات' },
  { colour: 'maddObligatory', en: 'Obligatory prolongation, 4–5', ar: 'مد واجب ٤ أو ٥' },
  { colour: 'maddPermissible', en: 'Permissible prolongation, 2–6', ar: 'مد جائز ٢ أو ٤ أو ٦' },
  { colour: 'maddNatural', en: 'Natural prolongation, 2', ar: 'مد طبيعي حركتان' },
  { colour: 'ghunnah', en: 'Nasalisation (ghunnah)', ar: 'غنة وإخفاء وإقلاب' },
  { colour: 'qalqalah', en: 'Qalqalah', ar: 'قلقلة' },
  { colour: 'unpronounced', en: 'Not pronounced', ar: 'ما لا يُلفظ' },
];

export type TajweedSpan = { rule: TajweedRule; start: number; end: number };

const spanCaches = new WeakMap<readonly string[], Map<number, TajweedSpan[]>>();
/** A verse's Tajweed spans (offsets into its verified text), in priority order. */
export function tajweedSpans(rules: readonly string[], verseIndex: number): TajweedSpan[] {
  let cache = spanCaches.get(rules);
  if (!cache) {
    cache = new Map();
    spanCaches.set(rules, cache);
  }
  const cached = cache.get(verseIndex);
  if (cached) return cached;
  const spans = (rules[verseIndex] ?? '')
    .split(',')
    .filter(Boolean)
    .map((cell) => {
      const code = cell[0];
      const [start, end] = cell.slice(1).split('-').map((n) => parseInt(n, 36));
      const rule = TAJWEED_RULE_CODES[code];
      if (!rule || !(end > start)) throw new Error(`Bad Tajweed cell ${cell}`);
      return { rule, start, end, priority: PRIORITY.indexOf(code) };
    })
    .sort((a, b) => a.priority - b.priority)
    .map(({ rule, start, end }) => ({ rule, start, end }));
  cache.set(verseIndex, spans);
  return spans;
}

export type ColouredRun = { text: string; colour: string | null };

/**
 * A drawn word in coloured runs: its characters with the colour of the highest-priority rule covering each (null: the
 * page's ink). Inserted kashida tatweels take a colour only when the letters on both sides share it. Joined back, the
 * runs are exactly `word.text`.
 */
export function colourRuns(word: Pick<LaidWord, 'start' | 'end' | 'text' | 'kashida'>, spans: readonly TajweedSpan[], palette: Readonly<Record<ColourKey, string>>): ColouredRun[] {
  const length = word.end - word.start;
  const colours: (string | null)[] = new Array(length).fill(null);
  for (const span of spans) {
    const from = Math.max(span.start, word.start);
    const to = Math.min(span.end, word.end);
    for (let i = from; i < to; i++) colours[i - word.start] = palette[RULE_COLOUR[span.rule]];
  }
  const drawn: (string | null)[] = [];
  const k = word.kashida;
  for (let i = 0; i < length; i++) {
    if (k && i === k.index) {
      const shared = colours[i - 1] !== undefined && colours[i - 1] === colours[i] ? colours[i] : null;
      for (let t = 0; t < k.count; t++) drawn.push(shared);
    }
    drawn.push(colours[i]);
  }
  if (drawn.length !== word.text.length) throw new Error('Tajweed runs do not match the drawn word');
  const runs: ColouredRun[] = [];
  drawn.forEach((colour, i) => {
    const last = runs[runs.length - 1];
    if (last && last.colour === colour) last.text += word.text[i];
    else runs.push({ text: word.text[i], colour });
  });
  return runs;
}
