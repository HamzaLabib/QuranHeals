import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EmotionEntity, EmotionVerseMappingEntity, VerseEntity, VerseTranslationEntity } from '../types/domain';
import { sha256Utf8 } from '../utils/checksum';
import { buildCanonicalVerseDocuments, validateCanonicalVerseBatch } from './quranImporter';

export const dataDirectory = resolve(process.cwd(), 'data/quran');
export const arabicSource = 'Tanzil Project https://tanzil.net — Uthmani export';
export const arabicVersion = '1.1';
export const translationSource = 'Tanzil https://tanzil.net/trans/en.pickthall';
export const translationVersion = 'en.pickthall-2010-09-04';
export const translator = 'Marmaduke Pickthall';
export const translationLicense = 'Tanzil export: non-commercial use only; commercial permission not verified. https://tanzil.net/trans/';
export type Surah = { number: number; count: number; arabicName: string; englishName: string };
export type Corpus = { surahs: Surah[]; verses: VerseEntity[]; translations: VerseTranslationEntity[] };
export type Snapshot = { verses: VerseEntity[]; versetranslations: VerseTranslationEntity[]; emotionversemappings: EmotionVerseMappingEntity[]; emotions: EmotionEntity[] };

// Pins are deliberately independent of the downloaded retrieval log.
const pins: Record<string, string> = {
  'quran-uthmani.txt': '7f30c647331a61100ebf24a80507dc0fcdd9f2df97f1312b5b2dfcb982a7f326',
  'en.pickthall.txt': '4aabbfa9d96796f5a6b0217d2c39dce1a3084f772bf6f2650e37082a774e3cc7',
  'quran-data.xml': '8867c1d88191472adec9db694b3cd9f135b1a2ef580574d32cf888dcb22c5c7a',
};

function readPinned(file: string) {
  const bytes = readFileSync(resolve(dataDirectory, file));
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (sha256Utf8(text) !== pins[file]) throw new Error(`Source file checksum mismatch: ${file}`);
  return text;
}

export function parseTextExport(text: string) {
  const rows: { referenceKey: string; surahNumber: number; ayahNumber: number; text: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([1-9]\d{0,2})\|([1-9]\d{0,2})\|(.+)$/.exec(line);
    if (!match || !match[3].trim() || /[\u0000-\u001f\ufffd]/u.test(match[3])) throw new Error('Malformed source row; no repair attempted.');
    const referenceKey = `${match[1]}:${match[2]}`;
    if (seen.has(referenceKey)) throw new Error(`Duplicate source reference ${referenceKey}`);
    seen.add(referenceKey);
    rows.push({ referenceKey, surahNumber: Number(match[1]), ayahNumber: Number(match[2]), text: match[3] });
  }
  return rows;
}

export function corpusChecksum(rows: { referenceKey: string; text: string }[]) {
  const sorted = [...rows].sort((a, b) => {
    const [as, aa] = a.referenceKey.split(':').map(Number);
    const [bs, ba] = b.referenceKey.split(':').map(Number);
    return as - bs || aa - ba;
  });
  // JSON string escaping makes framing unambiguous; includes a final LF.
  return sha256Utf8(sorted.map(row => JSON.stringify([row.referenceKey, row.text]) + '\n').join(''));
}

