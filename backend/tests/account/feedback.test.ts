import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { RATE_LIMITED_MESSAGE } from '../../src/middleware/rateLimits';
import { IssueReportModel } from '../../src/models/IssueReport';
import { FEEDBACK_EMAIL_SUBJECT, ISSUE_REPORT_EMAIL_SUBJECT, buildIssueReportEmail } from '../../src/notifications/issueReportEmail';
import { IssueReportNotifier } from '../../src/notifications/issueReportNotifier';
import { CLAIM_PROJECTION } from '../../src/services/MongooseIssueReportNotificationStore';
import { REPORT_MESSAGE_MAX_LENGTH } from '../../src/validators/issueValidators';
import { FakeEmailProvider, InMemoryOutbox, testClock } from '../notifications/fakes';
import { buildAccountTestApp } from './testApp';

/**
 * Home feedback and contextual issue reports: one reporting system
 * (POST /api/issues), two submission types. 'feedback' needs a message and
 * carries no category or ayah; 'issue' keeps the original shape, so older
 * app versions are accepted exactly as before.
 */

const feedback = { type: 'feedback', comment: 'I love the new Mushaf reader.', source: 'home', appLocale: 'ar', appVersion: '1.0.0', platform: 'android' };
const ayahIssue = {
  type: 'issue', source: 'ayah', category: 'translation_issue', comment: 'The translation stops mid-sentence.',
  verseKey: '2:255', surahNumber: 2, ayahNumber: 255, translationDisplayMode: 'on-demand',
  appLocale: 'en', appVersion: '1.0.0', platform: 'ios',
};
const post = (app: Parameters<typeof request>[0], body: unknown, ip = '203.0.113.9') => request(app).post('/api/issues').set('X-Forwarded-For', ip).send(body as object);

describe('feedback submissions', () => {
  it('a guest`s feedback is accepted (201, the existing response) and stored as feedback with only its own fields', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    const res = await post(app, { ...feedback, email: 'Reader@Example.com' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: null });
    expect(issueReportRepository.created).toEqual([{
      type: 'feedback', comment: 'I love the new Mushaf reader.', source: 'home', email: 'reader@example.com', appLocale: 'ar', appVersion: '1.0.0', platform: 'android',
    }]);
  });

  it('a signed-in caller`s feedback carries no account data: no session is read, nothing extra is stored', async () => {
    const { app, googleTokens, issueReportRepository } = buildAccountTestApp();
    googleTokens.set('tok', { providerSubject: 'sub', email: 'holder@example.com' });
    const signIn = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: 'tok' });
    const res = await request(app).post('/api/issues').set('Authorization', `Bearer ${signIn.body.data.token}`).send(feedback);
    expect(res.status).toBe(201);
    expect(JSON.stringify(issueReportRepository.created[0])).not.toMatch(/holder@example\.com|userId|sub/);
  });

  it('drops a category, ayah context and private data sent with feedback', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await post(app, {
      ...feedback, category: 'other', verseKey: '1:1', surahNumber: 1, ayahNumber: 1, emotionKey: 'sad', translationId: 'en.pickthall.gutenberg16955',
      reflection: 'private reflection', khatmas: [{ id: 'k' }], emotionHistory: ['sad'], userId: 'u1', readingProgress: { page: 250 },
    }).expect(201);
    expect(Object.keys(issueReportRepository.created[0]).sort()).toEqual(['appLocale', 'appVersion', 'comment', 'platform', 'source', 'type']);
  });

  it('requires a message: missing, empty, whitespace-only or control-character-only feedback is refused', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    for (const comment of [undefined, '', '   \n\t ', '\u0000\u0007\u001b']) {
      expect((await post(app, { ...feedback, comment })).status, JSON.stringify(comment)).toBe(400);
    }
    expect(issueReportRepository.created).toEqual([]);
  });

  it('bounds the message at 2,000 characters (after trimming)', async () => {
    const { app } = buildAccountTestApp();
    expect(REPORT_MESSAGE_MAX_LENGTH).toBe(2000);
    expect((await post(app, { ...feedback, comment: `  ${'ا'.repeat(2000)}  ` })).status).toBe(201);
    expect((await post(app, { ...feedback, comment: 'x'.repeat(2001) })).status).toBe(400);
  });

  it('normalizes formatting: line breaks kept (CRLF → LF), control characters removed', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await post(app, { ...feedback, comment: 'Line one\r\nLine two\u0000\u0008 end\r' }).expect(201);
    expect(issueReportRepository.created[0]).toMatchObject({ comment: 'Line one\nLine two end' });
  });

  it('the email stays optional and is validated server-side', async () => {
    const { app } = buildAccountTestApp();
    expect((await post(app, { ...feedback })).status).toBe(201);
    for (const email of ['not-an-email', 'a@b', `${'x'.repeat(250)}@example.com`, 'a@example.com\nBcc: x@example.com']) {
      expect((await post(app, { ...feedback, email })).status, email).toBe(400);
    }
  });

  it('refuses an unknown type, a feedback source other than Home, and malformed context', async () => {
    const { app } = buildAccountTestApp();
    for (const body of [
      { ...feedback, type: 'praise' },
      { ...feedback, source: 'ayah' },
      { ...feedback, appLocale: 'fr' },
      { ...feedback, platform: 'windows' },
      { ...feedback, comment: 42 },
    ]) expect((await post(app, body)).status, JSON.stringify(body)).toBe(400);
  });
});

