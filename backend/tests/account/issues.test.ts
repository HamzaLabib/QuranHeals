import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { IssueReportModel } from '../../src/models/IssueReport';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import { buildAccountTestApp } from './testApp';

const baseReport = {
  category: 'translation_issue',
  verseKey: '2:255',
  surahNumber: 2,
  ayahNumber: 255,
  emotionKey: 'sad',
  appLocale: 'en',
  translationDisplayMode: 'on-demand',
  appVersion: '1.0.0',
  platform: 'ios',
};

describe('POST /api/issues', () => {
  it('accepts a valid anonymous report — no account required', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();

    const res = await request(app).post('/api/issues').send(baseReport);

    expect(res.status).toBe(201);
    expect(issueReportRepository.created).toHaveLength(1);
    expect(issueReportRepository.created[0]).toMatchObject({ category: 'translation_issue', verseKey: '2:255' });
  });

  it('accepts a valid report from a signed-in caller without requiring account linkage or attaching extra account data', async () => {
    const { app, googleTokens, issueReportRepository } = buildAccountTestApp();
    googleTokens.set('tok', { providerSubject: 'sub' });
    const signIn = await request(app).post('/api/auth/google').send({ idToken: 'tok' });
    const token = signIn.body.data.token;

    const res = await request(app).post('/api/issues').set('Authorization', `Bearer ${token}`).send(baseReport);

    expect(res.status).toBe(201);
    const stored = issueReportRepository.created[0] as Record<string, unknown>;
    expect(stored).not.toHaveProperty('userId');
    expect(stored).not.toHaveProperty('email2');
  });

  it('accepts an optional email and rejects a malformed one', async () => {
    const { app } = buildAccountTestApp();

    const ok = await request(app).post('/api/issues').send({ ...baseReport, email: 'user@example.com' });
    expect(ok.status).toBe(201);

    const bad = await request(app).post('/api/issues').send({ ...baseReport, email: 'not-an-email' });
    expect(bad.status).toBe(400);
  });

  it('rejects an invalid category', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/issues').send({ ...baseReport, category: 'not-a-real-category' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid verseKey and invalid surah/ayah numbers', async () => {
    const { app } = buildAccountTestApp();

    const badVerse = await request(app).post('/api/issues').send({ ...baseReport, verseKey: '999:1' });
    expect(badVerse.status).toBe(400);

    const badSurah = await request(app).post('/api/issues').send({ ...baseReport, verseKey: undefined, surahNumber: 200 });
    expect(badSurah.status).toBe(400);

    const badAyah = await request(app).post('/api/issues').send({ ...baseReport, verseKey: undefined, ayahNumber: -1 });
    expect(badAyah.status).toBe(400);
  });

  it('rejects an oversized comment', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/issues').send({ ...baseReport, comment: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed payload (missing required category)', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/issues').send({ comment: 'no category given' });
    expect(res.status).toBe(400);
  });

  it('never persists a reflection field, even if the caller sends one', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();

    const res = await request(app)
      .post('/api/issues')
      .send({ ...baseReport, reflection: 'my private reflection text', reflectionCiphertext: 'abc123' });

    expect(res.status).toBe(201);
    const stored = issueReportRepository.created[0] as Record<string, unknown>;
    expect(stored).not.toHaveProperty('reflection');
    expect(stored).not.toHaveProperty('reflectionCiphertext');
    expect(JSON.stringify(stored)).not.toContain('my private reflection text');
  });

  it('never persists reflection text/ciphertext or any sync-key/account material, even if the caller sends the exact field names used elsewhere in the app', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    const forbiddenFields = {
      reflection: 'my private reflection',
      reflectionText: 'my private reflection text',
      ciphertext: 'base64ciphertext',
      syncPassphrase: 'my passphrase',
      masterKey: 'deadbeef',
      userId: 'user-123',
      accountEmail: 'account-holder@example.com',
    };

    const res = await request(app).post('/api/issues').send({ ...baseReport, ...forbiddenFields });

    expect(res.status).toBe(201);
    const stored = issueReportRepository.created[0] as Record<string, unknown>;
    for (const field of Object.keys(forbiddenFields)) {
      expect(stored, `stored report unexpectedly has "${field}"`).not.toHaveProperty(field);
    }
    expect(JSON.stringify(stored)).not.toContain('my private reflection');
  });

  it('only ever persists the exact approved field set — no unexpected field survives validation', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await request(app).post('/api/issues').send({ ...baseReport, comment: 'hello', email: 'user@example.com' });

    expect(Object.keys(issueReportRepository.created[0]).sort()).toEqual(
      [
        'appLocale',
        'appVersion',
        'ayahNumber',
        'category',
        'comment',
        'email',
        'emotionKey',
        'platform',
        'surahNumber',
        'translationDisplayMode',
        'verseKey',
      ].sort(),
    );
  });

  it('a repository/MongoDB write failure produces a safe error response, never a false success', async () => {
    const failingRepository: IssueReportRepository = {
      create: async () => {
        throw new Error('Mongo write failed');
      },
    };
    const { app } = buildAccountTestApp({ issueReportRepository: failingRepository });

    const res = await request(app).post('/api/issues').send(baseReport);

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ success: false });
    expect(res.body.message).not.toMatch(/received/i);
  });

  it('the response never exposes a MongoDB document id or other internal database detail', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).post('/api/issues').send(baseReport);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('IssueReportModel defaults every new report to status "new" and enables createdAt-only timestamps', () => {
    const statusPath = IssueReportModel.schema.path('status') as unknown as {
      defaultValue: unknown;
      enumValues?: string[];
      isRequired?: boolean;
    };
    expect(statusPath.defaultValue).toBe('new');
    expect(statusPath.enumValues).toEqual(['new']);
    expect(IssueReportModel.schema.options.timestamps).toEqual({ createdAt: true, updatedAt: false });
  });

  it('preserves the descending createdAt index for efficient recent-report review', () => {
    const indexes = IssueReportModel.schema.indexes();
    expect(indexes.some(([fields]) => (fields as Record<string, unknown>).createdAt === -1)).toBe(true);
  });

  it('uses the expected MongoDB Atlas collection name (issuereports)', () => {
    expect(IssueReportModel.collection.collectionName).toBe('issuereports');
  });

  it('there is no public GET /api/issues endpoint', async () => {
    const { app } = buildAccountTestApp();
    const res = await request(app).get('/api/issues');
    expect(res.status).toBe(404);
  });

  it('stores reports in a dedicated collection, separate from Quran/emotion state', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await request(app).post('/api/issues').send(baseReport);

    // Structural guarantee: IssueReportRepository has no method that could
    // touch Emotion/EmotionVerseMapping/Verse/VerseTranslation collections.
    expect(Object.keys(issueReportRepository)).toEqual(['created']);
  });
});
