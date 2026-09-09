import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import dotenv from 'dotenv';
import mongoose from 'mongoose';

import { seedAyahs } from '../seed/ayahs';
import { seedEmotions } from '../seed/emotions';
import { buildFoundationSeedData } from '../seed/foundation';

const repoRoot = resolve(__dirname, '../../..');
const databasePath = resolve(repoRoot, 'mobile/assets/quran/quran.sqlite');
const reportPath = resolve(repoRoot, 'docs/quran-runtime-live-audit.json');
const expectedHash = 'c380a5952e5bf946a5f35335f5f3551be7559224e81a7ebd312df195c1b30d5b';
const referencePattern = /^[1-9]\d{0,2}:[1-9]\d{0,2}$/u;

type ReferenceRecord = {
  _id?: unknown;
  referenceKey?: unknown;
  surahNumber?: unknown;
  ayahNumber?: unknown;
};

type MappingRecord = {
  _id?: unknown;
  verseReferenceKey?: unknown;
  emotionKey?: unknown;
  status?: unknown;
};

function hashDatabase() {
  return createHash('sha256').update(readFileSync(databasePath)).digest('hex');
}

function numericKey(record: ReferenceRecord) {
  const { surahNumber, ayahNumber } = record;
  return typeof surahNumber === 'number' && Number.isInteger(surahNumber) &&
    surahNumber >= 1 && surahNumber <= 114 && typeof ayahNumber === 'number' &&
    Number.isInteger(ayahNumber) && ayahNumber >= 1 && ayahNumber <= 286
    ? `${surahNumber}:${ayahNumber}`
    : null;
}

function safeReference(value: unknown) {
  return typeof value === 'string' && referencePattern.test(value) ? value : null;
}

function inspectReferences(records: ReferenceRecord[], resolves: (key: unknown) => boolean) {
  const unresolved: { id: string; verseKey: string | null }[] = [];
  const inconsistent: { id: string; numericVerseKey: string | null; referenceKey: string | null }[] = [];
  for (const record of records) {
    const key = numericKey(record);
    const referenceKey = safeReference(record.referenceKey);
    if (!resolves(key)) unresolved.push({ id: String(record._id ?? ''), verseKey: key });
    if (key !== referenceKey || !key) {
      inconsistent.push({ id: String(record._id ?? ''), numericVerseKey: key, referenceKey });
    }
  }
  return { total: records.length, resolvedExactlyOnce: records.length - unresolved.length, unresolved, inconsistent };
}

function inspectMappings(records: MappingRecord[], activeKeys: Set<string>, resolves: (key: unknown) => boolean) {
  const byEmotion: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const uniqueReferences = new Set<string>();
  const unresolved: { id: string; verseKey: string | null }[] = [];
  const unknownOrInactiveEmotions: { id: string; emotionKey: string | null }[] = [];
  for (const record of records) {
    const key = safeReference(record.verseReferenceKey);
    const emotionKey = typeof record.emotionKey === 'string' ? record.emotionKey : null;
    const status = typeof record.status === 'string' ? record.status : 'invalid';
    if (!resolves(key)) unresolved.push({ id: String(record._id ?? ''), verseKey: key });
    if (key) uniqueReferences.add(key);
    if (emotionKey) byEmotion[emotionKey] = (byEmotion[emotionKey] ?? 0) + 1;
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (!emotionKey || !activeKeys.has(emotionKey)) {
      unknownOrInactiveEmotions.push({ id: String(record._id ?? ''), emotionKey });
    }
  }
  return {
    total: records.length,
    distinctVerseReferences: uniqueReferences.size,
    resolvedExactlyOnce: records.length - unresolved.length,
    byEmotion,
    byStatus,
    unresolved,
    unknownOrInactiveEmotions,
  };
}

