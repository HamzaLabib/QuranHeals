/**
 * «موضوعاتها» from Quranpedia's official surah-information dump (https://quranpedia.net/dumps/surahs.json.gz): the
 * source's own list items, verbatim, made compact by rules only (no rewording):
 *  1. HTML → lines; run-on items ("… (٤٠-١٦٢).تذكير …") split at the end of an ayah range;
 *  2. kept: list items only — numbered ("1. …"), ordinal ("أولًا: …"), or carrying an ayah range "(a-b)"; dropped: the
 *     lead-in line, the «ينظر: …» citation (kept as the reference instead), and quoted prose;
 *  3. the numbering and the ayah reference (a range, or a single ayah «(١٨)») are removed from the shown text (kept for
 *     step 4);
 *  4. sub-sections are dropped: an item whose range lies strictly inside another item's range (Al-Baqarah's outline
 *     nests sections under headings), so only the top-level headings remain.
 * Whatever this yields is 'pending-review': Quranpedia is a starting source, not a scholarly approval.
 */

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toInt = (s) => Number(String(s).replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c))));
const RANGE = /\(\s*([0-9٠-٩]+)\s*[-–]\s*([0-9٠-٩]+)\s*\)/;
/** Ayah references: a range «(٩-٣١)», or a single ayah «(١٨)». */
const RANGE_ALL = /\(\s*[0-9٠-٩]+\s*(?:[-–]\s*[0-9٠-٩]+\s*)?\)/g;
const SINGLE_AYAH = /\(\s*([0-9٠-٩]+)\s*\)/;
const NUMBERED = /^\s*[0-9٠-٩]+\s*[.)-]\s*/;
const ORDINAL = /^\s*(أولًا|أولاً|ثانيًا|ثانياً|ثالثًا|ثالثاً|رابعًا|رابعاً|خامسًا|خامساً|سادسًا|سادساً|سابعًا|سابعاً|ثامنًا|ثامناً|تاسعًا|تاسعاً|عاشرًا|عاشراً)\s*[:：]\s*/;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** The topics HTML as text lines. */
export function lines(html) {
  return decode(String(html).replace(/<\/p>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    // A run-on item: a new item begins right after an ayah range's closing ")." (or ")" not followed by its full stop).
    .flatMap((line) => line.split(/(?<=\(\s*[0-9٠-٩]+\s*[-–]\s*[0-9٠-٩]+\s*\)\.)(?=\s*\S)|(?<=\(\s*[0-9٠-٩]+\s*[-–]\s*[0-9٠-٩]+\s*\))(?=\s*[^\s.])/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** The «ينظر: …» reference line(s), as the source cites them. */
export function citation(html) {
  return lines(html).filter((l) => /^ينظر/.test(l)).join(' ') || null;
}

/** The compact topic items with their ayah range ([first, last], or null), before the text is taken (see the rules above). */
export function topicItems(html) {
  if (!html) return [];
  const items = [];
  for (const line of lines(html)) {
    if (/^ينظر/.test(line)) continue;
    const single = RANGE.test(line) ? null : SINGLE_AYAH.exec(line);
    const range = RANGE.exec(line) ?? (single ? [single[0], single[1], single[1]] : null);
    const listItem = NUMBERED.test(line) || ORDINAL.test(line) || range !== null;
    if (!listItem) continue;
    const text = line.replace(NUMBERED, '').replace(ORDINAL, '').replace(RANGE_ALL, '').replace(/\s+([.،؛:])/g, '$1').replace(/[.،؛:\s]+$/, '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    items.push({ text, range: range ? [toInt(range[1]), toInt(range[2])] : null });
  }
  // Top-level only: drop an item whose range lies strictly inside another's (equal ranges are both kept).
  const top = items.filter((item) => !item.range || !items.some((other) => other !== item && other.range
    && other.range[0] <= item.range[0] && other.range[1] >= item.range[1]
    && (other.range[0] !== item.range[0] || other.range[1] !== item.range[1])));
  // The same heading twice in a row (the source repeats a heading for its sub-parts) is shown once.
  return top.filter((item, i) => i === 0 || item.text !== top[i - 1].text);
}

/** The compact topic list (see the rules above), or null when the source has none. */
export function topics(html) {
  const items = topicItems(html);
  return items.length ? items.map((item) => item.text) : null;
}

/**
 * For a Surah whose Quranpedia record has no topics: al-Fairuzabadi's «بصائر ذوي التمييز في لطائف الكتاب العزيز»
 * (d. 817 AH; Quranpedia book 186, ed. Muhammad Ali al-Najjar), the chapter on that Surah, its «معظم مقصود السورة: …»
 * sentence — what the Surah mostly contains — verbatim and whole (one item: splitting it would edit it), up to the full
 * stop before the next section («الناسخ والمنسوخ»). Null when the chapter has no such sentence.
 */
export function basairTopics(contents, chapterId) {
  const text = contents
    .filter((entry) => entry.chapter_id === chapterId)
    .map((entry) => decode(String(entry.text).replace(/<[^>]+>/g, ' ')))
    .join(' ')
    .replace(/\s+/g, ' ');
  const match = /معظم مقصود السّ?ورة\s*:\s*([\s\S]*?)\s*\.\s*\(?الناسخ/.exec(text);
  if (!match) return null;
  const sentence = `${match[1].replace(/\s+([.،:؛])/g, '$1').trim()}.`;
  return sentence.length > 1 ? [sentence] : null;
}