describe('contextual and general issue reports', () => {
  it('an ayah report keeps its surah, ayah, verse reference and source', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await post(app, ayahIssue).expect(201);
    expect(issueReportRepository.created[0]).toEqual(ayahIssue);
  });

  it('a current app`s report (one that names its source) must describe the issue', async () => {
    const { app } = buildAccountTestApp();
    for (const source of ['ayah', 'settings']) {
      expect((await post(app, { ...ayahIssue, source, comment: undefined })).status).toBe(400);
      expect((await post(app, { ...ayahIssue, source, comment: '   ' })).status).toBe(400);
    }
    expect((await post(app, { type: 'issue', source: 'settings', category: 'app_technical_issue', comment: 'The app freezes on launch.' })).status).toBe(201);
  });

  it('older app versions keep working: no type, no source, no description', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    const legacy = { category: 'ayah_not_relevant', verseKey: '2:255', surahNumber: 2, ayahNumber: 255, appLocale: 'ar-EG', translationDisplayMode: 'off' };
    expect((await post(app, legacy)).status).toBe(201);
    expect(issueReportRepository.created[0]).toEqual(legacy);
  });

  it('refuses an issue without a category, an invalid source, and a mismatched source', async () => {
    const { app } = buildAccountTestApp();
    for (const body of [
      { ...ayahIssue, category: undefined },
      { ...ayahIssue, source: 'home' },
      { ...ayahIssue, source: 'mushaf' },
      { ...ayahIssue, verseKey: '115:1' },
    ]) expect((await post(app, body)).status, JSON.stringify(body)).toBe(400);
  });
});

describe('ayah report privacy', () => {
  it('stores only the approved report fields: an emotion key, emotion history, translation id, reflection, reading or account data is dropped', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await post(app, {
      ...ayahIssue, emotionKey: 'anxious', emotionHistory: ['sad', 'anxious'], translationId: 'en.pickthall.gutenberg16955', reflection: 'private', reflectionText: 'private', readingHistory: [1, 2],
      syncPassword: 'secret', khatmas: [{ id: 'k' }], userId: 'u1', accountEmail: 'holder@example.com',
    }).expect(201);
    expect(Object.keys(issueReportRepository.created[0]).sort()).toEqual(
      ['appLocale', 'appVersion', 'ayahNumber', 'category', 'comment', 'platform', 'source', 'surahNumber', 'translationDisplayMode', 'type', 'verseKey'],
    );
  });
});

