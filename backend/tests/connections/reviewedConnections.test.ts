import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  connectionUpdate,
  ConnectionValidationError,
  parseJsonRejectingDuplicateKeys,
  parseReviewedConnections,
  planConnectionChanges,
  REVIEWED_CONNECTIONS_PATH,
  type StoredMapping,
} from '../../src/connections/reviewedConnections';
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

  it('represents EVERY approved mapping exactly once (no more, no fewer)', () => {
    const pairs = (rows: { emotionKey: string; verseKey: string }[]) => rows.map((row) => `${row.emotionKey}|${row.verseKey}`).sort();
    expect(pairs(entries)).toEqual(pairs(approvedRows));
  });

  it('every entry is either the "..." placeholder in both languages, or real reviewed text', () => {
    for (const entry of entries) {
      const isPlaceholder = entry.connection.en === '...' || entry.connection.ar === '...';
      if (isPlaceholder) expect(entry.connection, `${entry.emotionKey} ${entry.verseKey}`).toEqual({ en: '...', ar: '...' });
      else expect(entry.connection.en ?? entry.connection.ar).toBeTruthy();
    }
  });

  describe('"sad" is populated with the approved copy; every other emotion is untouched', () => {
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

    it('3. sad + 39:67 resolves the approved revised wording', () => {
      expect(sadByVerse.get('39:67')?.en).toBe(
        'When sadness makes your problem feel bigger than everything else, this ayah restores perspective by reminding you of Allah’s greatness and power; what weighs heavily on you is not greater than Allah’s power.',
      );
      expect(sadByVerse.get('39:67')?.ar).toBe(
        'حين يجعل الحزن مشكلتك تبدو أكبر من كل شيء، تعيد هذه الآية لقلبك المنظور الصحيح بتذكيرك بعظمة الله وقدرته؛ فما يثقل عليك ليس أكبر من قدرة الله.',
      );
    });

    it('5. every entry outside "sad" is still exactly the "..." placeholder (no other emotion was touched)', () => {
      const others = entries.filter((entry) => entry.emotionKey !== 'sad');
      expect(others.length).toBeGreaterThan(0);
      for (const entry of others) {
        expect(entry.connection, `${entry.emotionKey} ${entry.verseKey}`).toEqual({ en: '...', ar: '...' });
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