export function loadCorpus(): Corpus {
  const xml = readPinned('quran-data.xml');
  const surahs = [...xml.matchAll(/<sura\s+([^>]+)\/>/g)].map(match => {
    const attributes = Object.fromEntries([...match[1].matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], a[2]]));
    return { number: Number(attributes.index), count: Number(attributes.ayas), arabicName: attributes.name, englishName: attributes.tname };
  });
  if (surahs.length !== 114 || surahs.some((s, i) => s.number !== i + 1 || !Number.isInteger(s.count) || s.count < 1 || !s.arabicName || !s.englishName)) throw new Error('Invalid pinned surah metadata.');
  const verses = buildCanonicalVerseDocuments(parseTextExport(readPinned('quran-uthmani.txt')).map(row => ({
    referenceKey: row.referenceKey, surahNumber: row.surahNumber, ayahNumber: row.ayahNumber,
    surahNameArabic: surahs[row.surahNumber - 1]?.arabicName,
    surahNameEnglish: surahs[row.surahNumber - 1]?.englishName,
    arabicText: row.text, scriptType: 'uthmani', quranTextSource: arabicSource, sourceVersion: arabicVersion,
  })));
  const translations = parseTextExport(readPinned('en.pickthall.txt')).map(row => ({
    verseReferenceKey: row.referenceKey, language: 'en', translator, text: row.text,
    source: translationSource, sourceVersion: translationVersion, license: translationLicense, checksum: sha256Utf8(row.text),
  }));
  const corpus = { surahs, verses, translations };
  const report = validateCorpus(corpus, corpus);
  if (!report.valid) throw new Error(`Source validation failed: ${JSON.stringify(report)}`);
  return corpus;
}

const duplicates = (values: string[]) => values.length - new Set(values).size;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function validateCorpus(actual: Pick<Corpus, 'verses' | 'translations'>, expected: Corpus) {
  const { verses, translations } = actual;
  const expectedRefs = new Set(expected.surahs.flatMap(s => Array.from({ length: s.count }, (_, i) => `${s.number}:${i + 1}`)));
  const refs = new Set(verses.map(v => v.referenceKey));
  const translated = new Set(translations.filter(t => t.language === 'en' && t.translator === translator).map(t => t.verseReferenceKey));
  const expectedArabic = new Map(expected.verses.map(v => [v.referenceKey, v.checksum]));
  const expectedEnglish = new Map(expected.translations.map(t => [t.verseReferenceKey, t.checksum]));
  const metrics = {
    expectedVerses: expectedRefs.size,
    surahs: new Set(verses.map(v => v.surahNumber)).size,
    canonicalVerses: verses.length,
    duplicateReferences: duplicates(verses.map(v => v.referenceKey)),
    duplicatePairs: duplicates(verses.map(v => `${v.surahNumber}:${v.ayahNumber}`)),
    invalidReferences: verses.filter(v => !expectedRefs.has(v.referenceKey) || v.referenceKey !== `${v.surahNumber}:${v.ayahNumber}`).length,
    missingArabic: verses.filter(v => !nonempty(v.arabicText)).length,
    structuralGaps: [...expectedRefs].filter(ref => !refs.has(ref)).length,
    missingChecksums: verses.filter(v => !nonempty(v.checksum)).length,
    arabicChecksumFailures: verses.filter(v => typeof v.arabicText !== 'string' || v.checksum !== sha256Utf8(v.arabicText)).length,
    arabicSourceConflicts: verses.filter(v => expectedArabic.get(v.referenceKey) !== v.checksum).length,
    arabicMetadataFailures: verses.filter(v => v.scriptType !== 'uthmani' || v.quranTextSource !== arabicSource || v.sourceVersion !== arabicVersion || !nonempty(v.surahNameArabic) || !nonempty(v.surahNameEnglish)).length,
    englishTranslations: translations.filter(t => t.language === 'en' && t.translator === translator).length,
    totalTranslations: translations.length,
    missingTranslations: [...expectedRefs].filter(ref => !translated.has(ref)).length,
    orphanTranslations: translations.filter(t => !refs.has(t.verseReferenceKey)).length,
    invalidTranslationReferences: translations.filter(t => !expectedRefs.has(t.verseReferenceKey)).length,
    duplicateTranslations: duplicates(translations.map(t => [t.verseReferenceKey, t.language, t.translator, t.sourceVersion].join('|'))),
    duplicateEnglishReferences: duplicates(translations.filter(t => t.language === 'en' && t.translator === translator).map(t => t.verseReferenceKey)),
    emptyTranslations: translations.filter(t => !nonempty(t.text)).length,
    translationChecksumFailures: translations.filter(t => typeof t.text !== 'string' || t.checksum !== sha256Utf8(t.text)).length,
    translationSourceConflicts: translations.filter(t => expectedEnglish.get(t.verseReferenceKey) !== t.checksum).length,
    translationMetadataFailures: translations.filter(t => t.language !== 'en' || t.translator !== translator || t.source !== translationSource || t.sourceVersion !== translationVersion || t.license !== translationLicense).length,
  };
  const countKeys = new Set(['expectedVerses', 'surahs', 'canonicalVerses', 'englishTranslations', 'totalTranslations']);
  const valid = metrics.surahs === 114 && metrics.canonicalVerses === expectedRefs.size && metrics.totalTranslations === expectedRefs.size && metrics.englishTranslations === expectedRefs.size && Object.entries(metrics).every(([k, n]) => countKeys.has(k) || n === 0) && validateCanonicalVerseBatch(verses).valid;
  return { valid, ...metrics,
    arabicCorpusChecksum: corpusChecksum(verses.map(v => ({ referenceKey: v.referenceKey, text: v.arabicText }))),
    translationCorpusChecksum: corpusChecksum(translations.map(t => ({ referenceKey: t.verseReferenceKey, text: t.text }))),
  };
}

