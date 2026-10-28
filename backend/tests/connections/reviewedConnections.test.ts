import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  connectionUpdate,
  ConnectionValidationError,
  EXCLUDED_CONNECTION_PAIRS,
  parseJsonRejectingDuplicateKeys,
  parseReviewedConnections,
  planConnectionChanges,
  REVIEWED_CONNECTIONS_PATH,
  type StoredMapping,
} from '../../src/connections/reviewedConnections';
import { getVerifiedArabicByVerseKey } from '../../src/quran/quranSource';
import { isValidVerseKey } from '../../src/quran/referenceKeys';
import { selectMappingConnection } from '../../src/services/MongooseQuranRepository';

const SAD_VERSE_KEYS = [
  '2:38', '2:112', '2:152', '2:153', '2:155', '2:156', '2:186', '2:255',
  '3:103', '3:120', '3:139', '3:186',
  '4:45', '4:148',
  '9:40', '9:51', '9:129',
  '10:62',
  '12:18', '12:83', '12:84', '12:86', '12:87',
  '14:42',
  '16:127',
  '20:40', '20:46',
  '21:89',
  '28:13',
  '39:53', '39:67',
  '40:44',
  '42:28',
  '57:4',
  '58:10',
  '65:3',
  '70:5',
  '93:3',
  '94:1', '94:2', '94:5', '94:6',
];

const json = (value: unknown) => JSON.stringify(value);
const problemsOf = (run: () => unknown): string[] => {
  try {
    run();
  } catch (error) {
    if (error instanceof ConnectionValidationError) return error.problems;
    throw error;
  }
  return [];
};

const approved = (emotionKey: string, verseKey: string, extra: Partial<StoredMapping> = {}): StoredMapping => ({
  _id: `${emotionKey}-${verseKey}`,
  emotionKey,
  verseReferenceKey: verseKey,
  status: 'approved',
  ...extra,
});