describe('one shared rate limit for every kind of report', () => {
  it('feedback and issues count against the same per-IP limit, so switching type never bypasses it', async () => {
    const { app, issueReportRepository } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: 60_000, limit: 3 } } });
    await post(app, feedback).expect(201);
    await post(app, ayahIssue).expect(201);
    await post(app, { category: 'other' }).expect(201);
    for (const body of [feedback, ayahIssue, { category: 'other' }]) {
      const res = await post(app, body);
      expect(res.status).toBe(429);
      expect(res.body).toEqual({ success: false, message: RATE_LIMITED_MESSAGE });
    }
    expect(issueReportRepository.created).toHaveLength(3);
    // Another address has its own allowance.
    await post(app, feedback, '198.51.100.20').expect(201);
  });

  it('invalid submissions count too, so malformed requests cannot be used to probe without limit', async () => {
    const { app } = buildAccountTestApp({ rateLimits: { issueReports: { windowMs: 60_000, limit: 2 } } });
    await post(app, { type: 'feedback' }).expect(400);
    await post(app, { type: 'feedback' }).expect(400);
    await post(app, feedback).expect(429);
  });
});

describe('stored documents', () => {
  it('feedback needs no category; an issue still requires one; a report without a type is an issue', () => {
    expect(new IssueReportModel({ type: 'feedback', comment: 'Thanks', status: 'new' }).validateSync()).toBeUndefined();
    expect(new IssueReportModel({ type: 'issue', status: 'new' }).validateSync()?.errors.category).toBeDefined();
    const legacy = new IssueReportModel({ category: 'other', status: 'new' });
    expect(legacy.validateSync()).toBeUndefined();
    expect(legacy.type).toBe('issue');
    expect(new IssueReportModel({ type: 'compliment', comment: 'x', status: 'new' }).validateSync()?.errors.type).toBeDefined();
    expect(new IssueReportModel({ category: 'other', source: 'mushaf', status: 'new' }).validateSync()?.errors.source).toBeDefined();
  });
});

describe('notification emails', () => {
  const at = new Date('2026-10-13T10:00:00.000Z');

  it('feedback has its own subject and heading, and no category or ayah lines', () => {
    const email = buildIssueReportEmail({ id: 'abc123', type: 'feedback', source: 'home', comment: 'Beautiful app.\nThank you.', hasContactEmail: false, appLocale: 'ar', platform: 'android', appVersion: '1.0.0', createdAt: at });
    expect(email.subject).toBe(`${FEEDBACK_EMAIL_SUBJECT} [abc123]`);
    expect(email.subject).toBe('Quran Heals — New Feedback [abc123]');
    expect(email.text.split('\n').slice(0, 9)).toEqual([
      'New feedback received',
      '',
      'Report ID: abc123',
      'Type: Feedback',
      'Sent from: Home',
      'Submitted: 2026-10-13 10:00:00 UTC',
      'Platform: Android',
      'App version: 1.0.0',
      'App language: ar',
    ]);
    expect(email.text).toContain('Feedback:\n> Beautiful app.\n> Thank you.');
    expect(email.text).not.toMatch(/Verse:|Emotion:|Description:|issue report/i);
  });

  it('an ayah issue keeps the issue subject and adds where it came from', () => {
    const email = buildIssueReportEmail({ id: 'def456', type: 'issue', source: 'ayah', category: 'translation_issue', comment: 'Cut off.', hasContactEmail: true, verseKey: '2:255', translationDisplayMode: 'always', createdAt: at });
    expect(email.subject).toBe(`${ISSUE_REPORT_EMAIL_SUBJECT} [def456]`);
    expect(email.text).toMatch(/^New issue report received\n/);
    expect(email.text).toContain('Type: Translation issue\nSent from: Ayah screen\n');
    expect(email.text).toContain('Verse: 2:255');
    expect(email.text).not.toContain('Translation:');
    expect(email.text).toContain('Description:\n> Cut off.');
  });

  it('a stored report without a type is emailed exactly as an issue, as before', () => {
    const email = buildIssueReportEmail({ id: 'old1', category: 'other', hasContactEmail: false, createdAt: at });
    expect(email.subject).toBe('Quran Heals — New Issue Report [old1]');
    expect(email.text).toMatch(/^New issue report received\n/);
    expect(email.text).not.toContain('Sent from:');
  });

  it('feedback goes through the same outbox: saved, queued, and sent to the configured recipient with the feedback subject', async () => {
    const clock = testClock();
    const outbox = new InMemoryOutbox({ now: clock.now });
    const provider = new FakeEmailProvider();
    const { app } = buildAccountTestApp({ issueReportRepository: outbox });
    await post(app, feedback).expect(201);
    const notifier = new IssueReportNotifier({ store: outbox, provider, from: 'Quran Heals <reports@example.test>', to: 'team@example.test', now: clock.now, log: () => {} });
    expect(await notifier.processDue()).toMatchObject({ accepted: 1, failed: 0 });
    expect(provider.sent).toEqual([expect.objectContaining({ to: 'team@example.test', subject: `Quran Heals — New Feedback [${outbox.only().id}]` })]);
    expect(provider.sent[0].text).toContain('> I love the new Mushaf reader.');
  });
});

