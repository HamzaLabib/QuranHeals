import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import { EmotionModel } from '../../src/models/Emotion';
import { EmotionVerseMappingModel } from '../../src/models/EmotionVerseMapping';
import { VerseModel } from '../../src/models/Verse';
import { MongooseQuranRepository, selectMappingConnection } from '../../src/services/MongooseQuranRepository';
import type { EmotionMappingStatus, MappingConnection } from '../../src/types/domain';

// Placeholder explanation strings for tests only — never real editorial content.
const SAD = { en: 'TEST-EN connection for sad', ar: 'TEST-AR connection for sad' };
const HOPELESS = { en: 'TEST-EN connection for hopeless' };
const LEAKED = { en: 'TEST-EN must never be shown', ar: 'TEST-AR must never be shown' };

function leanResult<TQuery>(value: unknown): TQuery {
  return { lean: async () => value } as TQuery;
}

type Fixture = { verseReferenceKey: string; emotionKey: string; status: EmotionMappingStatus; connection?: MappingConnection; _id: Types.ObjectId };
const mapping = (emotionKey: string, status: EmotionMappingStatus, connection?: MappingConnection): Fixture => ({
  verseReferenceKey: '94:6',
  emotionKey,
  status,
  ...(connection ? { connection } : {}),
  _id: new Types.ObjectId(),
});

const mappings: Fixture[] = [
  mapping('sad', 'approved', SAD),
  mapping('hopeless', 'approved', HOPELESS),
  mapping('anxious', 'approved'),
  mapping('lonely', 'approved', { en: '   ', ar: '' }),
  // User-visible as ayahs, but their (hypothetical) text must never reach the client.
  mapping('tired', 'development', LEAKED),
  mapping('stressed', 'reviewed', LEAKED),
];

beforeEach(() => {
  vi.spyOn(EmotionModel, 'findOne').mockImplementation(((filter: { key: string }) =>
    leanResult({ key: filter.key, name: filter.key, arabicName: filter.key, description: '', icon: 'heart', order: 1, active: true, _id: new Types.ObjectId() })) as never);
  vi.spyOn(VerseModel, 'findOne').mockReturnValue(leanResult(null));
  vi.spyOn(EmotionVerseMappingModel, 'find').mockReturnValue(leanResult(mappings));
  vi.spyOn(EmotionVerseMappingModel, 'aggregate').mockImplementation((async (pipeline: { $match: { emotionKey: string } }[]) =>
    mappings.filter((candidate) => candidate.emotionKey === pipeline[0].$match.emotionKey)) as never);
});
afterEach(() => vi.restoreAllMocks());

const app = () => createApp({ repository: new MongooseQuranRepository(), databaseHealthCheck: async () => true });
const random = async (emotion: string) => (await request(app()).get(`/api/ayahs/random?emotion=${emotion}`).expect(200)).body.data;

describe('"How this ayah connects" comes from the emotion–verse mapping', () => {
  it('12. returns the requested emotion’s own approved connection, tagged with that emotion', async () => {
    const data = await random('sad');
    expect(data.verseKey).toBe('94:6');
    expect(data.connection).toEqual({ emotionKey: 'sad', ...SAD });
  });

  it('15. the same verse carries different text for a different emotion', async () => {
    const data = await random('hopeless');
    expect(data.verseKey).toBe('94:6');
    expect(data.connection).toEqual({ emotionKey: 'hopeless', en: HOPELESS.en });
  });

  it('13. never returns connection text from a development mapping (the ayah itself is still served)', async () => {
    const data = await random('tired');
    expect(data.verseKey).toBe('94:6');
    expect(data).not.toHaveProperty('connection');
    expect(JSON.stringify(data)).not.toContain('must never be shown');
  });

  it('14. never returns connection text from a reviewed-but-unapproved mapping', async () => {
    const data = await random('stressed');
    expect(data.verseKey).toBe('94:6');
    expect(data).not.toHaveProperty('connection');
  });

  it('omits the field when the selected mapping has no (or only blank) text', async () => {
    expect(await random('anxious')).not.toHaveProperty('connection');
    expect(await random('lonely')).not.toHaveProperty('connection');
  });

  it('never attaches a connection to a lookup by verse (no emotion context)', async () => {
    const res = await request(app()).get('/api/ayahs/94:6').expect(200);
    expect(res.body.data).not.toHaveProperty('connection');
  });
});

describe('selectMappingConnection', () => {
  it('selects by emotion, trims, and drops blank locales', () => {
    expect(selectMappingConnection(mappings, 'sad')).toEqual({ emotionKey: 'sad', ...SAD });
    expect(selectMappingConnection([{ emotionKey: 'sad', status: 'approved', connection: { en: '  x  ', ar: ' ' } }], 'sad')).toEqual({ emotionKey: 'sad', en: 'x' });
    expect(selectMappingConnection(mappings, 'anxious')).toBeUndefined();
    expect(selectMappingConnection(mappings, 'unmapped')).toBeUndefined();
    expect(selectMappingConnection(mappings, undefined)).toBeUndefined();
  });

  it.each(['development', 'draft', 'reviewed', 'rejected'] as const)('12–14. ignores text on a %s mapping', (status) => {
    expect(selectMappingConnection([{ emotionKey: 'sad', status, connection: SAD }], 'sad')).toBeUndefined();
  });
});

describe('mapping schema', () => {
  it('accepts an optional { en, ar } connection and keeps existing mappings valid without one', () => {
    const base = { verseReferenceKey: '94:6', emotionKey: 'sad', status: 'approved', mappingVersion: 'v1' };
    expect(new EmotionVerseMappingModel(base).validateSync()?.errors.connection).toBeUndefined();
    const withConnection = new EmotionVerseMappingModel({ ...base, connection: { en: ' text ', ar: 'نص' } });
    expect(withConnection.connection).toMatchObject({ en: 'text', ar: 'نص' });
    const tooLong = new EmotionVerseMappingModel({ ...base, connection: { en: 'x'.repeat(2001) } });
    expect(tooLong.validateSync()?.errors['connection.en']).toBeDefined();
  });
});
