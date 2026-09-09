import { describe, expect, it } from 'vitest';
import { compareExisting, corpusChecksum, loadCorpus, parseTextExport, validateCorpus, validateMappings } from '../src/import/fullQuran';
import { seedAyahs } from '../src/seed/ayahs';
import { seedEmotions } from '../src/seed/emotions';
import { buildFoundationSeedData } from '../src/seed/foundation';
import { sha256Utf8 } from '../src/utils/checksum';

const source = loadCorpus();
const seed = buildFoundationSeedData(seedAyahs);
const snapshot = { verses: source.verses, versetranslations: source.translations, emotions: seedEmotions, emotionversemappings: seed.mappings };

describe('Pinned full Quran corpus', () => {
  it('validates all source records against the 114-surah metadata and exact file pins', () => {
    const report = validateCorpus(source, source);
    expect(report.valid).toBe(true);
    expect(report.expectedVerses).toBe(source.surahs.reduce((sum, s) => sum + s.count, 0));
    expect(source.surahs).toHaveLength(114);
    expect(report.arabicCorpusChecksum).toBe('bdcfb57ebff8c2e31cace329c1c0a8392a2b06f2b0c582465ae215ef53f97652');
    expect(report.translationCorpusChecksum).toBe('4e60f6ce1d2447c395b88feacc3784a2db829dff89777050b30f29f1ec837d01');
  });
  it('detects gaps and duplicates even when the overall count is unchanged', () => {
    const report = validateCorpus({ ...source, verses: [source.verses[0], ...source.verses.slice(0, -1)] }, source);
    expect(report.valid).toBe(false);
    expect(report.duplicateReferences).toBe(1);
    expect(report.duplicatePairs).toBe(1);
    expect(report.structuralGaps).toBe(1);
  });
  it('detects changed source text even if its checksum was recomputed', () => {
    const verses = structuredClone(source.verses);
    verses[0].arabicText += ' ';
    verses[0].checksum = sha256Utf8(verses[0].arabicText);
    const report = validateCorpus({ ...source, verses }, source);
    expect(report.valid).toBe(false);
    expect(report.arabicChecksumFailures).toBe(0);
    expect(report.arabicSourceConflicts).toBe(1);
  });
  it('rejects malformed, duplicate, empty and replacement-character source rows', () => {
    for (const text of ['01|1|x', '1|0|x', '1|1| ', '1|1|x\n1|1|x', '1|1|\ufffd', '<html>error</html>']) expect(() => parseTextExport(text)).toThrow();
  });
  it('preserves the text payload without trimming or normalization', () => {
    expect(parseTextExport('1|1|  unchanged  \n# notice\n')[0].text).toBe('  unchanged  ');
  });
  it('detects missing, orphaned and duplicated translations', () => {
    const translations = structuredClone(source.translations);
    translations[0].verseReferenceKey = '115:1';
    translations[1] = { ...translations[2] };
    const report = validateCorpus({ ...source, translations }, source);
    expect(report.valid).toBe(false);
    expect(report.orphanTranslations).toBe(1);
    expect(report.invalidTranslationReferences).toBe(1);
    expect(report.missingTranslations).toBe(2);
    expect(report.duplicateTranslations).toBe(1);
  });
  it('rejects missing metadata, empty text and bad checksums', () => {
    const verses = structuredClone(source.verses);
    const translations = structuredClone(source.translations);
    verses[0].arabicText = '';
    verses[1].checksum = '';
    verses[2].sourceVersion = '';
    verses[3].surahNumber = 115;
    translations[0].text = '';
    translations[1].translator = '';
    translations[2].checksum = '';
    const report = validateCorpus({ verses, translations }, source);
    expect(report.valid).toBe(false);
    expect(report.missingArabic).toBe(1);
    expect(report.missingChecksums).toBe(1);
    expect(report.arabicChecksumFailures).toBe(2);
    expect(report.translationChecksumFailures).toBe(2);
    expect(report.emptyTranslations).toBe(1);
    expect(report.invalidReferences).toBe(1);
  });
  it('keeps all 43 development mappings valid with most verses unmapped', () => {
    expect(validateMappings(snapshot)).toMatchObject({ valid: true, total: 43, activeEmotions: 12, statuses: { development: 43 } });
    expect(new Set(seed.mappings.map(m => m.verseReferenceKey)).size).toBe(16);
    expect(source.verses.length - 16).toBe(6220);
  });
  it('detects invalid mapping references, embedded text, statuses and duplicates', () => {
    const mappings = structuredClone(seed.mappings);
    mappings[0].verseReferenceKey = '115:1';
    mappings[1].emotionKey = 'missing';
    Object.assign(mappings[2], { arabicText: 'unexpected' });
    Object.assign(mappings[3], { status: 'fake' });
    mappings.push({ ...mappings[4] });
    expect(validateMappings({ ...snapshot, emotionversemappings: mappings })).toMatchObject({ valid: false, invalidMappings: 4, duplicateMappings: 1 });
  });
  it('refuses the original MVP conflicts and accepts identical source records', () => {
    const comparison = compareExisting({ ...snapshot, verses: seed.verses, versetranslations: seed.translations }, source);
    expect(comparison.safe).toBe(false);
    expect(comparison.verses.filter(v => !v.textMatches)).toHaveLength(6);
    expect(comparison.translations.filter(t => !t.textMatches)).toHaveLength(5);
    expect(compareExisting(snapshot, source).safe).toBe(true);
  });
  it('hashes numeric reference order deterministically with independent text streams', () => {
    const rows = source.verses.map(v => ({ referenceKey: v.referenceKey, text: v.arabicText }));
    expect(corpusChecksum(rows)).toBe(corpusChecksum([...rows].reverse()));
    expect(corpusChecksum(rows)).not.toBe(corpusChecksum(source.translations.map(t => ({ referenceKey: t.verseReferenceKey, text: t.text }))));
  });
});