describe('no emotion key in reports', () => {
  it('an older app`s report that still sends an emotion key is accepted, with the key discarded — even a malformed one', async () => {
    const { app, issueReportRepository } = buildAccountTestApp();
    await post(app, { category: 'ayah_not_relevant', verseKey: '2:255', surahNumber: 2, ayahNumber: 255, emotionKey: 'sad' }).expect(201);
    await post(app, { category: 'other', emotionKey: 'NOT A KEY <script>' }).expect(201);
    for (const stored of issueReportRepository.created) expect(stored).not.toHaveProperty('emotionKey');
    expect(JSON.stringify(issueReportRepository.created)).not.toMatch(/sad|script/);
  });

  it('the stored document has no emotion field, so an emotion key can never be persisted', () => {
    expect(IssueReportModel.schema.path('emotionKey')).toBeUndefined();
    const doc = new IssueReportModel({ category: 'other', emotionKey: 'sad', status: 'new' });
    expect(doc.toObject()).not.toHaveProperty('emotionKey');
  });

  it('the email never shows an emotion, even for a report stored by an earlier version that holds one', () => {
    expect(CLAIM_PROJECTION.split(' ')).not.toContain('emotionKey');
    const legacy = { id: 'old2', category: 'ayah_not_relevant', hasContactEmail: false, verseKey: '2:255', createdAt: new Date('2026-10-01T00:00:00Z'), emotionKey: 'sad' } as Parameters<typeof buildIssueReportEmail>[0];
    const { text } = buildIssueReportEmail(legacy);
    expect(text).not.toMatch(/Emotion|sad/);
    expect(text).toContain('Verse: 2:255');
  });

  it('an end-to-end older-client report reaches the email without its emotion', async () => {
    const clock = testClock();
    const outbox = new InMemoryOutbox({ now: clock.now });
    const provider = new FakeEmailProvider();
    const { app } = buildAccountTestApp({ issueReportRepository: outbox });
    await post(app, { category: 'ayah_not_relevant', comment: 'Not related.', verseKey: '94:5', emotionKey: 'hopeless' }).expect(201);
    await new IssueReportNotifier({ store: outbox, provider, from: 'Quran Heals <reports@example.test>', to: 'team@example.test', now: clock.now, log: () => {} }).processDue();
    expect(provider.sent[0].text).toContain('Verse: 94:5');
    expect(provider.sent[0].text).not.toMatch(/Emotion|hopeless/);
  });
});
