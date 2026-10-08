import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import type { AppEnvironment } from '../../src/config/databaseTarget';
import { EMOTION_CATALOG } from '../../src/emotions/emotionCatalog';
import { AyahModel } from '../../src/models/Ayah';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { VerseModel } from '../../src/models/Verse';
import { MongooseQuranRepository, userVisibleMappingStatuses } from '../../src/services/MongooseQuranRepository';
import type { EmotionMappingStatus } from '../../src/types/domain';

/**
 * D6: production serves editorially APPROVED mappings only; development/test
 * keep previewing `development`/`reviewed` work. `draft`/`rejected` never
 * appear anywhere. The model mocks below apply the repository's own
 * `$match`/filter (emotion, status, exclusions), so these tests exercise the
 * real selection queries rather than assuming them.
 */

type Row = { verseReferenceKey: string; emotionKey: string; status: EmotionMappingStatus; _id: Types.ObjectId };
const row = (verseReferenceKey: string, emotionKey: string, status: EmotionMappingStatus): Row => ({ verseReferenceKey, emotionKey, status, _id: new Types.ObjectId() });

const rows: Row[] = [
  row('94:6', 'sad', 'approved'),
  row('2:286', 'sad', 'approved'),
  row('13:28', 'sad', 'development'),
  row('3:139', 'sad', 'reviewed'),
  row('12:86', 'sad', 'draft'),
  row('39:53', 'sad', 'rejected'),
  row('2:153', 'tired', 'development'), // an emotion whose only mapping is unapproved
  row('94:6', 'hopeless', 'reviewed'),
  // Unexpected database state: an approved mapping whose verse cannot be
  // resolved from the verified corpus (not a real ayah).
  row('114:99', 'confused', 'approved'),
];

type Filter = { emotionKey?: string; verseReferenceKey?: string | { $nin: string[] }; status?: { $in: EmotionMappingStatus[] } };
function matches(candidate: Row, filter: Filter) {
  if (filter.emotionKey !== undefined && candidate.emotionKey !== filter.emotionKey) return false;
  if (typeof filter.verseReferenceKey === 'string' && candidate.verseReferenceKey !== filter.verseReferenceKey) return false;
  if (typeof filter.verseReferenceKey === 'object' && filter.verseReferenceKey.$nin.includes(candidate.verseReferenceKey)) return false;
  if (filter.status && !filter.status.$in.includes(candidate.status)) return false;
  return true;
}

const lean = (value: unknown) => ({ lean: async () => value }) as never;

beforeEach(() => {
  vi.spyOn(EmotionModel, 'findOne').mockImplementation(((filter: { key: string }) =>
    lean({ key: filter.key, name: filter.key, arabicName: filter.key, description: '', icon: 'heart', order: 1, active: true, _id: new Types.ObjectId() })) as never);
  vi.spyOn(VerseModel, 'findOne').mockReturnValue(lean(null));
  vi.spyOn(EmotionVerseMappingModel, 'find').mockImplementation(((filter: Filter) => lean(rows.filter((candidate) => matches(candidate, filter)))) as never);
  vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockImplementation((async (pipeline: { $match: Filter }[]) => {
    const pool = rows.filter((candidate) => matches(candidate, pipeline[0].$match));
    return pool.length ? [pool[Math.floor(Math.random() * pool.length)]] : [];
  }) as never);
  vi.spyOn(AyahModel, 'aggregate').mockResolvedValue([]);
  vi.spyOn(AyahModel, 'findOne').mockReturnValue(lean(null));
});
afterEach(() => vi.restoreAllMocks());

const appFor = (nodeEnv: AppEnvironment) => createApp({ repository: new MongooseQuranRepository({ nodeEnv }), databaseHealthCheck: async () => true });
const servedFor = async (nodeEnv: AppEnvironment, emotion: string, draws = 40) => {
  const served = new Set<string>();
  for (let i = 0; i < draws; i++) {
    const response = await request(appFor(nodeEnv)).get(`/api/ayahs/random?emotion=${emotion}`);
    if (response.status === 200) served.add(response.body.data.verseKey);
  }
  return served;
};