describe('the committed reviewed-connections.json', () => {
  const entries = parseReviewedConnections(readFileSync(REVIEWED_CONNECTIONS_PATH, 'utf8'));
  const approvedRows: { verseKey: string; emotionKey: string }[] = JSON.parse(
    readFileSync(resolve(__dirname, '../../data/emotion-candidates/consolidated/approved-mappings-current.json'), 'utf8'),
  ).rows;

  it('1. is structurally valid', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('1. only names pairs in the repo’s approved mapping set (the database is re-checked at apply time)', () => {
    for (const entry of entries) {
      expect(approvedRows.some((row) => row.emotionKey === entry.emotionKey && row.verseKey === entry.verseKey), `${entry.emotionKey} ${entry.verseKey}`).toBe(true);
    }
  });

  it('represents every approved mapping exactly once, except the owner-excluded pairs (no more, no fewer)', () => {
    const pairs = (rows: { emotionKey: string; verseKey: string }[]) => rows.map((row) => `${row.emotionKey}|${row.verseKey}`).sort();
    // Holds both before and after the exclusions are rejected in the consolidated approved set.
    const expected = pairs(approvedRows).filter((pair) => !EXCLUDED_CONNECTION_PAIRS.includes(pair));
    expect(pairs(entries)).toEqual(expected);
  });

  it('the 22 owner-excluded pairs are rejected in the consolidated approved set', () => {
    expect(EXCLUDED_CONNECTION_PAIRS).toHaveLength(22);
    for (const pair of EXCLUDED_CONNECTION_PAIRS) {
      expect(approvedRows.some((row) => `${row.emotionKey}|${row.verseKey}` === pair), pair).toBe(false);
    }
    expect(entries).toHaveLength(1991);
  });

  it('names none of the 22 owner-excluded pairs', () => {
    for (const entry of entries) expect(EXCLUDED_CONNECTION_PAIRS, `${entry.emotionKey} ${entry.verseKey}`).not.toContain(`${entry.emotionKey}|${entry.verseKey}`);
  });

  it('every entry has completed English and Arabic text — no "..." placeholder left', () => {
    for (const entry of entries) {
      const at = `${entry.emotionKey} ${entry.verseKey}`;
      expect(entry.connection.en, at).toBeTruthy();
      expect(entry.connection.ar, at).toBeTruthy();
      expect(entry.connection.en, at).not.toContain('...');
      expect(entry.connection.ar, at).not.toContain('...');
    }
  });

  it('every one of the 30 emotions has connection text', () => {
    expect(new Set(entries.map((entry) => entry.emotionKey)).size).toBe(30);
  });

  it('keeps an owner-approved "Keep" text verbatim (lost 7:43)', () => {
    const lost = entries.find((entry) => entry.emotionKey === 'lost' && entry.verseKey === '7:43');
    expect(lost?.connection.en).toMatch(/^When you feel lost, unsure which path to take, this ayah reminds you that true guidance comes from Allah alone\./);
    expect(lost?.connection.ar).toMatch(/^حين تشعر بالتوهان، وتتشابك أمامك الطرق فلا تدري أين تمضي/);
  });

  describe('"sad" keeps its approved copy (2026-10-19 editorial refinement applied)', () => {
    const sadEntries = entries.filter((entry) => entry.emotionKey === 'sad');
    const sadByVerse = new Map(sadEntries.map((entry) => [entry.verseKey, entry.connection]));

    it('6. has exactly the 42 approved "sad" verse keys — none lost, none duplicated', () => {
      expect(sadEntries).toHaveLength(42);
      expect([...sadByVerse.keys()].sort()).toEqual([...SAD_VERSE_KEYS].sort());
    });

    it('none of the 42 "sad" entries are still the "..." placeholder', () => {
      for (const [verseKey, connection] of sadByVerse) {
        expect(connection.en, verseKey).not.toBe('...');
        expect(connection.ar, verseKey).not.toBe('...');
        expect(connection.en, verseKey).toBeTruthy();
        expect(connection.ar, verseKey).toBeTruthy();
      }
    });

    it('1. sad + 20:40 resolves the approved English connection', () => {
      expect(sadByVerse.get('20:40')?.en).toBe(
        'Painful events may feel heavy while you are living through them, but this ayah shows how Allah guides your path through things whose wisdom you could not see at the time, and that He is able to deliver you from anguish after hardship.',
      );
    });

    it('2. sad + 20:40 resolves the approved Arabic connection', () => {
      expect(sadByVerse.get('20:40')?.ar).toBe(
        'قد تبدو الأحداث المؤلمة ثقيلة وأنت تعيشها، لكن هذه الآية تريك كيف يدبّر الله طريقك عبر أمور لم ترَ حكمتها حينها، وأنه قادر أن ينجيك من الغم بعد الشدة.',
      );
    });

    it('3. sad + 39:67 resolves the owner-approved refined wording', () => {
      expect(sadByVerse.get('39:67')?.en).toBe(
        '“They did not esteem Allah as He truly deserves.” The ayah then describes the whole earth in His grasp on the Day of Resurrection and the heavens folded in His right hand. Sadness can make one burden fill your entire horizon until you see nothing else. Yet what weighs on your heart is never beyond Allah\'s power. Remember His greatness when sorrow feels greater than you can bear.',
      );
      expect(sadByVerse.get('39:67')?.ar).toBe(
        '«وما قدروا الله حق قدره»، ثم تصف الآية الأرض جميعًا في قبضته يوم القيامة والسماوات مطويّات بيمينه. قد يجعل الحزن همًّا واحدًا يملأ أفقك حتى لا ترى سواه. لكن ما أثقل قلبك لا يعجز الله؛ فاستحضر عظمته حين تشعر أن حزنك أكبر من قدرتك على الاحتمال.',
      );
    });

    it('5. every other emotion has its own text — none copies the "sad" connection for the same verse', () => {
      const others = entries.filter((entry) => entry.emotionKey !== 'sad');
      expect(others.length).toBeGreaterThan(0);
      for (const entry of others) {
        const sad = sadByVerse.get(entry.verseKey);
        if (!sad) continue;
        expect(entry.connection.en, `${entry.emotionKey} ${entry.verseKey}`).not.toBe(sad.en);
        expect(entry.connection.ar, `${entry.emotionKey} ${entry.verseKey}`).not.toBe(sad.ar);
      }
    });

    it('1/2. full pipeline: selectMappingConnection resolves sad 20:40 by locale exactly like an approved mapping would', () => {
      const connection = sadByVerse.get('20:40')!;
      const resolved = selectMappingConnection([{ emotionKey: 'sad', status: 'approved', connection }], 'sad');
      expect(resolved?.en).toBe(connection.en);
      expect(resolved?.ar).toBe(connection.ar);
    });

    it('4. a mapping for a different emotion never receives the "sad" connection, even for the same verse key', () => {
      const connection = sadByVerse.get('20:40')!;
      expect(selectMappingConnection([{ emotionKey: 'sad', status: 'approved', connection }], 'hopeless')).toBeUndefined();
      expect(selectMappingConnection([{ emotionKey: 'hopeless', status: 'approved' }], 'hopeless')).toBeUndefined();
    });
  });

  describe('Arabic «…» quotations are verbatim Quran (release audit B8, 2026-10-28)', () => {
    // Consonant skeleton: drops harakat, Quranic marks, tatweel, long-vowel and
    // hamza carriers, and doubled letters (shadda vs. Uthmani single-lam
    // spellings such as ٱلَّيْل), so plain modern spelling compares with Tanzil
    // Uthmani while a missing or added word still fails.
    const skeleton = (text: string) =>
      text
        .normalize('NFC')
        .replace(/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g, '')
        .replace(/[^ء-ي]/g, '')
        .replace(/[اأإآٱىءؤئويه]/g, '')
        .replace(/(.)\1+/g, '$1');

    // Quoted phrases that are deliberately not the ayah's words, each checked by hand.
    const NON_QURAN_QUOTES: Record<string, string> = {
      'afraid|9:51|ماذا لو': 'the reader’s own “what if”',
      'anxious|9:51|ماذا لو؟': 'the reader’s own “what if”',
      'closer_to_allah|2:186|فقل لهم إني قريب': 'contrast: what the ayah does not say',
      'guilty|4:110|قد يجد': 'contrast: what the ayah does not say',
      'lost|17:9|إلى أين أمضي؟': 'the reader’s own question',
      'content|28:13|قرة العين': 'descriptive phrase from «تقر عينها»; flagged for the content reviewer',
    };

    const neighbours = (verseKey: string) => {
      const [surah, ayah] = verseKey.split(':').map(Number);
      return [ayah - 2, ayah - 1, ayah, ayah + 1, ayah + 2]
        .map((n) => `${surah}:${n}`)
        .filter((key) => isValidVerseKey(key));
    };

    it('every quoted span is a contiguous part of its ayah or an adjacent one (context such as 26:61 for 26:62)', () => {
      const failures: string[] = [];
      let checked = 0;
      for (const entry of entries) {
        for (const [, span] of entry.connection.ar?.matchAll(/«([^»]+)»/g) ?? []) {
          const id = `${entry.emotionKey}|${entry.verseKey}|${span}`;
          if (id in NON_QURAN_QUOTES) continue;
          checked += 1;
          const quoted = skeleton(span);
          if (!neighbours(entry.verseKey).some((key) => skeleton(getVerifiedArabicByVerseKey(key)).includes(quoted))) failures.push(id);
        }
      }
      expect(checked).toBeGreaterThan(850);
      expect(failures).toEqual([]);
    });

    it('quotes 16:127 (stressed) and 11:112 (faith_shaken) without dropping words', () => {
      const text = (emotionKey: string, verseKey: string) =>
        entries.find((entry) => entry.emotionKey === emotionKey && entry.verseKey === verseKey)!.connection;
      expect(text('stressed', '16:127').ar).toContain('«واصبر وما صبرك إلا بالله ولا تحزن عليهم ولا تك في ضيق مما يمكرون»');
      expect(text('stressed', '16:127').en).toContain('Do not grieve over them');
      expect(text('faith_shaken', '11:112').ar).toContain('«فاستقم كما أمرت ومن تاب معك ولا تطغوا»');
    });

    it('the check itself rejects a quotation with a word dropped from the middle', () => {
      const ayah = skeleton(getVerifiedArabicByVerseKey('16:127'));
      expect(ayah.includes(skeleton('واصبر وما صبرك إلا بالله ولا تك في ضيق مما يمكرون'))).toBe(false);
      expect(ayah.includes(skeleton('ولا تحزن عليهم ولا تك في ضيق مما يمكرون'))).toBe(true);
    });
  });
});

describe('file validation (before any database access)', () => {
  it('accepts en and/or ar, trimming whitespace', () => {
    expect(parseReviewedConnections(json({ sad: { '93:3': { en: '  a  ', ar: 'ب' }, '94:5': { ar: 'ج' } } }))).toEqual([
      { emotionKey: 'sad', verseKey: '93:3', connection: { en: 'a', ar: 'ب' } },
      { emotionKey: 'sad', verseKey: '94:5', connection: { ar: 'ج' } },
    ]);
  });

  it('2. rejects an unknown emotion', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ melancholy: { '93:3': { en: 'x' } } })))).toEqual(['Unknown emotion "melancholy".']);
  });

  it('rejects a pair excluded by an owner Remove decision', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ lonely: { '40:16': { en: 'x', ar: 'ب' } } })))).toEqual([
      'lonely 40:16: excluded by an owner Remove decision; it must not receive connection text.',
    ]);
    // The same verse is fine for an emotion that was kept.
    expect(parseReviewedConnections(json({ hopeless: { '40:16': { en: 'x' } } }))).toHaveLength(1);
  });

  it.each(['93:0', '115:1', '93-3', '093:3', '2:287', 'abc'])('3. rejects invalid verseKey %s', (verseKey) => {
    expect(problemsOf(() => parseReviewedConnections(json({ sad: { [verseKey]: { en: 'x' } } })))[0]).toMatch(/invalid verseKey/);
  });

  it('6. rejects blank text (and whitespace-only), asking to omit the field instead', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ sad: { '93:3': { en: '   ', ar: 'x' } } })))).toEqual(['sad 93:3: "en" is blank; omit the field instead.']);
    expect(problemsOf(() => parseReviewedConnections(json({ sad: { '93:3': {} } })))).toEqual(['sad 93:3: needs "en" and/or "ar".']);
  });

  it('7. rejects text over 2,000 characters (after trimming); exactly 2,000 is fine', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ sad: { '93:3': { en: 'x'.repeat(2001) } } })))[0]).toMatch(/2001 characters \(max 2000\)/);
    expect(parseReviewedConnections(json({ sad: { '93:3': { en: ` ${'x'.repeat(2000)} ` } } }))[0].connection.en).toHaveLength(2000);
  });

  it('rejects non-string values and unknown fields', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ sad: { '93:3': { en: 5, ar: 'x', fr: 'y', status: 'approved' } } })))).toEqual([
      'sad 93:3: unknown field(s) "fr", "status"; only "en" and "ar" are allowed.',
      'sad 93:3: "en" must be a string.',
    ]);
  });

  it('rejects duplicate emotion or verse keys that JSON.parse would silently collapse', () => {
    const duplicateVerse = '{ "sad": { "93:3": { "en": "a" }, "93:3": { "en": "b" } } }';
    expect(problemsOf(() => parseReviewedConnections(duplicateVerse))[0]).toMatch(/Duplicate key "sad\.93:3"/);
    const duplicateEmotion = '{ "sad": { "93:3": { "en": "a" } }, "sad": { "94:5": { "en": "b" } } }';
    expect(problemsOf(() => parseReviewedConnections(duplicateEmotion))[0]).toMatch(/Duplicate key "sad"/);
  });

  it('reports every problem at once and rejects malformed JSON', () => {
    expect(problemsOf(() => parseReviewedConnections(json({ nope: { '1:99': { en: '' } } })))).toHaveLength(3);
    expect(problemsOf(() => parseReviewedConnections('{ "sad": '))[0]).toMatch(/Not valid JSON/);
    expect(problemsOf(() => parseReviewedConnections('[]'))).toEqual(['Top level must be an object keyed by emotionKey.']);
  });

  it('the duplicate-aware parser agrees with JSON.parse on valid input', () => {
    const text = '{"a":[1,2.5,-3e2,true,false,null,"x\\"y\\u00e9"],"b":{"c":{}}}';
    expect(parseJsonRejectingDuplicateKeys(text)).toEqual(JSON.parse(text));
  });
});