async function main() {
  const report: Record<string, unknown> = {
    auditVersion: 1,
    checkedAt: new Date().toISOString(),
    mode: 'read-only metadata projections; no model operations, writes or index creation',
    limitations: [
      'This audit reads backend references only; it does not inspect device AsyncStorage favorites/history.',
      'MongoDB Arabic and translations are neither read nor changed by this audit.',
    ],
  };
  let database: DatabaseSync | undefined;
  let phase = 'sqlite-integrity';
  const writeReport = () => {
    mkdirSync(dirname(reportPath), { recursive: true });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    writeFileSync(reportPath, json);
    console.log(json);
  };
  // DNS discovery can outlast the driver's server-selection timeout.
  const deadline = setTimeout(() => {
    report.failure = { phase, message: 'Audit timed out; connection details suppressed.' };
    writeReport();
    process.exit(1);
  }, 20000);
  try {
    const sqliteHash = hashDatabase();
    if (sqliteHash !== expectedHash) throw new Error('SQLite pin mismatch.');
    database = new DatabaseSync(databasePath, { readOnly: true });
    database.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;');
    const rowCount = database.prepare('SELECT count(*) AS count FROM verses').get()!.count;
    if (rowCount !== 6236) throw new Error('SQLite row count mismatch.');
    const lookup = database.prepare('SELECT count(*) AS count FROM verses WHERE verse_key = ?');
    const resolves = (key: unknown) => typeof key === 'string' && referencePattern.test(key) &&
      lookup.get(key)!.count === 1;
    report.sqlite = { path: 'mobile/assets/quran/quran.sqlite', sha256: sqliteHash, rows: rowCount };

    const seed = buildFoundationSeedData(seedAyahs);
    const seededActiveKeys = new Set(seedEmotions.filter((emotion) => emotion.active).map((emotion) => emotion.key));
    report.seeded = {
      verses: inspectReferences(seed.verses, resolves),
      legacyAyahs: inspectReferences(seedAyahs, resolves),
      activeEmotions: seededActiveKeys.size,
      mappings: inspectMappings(seed.mappings, seededActiveKeys, resolves),
    };

    phase = 'development-environment';
    dotenv.config({ path: resolve(repoRoot, 'backend/.env'), quiet: true });
    const uri = process.env.MONGODB_URI;
    if (!uri || process.env.NODE_ENV === 'production') throw new Error('Development database required.');

    phase = 'mongodb-read';
    await mongoose.connect(uri, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
    });
    const mongo = mongoose.connection.db!;
    const verseProjection = { _id: 1, referenceKey: 1, surahNumber: 1, ayahNumber: 1 };
    const [verses, legacyAyahs, mappings, emotions] = await Promise.all([
      mongo.collection<ReferenceRecord>('verses').find({}, { projection: verseProjection }).toArray(),
      mongo.collection<ReferenceRecord>('ayahs').find({}, { projection: verseProjection }).toArray(),
      mongo.collection<MappingRecord>('emotionversemappings').find({}, {
        projection: { _id: 1, verseReferenceKey: 1, emotionKey: 1, status: 1 },
      }).toArray(),
      mongo.collection<{ key: string; active: boolean }>('emotions').find({}, {
        projection: { _id: 0, key: 1, active: 1 },
      }).toArray(),
    ]);
    const activeKeys = new Set(emotions.filter((emotion) => emotion.active).map((emotion) => emotion.key));
    report.live = {
      status: 'complete',
      collections: { verses: verses.length, ayahs: legacyAyahs.length, emotionversemappings: mappings.length, emotions: emotions.length },
      activeEmotions: activeKeys.size,
      activeEmotionKeys: [...activeKeys].sort(),
      verses: inspectReferences(verses, resolves),
      legacyAyahs: inspectReferences(legacyAyahs, resolves),
      mappings: inspectMappings(mappings, activeKeys, resolves),
    };
    phase = 'sqlite-integrity-after-read';
    if (hashDatabase() !== expectedHash) throw new Error('SQLite pin changed.');
    report.sqliteUnchanged = true;
  } catch {
    // Driver errors may contain hosts or credentials, so never serialize them.
    report.failure = { phase, message: 'Audit could not complete this phase; connection details suppressed.' };
    process.exitCode = 1;
  } finally {
    database?.close();
    await mongoose.disconnect();
    clearTimeout(deadline);
    writeReport();
  }
}

void main();