describe('userVisibleMappingStatuses', () => {
  it('is approved-only in production', () => {
    expect(userVisibleMappingStatuses('production')).toEqual(['approved']);
  });

  it.each(['development', 'test'] as const)('keeps the editorial preview statuses in %s', (nodeEnv) => {
    expect([...userVisibleMappingStatuses(nodeEnv)].sort()).toEqual(['approved', 'development', 'reviewed']);
  });

  it.each(['production', 'development', 'test'] as const)('never includes draft or rejected (%s)', (nodeEnv) => {
    expect(userVisibleMappingStatuses(nodeEnv)).not.toContain('draft');
    expect(userVisibleMappingStatuses(nodeEnv)).not.toContain('rejected');
  });
});

describe('random ayah by emotion', () => {
  it('production serves only approved mappings', async () => {
    expect([...(await servedFor('production', 'sad'))].sort()).toEqual(['2:286', '94:6']);
  });

  it('development still previews development/reviewed mappings, never draft/rejected', async () => {
    const served = await servedFor('development', 'sad', 80);
    expect(served).toEqual(new Set(['94:6', '2:286', '13:28', '3:139']));
  });

  it('production returns 404 for an emotion with no approved mapping instead of falling back to anything else', async () => {
    await request(appFor('production')).get('/api/ayahs/random?emotion=tired').expect(404);
    expect(AyahModel.aggregate).not.toHaveBeenCalled();
    await request(appFor('development')).get('/api/ayahs/random?emotion=tired').expect(200);
  });

  it('a mapping whose verse cannot be resolved yields a clean 404, never a legacy fallback or a server error (D11)', async () => {
    const response = await request(appFor('production')).get('/api/ayahs/random?emotion=confused').expect(404);
    expect(response.body).toEqual({ success: false, message: 'No ayahs found for this emotion yet.' });
    expect(AyahModel.aggregate).not.toHaveBeenCalled();
    expect(AyahModel.findOne).not.toHaveBeenCalled();
  });

  it('the exclusion-exhausted fallback stays inside the approved set in production', async () => {
    for (let i = 0; i < 20; i++) {
      const response = await request(appFor('production')).get('/api/ayahs/random?emotion=sad&exclude=94:6,2:286').expect(200);
      expect(['94:6', '2:286']).toContain(response.body.data.verseKey);
    }
  });

  it('every mapping query in production filters on approved only', async () => {
    await request(appFor('production')).get('/api/ayahs/random?emotion=sad&exclude=94:6,2:286').expect(200);
    for (const [pipeline] of vi.mocked(EmotionVerseMappingModel.aggregate).mock.calls as unknown as [{ $match: Filter }[]][]) {
      expect(pipeline[0].$match.status).toEqual({ $in: ['approved'] });
    }
    for (const [filter] of vi.mocked(EmotionVerseMappingModel.find).mock.calls as unknown as [Filter][]) {
      expect(filter.status).toEqual({ $in: ['approved'] });
    }
  });
});

describe('ayah by id', () => {
  it('lists only approved emotions in production, the preview set in development', async () => {
    const prod = await request(appFor('production')).get('/api/ayahs/94:6').expect(200);
    expect(prod.body.data.emotions).toEqual(['sad']);
    const dev = await request(appFor('development')).get('/api/ayahs/94:6').expect(200);
    expect(dev.body.data.emotions.sort()).toEqual(['hopeless', 'sad']);
  });
});

describe('approved coverage of the catalog', () => {
  const current = JSON.parse(
    readFileSync(resolve(__dirname, '../../data/emotion-candidates/consolidated/approved-mappings-current.json'), 'utf8'),
  ) as { totalPairs: number; emotionCount: number; countByEmotion: Record<string, number> };

  it('every catalog emotion has approved mappings, so approved-only production leaves none empty', () => {
    expect(current.emotionCount).toBe(30);
    expect(current.totalPairs).toBe(2013);
    for (const emotion of EMOTION_CATALOG) {
      expect(current.countByEmotion[emotion.key], emotion.key).toBeGreaterThan(0);
    }
    expect(Object.keys(current.countByEmotion).sort()).toEqual(EMOTION_CATALOG.map((emotion) => emotion.key).sort());
  });
});