describe('planning against the target database', () => {
  const entries = parseReviewedConnections(json({ sad: { '93:3': { en: 'A', ar: 'ب' }, '94:5': { en: 'B' } } }));

  it('plans updates only for approved mappings whose text differs', () => {
    const { changes, unchanged } = planConnectionChanges(entries, [approved('sad', '93:3'), approved('sad', '94:5', { connection: { en: 'B' } })]);
    expect(unchanged).toBe(1);
    expect(changes).toEqual([{ emotionKey: 'sad', verseKey: '93:3', mappingId: 'sad-93:3', before: null, after: { en: 'A', ar: 'ب' } }]);
  });

  it('4. refuses a nonexistent mapping', () => {
    expect(problemsOf(() => planConnectionChanges(entries, [approved('sad', '93:3')]))).toEqual(['sad 94:5: no such mapping in the target database.']);
  });

  it.each(['development', 'draft', 'reviewed', 'rejected'] as const)('5. refuses a %s mapping', (status) => {
    expect(problemsOf(() => planConnectionChanges(entries, [approved('sad', '93:3', { status }), approved('sad', '94:5')]))).toEqual([
      `sad 93:3: mapping status is "${status}"; connection text is only allowed on approved mappings.`,
    ]);
  });

  it('refuses ambiguous duplicate mapping documents', () => {
    expect(problemsOf(() => planConnectionChanges(entries, [approved('sad', '93:3'), approved('sad', '93:3'), approved('sad', '94:5')]))[0]).toMatch(/duplicate mapping documents/);
  });

  it('9. the update touches only connection.en / connection.ar', () => {
    expect(connectionUpdate({ en: 'A', ar: 'ب' })).toEqual({ $set: { 'connection.en': 'A', 'connection.ar': 'ب' } });
    expect(connectionUpdate({ en: 'A' })).toEqual({ $set: { 'connection.en': 'A' }, $unset: { 'connection.ar': '' } });
  });
});