export function validateMappings(snapshot: Snapshot) {
  const refs = new Set(snapshot.verses.map(v => v.referenceKey));
  const emotions = new Set(snapshot.emotions.map(e => e.key));
  const mappings = snapshot.emotionversemappings;
  const perEmotion = Object.fromEntries(snapshot.emotions.map(e => [e.key, mappings.filter(m => m.emotionKey === e.key).length]));
  const statuses = Object.fromEntries([...new Set(mappings.map(m => m.status))].map(s => [s, mappings.filter(m => m.status === s).length]));
  const invalidMappings = mappings.filter(m => !refs.has(m.verseReferenceKey) || !emotions.has(m.emotionKey) || !['development', 'draft', 'reviewed', 'approved', 'rejected'].includes(m.status) || ['arabicText', 'englishTranslation', 'text', 'translationText'].some(k => k in m)).length;
  const duplicateMappings = duplicates(mappings.map(m => `${m.verseReferenceKey}|${m.emotionKey}`));
  return { valid: invalidMappings === 0 && duplicateMappings === 0, total: mappings.length, activeEmotions: snapshot.emotions.filter(e => e.active).length, invalidMappings, duplicateMappings, perEmotion, statuses };
}

export function compareExisting(snapshot: Snapshot, corpus: Corpus) {
  const incoming = new Map(corpus.verses.map(v => [v.referenceKey, v]));
  const english = new Map(corpus.translations.map(t => [t.verseReferenceKey, t]));
  const verses = snapshot.verses.map(v => {
    const next = incoming.get(v.referenceKey);
    return { referenceKey: v.referenceKey, textMatches: v.arabicText === next?.arabicText, checksumValid: v.checksum === sha256Utf8(v.arabicText), existingChecksum: v.checksum, incomingChecksum: next?.checksum, existingScript: v.scriptType, incomingScript: next?.scriptType, existingSource: v.quranTextSource, incomingSource: next?.quranTextSource, existingVersion: v.sourceVersion, incomingVersion: next?.sourceVersion };
  });
  const translations = snapshot.versetranslations.map(t => ({ referenceKey: t.verseReferenceKey, textMatches: t.text === english.get(t.verseReferenceKey)?.text, checksumValid: t.checksum === sha256Utf8(t.text), existingChecksum: t.checksum, incomingChecksum: english.get(t.verseReferenceKey)?.checksum, translator: t.translator }));
  return { safe: verses.every(v => v.textMatches && v.checksumValid) && translations.every(t => t.textMatches && t.checksumValid && t.translator === translator), verses, translations };
}
