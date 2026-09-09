import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../app';
import { env } from '../config/env';
import { readSnapshot } from './fullQuran';

async function main() {
  if (!env.MONGODB_URI || env.NODE_ENV === 'production') throw new Error('Development database required.');
  await mongoose.connect(env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const before = await readSnapshot();
  const app = createApp();
  const checks: Record<string, unknown> = {};
  const health = await request(app).get('/api/health').expect(200);
  assert.equal(health.body.data.status, 'ok');
  checks.health = 'pass';
  const emotions = await request(app).get('/api/emotions').expect(200);
  assert.equal(emotions.body.data.length, 12);
  checks.emotions = '12 active';
  const dtoKeys = ['id', 'verseKey', 'referenceKey', 'surahNumber', 'surahNameArabic', 'surahNameEnglish', 'ayahNumber', 'arabicText', 'englishTranslation', 'emotions', 'quranTextSource', 'translationSource'].sort();
  for (const emotion of before.emotions) {
    const response = await request(app).get('/api/ayahs/random').query({ emotion: emotion.key }).expect(200);
    const ayah = response.body.data;
    assert.deepEqual(Object.keys(ayah).sort(), dtoKeys);
    const allowed = before.emotionversemappings.filter(m => m.emotionKey === emotion.key && ['development', 'reviewed', 'approved'].includes(m.status)).map(m => m.verseReferenceKey);
    assert.ok(allowed.includes(ayah.referenceKey));
    const verse = before.verses.find(v => v.referenceKey === ayah.referenceKey);
    assert.equal(ayah.arabicText, verse?.arabicText);
    assert.equal(ayah.id, String((verse as unknown as { _id: unknown })._id));
    const byId = await request(app).get(`/api/ayahs/${ayah.id}`).expect(200);
    assert.deepEqual(byId.body.data, ayah);
    const excluded = await request(app).get('/api/ayahs/random').query({ emotion: emotion.key, exclude: ayah.id }).expect(200);
    assert.ok(allowed.includes(excluded.body.data.referenceKey));
    if (allowed.length > 1) assert.notEqual(excluded.body.data.id, ayah.id);
    else assert.equal(excluded.body.data.id, ayah.id);
    checks[emotion.key] = { mappedVerse: 'pass', foundationId: 'pass', dto: 'pass', byId: 'pass', exclude: allowed.length > 1 ? 'non-repeat passed' : 'single-verse fallback passed' };
  }
  const after = await readSnapshot();
  assert.deepEqual(after, before);
  checks.databaseUnchanged = true;
  checks.indexes = {};
  for (const name of ['verses', 'versetranslations', 'emotionversemappings']) {
    (checks.indexes as Record<string, unknown>)[name] = await mongoose.connection.db!.collection(name).indexes();
  }
  writeFileSync('reports/phase3-api-regression.json', JSON.stringify(checks, null, 2) + '\n');
  console.log(JSON.stringify(checks, null, 2));
}

main().catch(() => { console.error('Runtime regression failed; connection details suppressed.'); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); });
