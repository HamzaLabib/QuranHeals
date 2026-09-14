import { describe, expect, it } from 'vitest';

import {
  evaluateRows,
  isValidRow,
  summarize,
} from '../../src/scripts/importCandidateMappings';

describe('Phase 5A candidate-mapping import validation', () => {
  it('accepts a well-formed row that targets a known emotion key', () => {
    const [row] = evaluateRows([
      {
        verseKey: '2:153',
        emotionKey: 'patience',
        rationale: 'Core sabr verse.',
        source: 'test',
      },
    ]);

    expect(row.issues).toEqual([]);
    expect(isValidRow(row)).toBe(true);
    // `patience` is a taxonomy key but not a shipped emotion yet.
    expect(row.activatableToday).toBe(false);
  });

  it('marks a row targeting a shipped emotion as activatable today', () => {
    const [row] = evaluateRows([
      { verseKey: '13:28', emotionKey: 'peaceful', rationale: 'Hearts at rest.', source: 'test' },
    ]);

    expect(isValidRow(row)).toBe(true);
    expect(row.activatableToday).toBe(true);
  });

  it('rejects verse keys outside the verified 6,236-verse set', () => {
    const rows = evaluateRows([
      { verseKey: '2:300', emotionKey: 'sad', rationale: 'x', source: 'test' },
      { verseKey: '115:1', emotionKey: 'sad', rationale: 'x', source: 'test' },
      { verseKey: 'not-a-key', emotionKey: 'sad', rationale: 'x', source: 'test' },
    ]);

    expect(rows.every((row) => row.issues.includes('invalid_verse_key'))).toBe(true);
    expect(summarize(rows).invalidRows).toBe(3);
  });

  it('rejects unknown emotion keys and missing required fields', () => {
    const [unknownEmotion, missingRationale, missingSource] = evaluateRows([
      { verseKey: '2:153', emotionKey: 'made_up_emotion', rationale: 'x', source: 'test' },
      { verseKey: '2:153', emotionKey: 'sad', source: 'test' },
      { verseKey: '2:153', emotionKey: 'sad', rationale: 'x' },
    ]);

    expect(unknownEmotion.issues).toContain('unknown_emotion_key');
    expect(missingRationale.issues).toContain('missing_rationale');
    expect(missingSource.issues).toContain('missing_source');
  });

  it('refuses rows that carry Quran text', () => {
    const [row] = evaluateRows([
      {
        verseKey: '2:153',
        emotionKey: 'sad',
        rationale: 'x',
        source: 'test',
        arabicText: 'يَـٰٓأَيُّهَا ٱلَّذِينَ ءَامَنُوا۟',
      },
    ]);

    expect(row.issues).toContain('forbidden_text_field');
    expect(isValidRow(row)).toBe(false);
  });

  it('flags malformed (non-object) rows without throwing', () => {
    const rows = evaluateRows([42 as unknown as Record<string, unknown>, null as unknown as Record<string, unknown>]);
    expect(rows.every((row) => row.issues.includes('malformed_row'))).toBe(true);
  });

  it('detects duplicate (verseKey, emotionKey) pairs within one batch', () => {
    const rows = evaluateRows([
      { verseKey: '2:153', emotionKey: 'sad', rationale: 'first', source: 'test' },
      { verseKey: '2:153', emotionKey: 'sad', rationale: 'second', source: 'test' },
      { verseKey: '2:153', emotionKey: 'anxious', rationale: 'different pair', source: 'test' },
    ]);

    expect(rows[0].issues).toEqual([]);
    expect(rows[1].issues).toContain('duplicate_in_input');
    expect(rows[2].issues).toEqual([]);
  });

  it('summarizes valid vs invalid counts for the review report', () => {
    const summary = summarize(
      evaluateRows([
        { verseKey: '2:153', emotionKey: 'patience', rationale: 'ok', source: 'test' },
        { verseKey: '2:300', emotionKey: 'sad', rationale: 'verse out of range', source: 'test' },
      ]),
    );

    expect(summary.totalRows).toBe(2);
    expect(summary.validRows).toBe(1);
    expect(summary.invalidRows).toBe(1);
  });
});
