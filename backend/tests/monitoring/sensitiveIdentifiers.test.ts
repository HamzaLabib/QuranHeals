import * as Sentry from '@sentry/node';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../src/middleware/errorHandler';
import { IssueReportModel } from '../../src/models/IssueReport';
import { UserFavoriteModel } from '../../src/models/UserFavorite';
import { safeStackFrames, summarizeDatabaseError } from '../../src/monitoring/errorSanitizer';
import { beforeSendSafely, describeError, flushMonitoring, initMonitoring, reportError, scrubEvent, scrubString, scrubValue } from '../../src/monitoring/monitoring';

/**
 * Regression tests for identifiers leaking into Sentry through error
 * MESSAGES (not request data): MongoDB duplicate-key errors carry the key's
 * values, Mongoose CastErrors the value that failed to cast, validator
 * errors the rejected input. Every value below is synthetic.
 */

const FAKE_DSN = 'https://publickey@o0.ingest.example.invalid/1';

const GOOGLE_SUBJECT = '109876543210987654321';
const APPLE_SUBJECT = '001234.0a1b2c3d4e5f60718293a4b5c6d7e8f9.0912';
const USER_ID = '64b7f0c2a1b2c3d4e5f60718';
const EMAIL = 'synthetic.person@example.invalid';
// Short enough that Mongoose's maxlength message includes it in full (it truncates at 30 characters).
const COMMENT = 'privnote-zq7-synthetic';
const IDENTIFIERS = [GOOGLE_SUBJECT, APPLE_SUBJECT, USER_ID, EMAIL, COMMENT];

function duplicateKeyError(provider: 'google' | 'apple', subject: string) {
  return new mongoose.mongo.MongoServerError({
    errmsg: `E11000 duplicate key error collection: quranheals_prod.users index: provider_1_providerSubject_1 dup key: { provider: "${provider}", providerSubject: "${subject}" }`,
    code: 11000,
    codeName: 'DuplicateKey',
    keyPattern: { provider: 1, providerSubject: 1 },
    keyValue: { provider, providerSubject: subject },
  });
}

function emailDuplicateKeyError() {
  return new mongoose.mongo.MongoServerError({
    errmsg: `E11000 duplicate key error collection: quranheals_dev.users index: email_1 dup key: { email: "${EMAIL}" }`,
    code: 11000,
    keyPattern: { email: 1 },
    keyValue: { email: EMAIL },
  });
}

/** A real Mongoose CastError for a user id that is not an ObjectId-shaped value. */
function castError() {
  return new mongoose.Error.CastError('ObjectId', `${USER_ID}-not-an-objectid`, 'userId');
}

/** A real ValidationError from a model: a cast failure plus an over-long comment (both values appear in Mongoose's messages). */
function validationError() {
  const doc = new IssueReportModel({ category: 'other', comment: `${COMMENT} ${'x'.repeat(2000)}`, surahNumber: `${USER_ID}-x` });
  return doc.validateSync()!;
}

function memoryTransport() {
  const events: Sentry.Event[] = [];
  const transport: NonNullable<Sentry.NodeOptions['transport']> = (options) =>
    Sentry.createTransport(options, async ({ body }) => {
      const lines = (typeof body === 'string' ? body : new TextDecoder().decode(body)).split('\n');
      for (let i = 1; i < lines.length - 1; i += 2) {
        if (JSON.parse(lines[i]).type === 'event') events.push(JSON.parse(lines[i + 1]));
      }
      return { statusCode: 200 };
    });
  return { events, transport };
}

async function sent(error: unknown): Promise<Sentry.Event> {
  const { events, transport } = memoryTransport();
  initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
  reportError(error, { method: 'POST', route: '/api/auth/google' });
  await flushMonitoring(2000);
  expect(events).toHaveLength(1);
  return events[0];
}

/**
 * Sentry's ContextLines integration attaches the SOURCE lines around each
 * stack frame. Here those frames include this test file, whose source
 * literally contains the synthetic values; in production it is static app
 * code, never runtime data. Assertions on sent events therefore exclude it.
 */
function withoutSourceContext(value: unknown): string {
  return JSON.stringify(value, (key, entry) => (key === 'pre_context' || key === 'context_line' || key === 'post_context' ? undefined : entry));
}

function expectNoIdentifiers(text: string) {
  for (const value of IDENTIFIERS) expect(text, value).not.toContain(value);
  expect(text).not.toContain('privaterelay');
}

afterEach(async () => {
  await Sentry.close(500);
  vi.restoreAllMocks();
});

describe('the synthetic errors really carry the identifiers (so the tests are meaningful)', () => {
  it('duplicate-key, cast and validation messages contain the raw values', () => {
    expect(duplicateKeyError('google', GOOGLE_SUBJECT).message).toContain(GOOGLE_SUBJECT);
    expect(castError().message).toContain(USER_ID);
    expect(validationError().message).toContain(COMMENT);
  });
});

describe('events sent to Sentry', () => {
  it('a MongoDB duplicate-key error on the user index: no provider subject (Google or Apple); type, code, index and field names kept', async () => {
    for (const [provider, subject] of [['google', GOOGLE_SUBJECT], ['apple', APPLE_SUBJECT]] as const) {
      const event = await sent(duplicateKeyError(provider, subject));
      expectNoIdentifiers(withoutSourceContext(event));
      const [exception] = event.exception!.values!;
      expect(exception.type).toBe('MongoServerError');
      expect(exception.value).toBe('duplicate key (code 11000) in quranheals_prod.users on index provider_1_providerSubject_1 fields: provider, providerSubject; key values removed');
      expect(event.tags).toMatchObject({ 'http.method': 'POST', 'http.route': '/api/auth/google' });
      await Sentry.close(500);
    }
  });

  it('a duplicate key on an email index: no email', async () => {
    const event = await sent(emailDuplicateKeyError());
    expectNoIdentifiers(withoutSourceContext(event));
    expect(event.exception!.values![0].value).toContain('on index email_1');
  });

  it('a Mongoose CastError: no user id; kind and path kept', async () => {
    const event = await sent(castError());
    expectNoIdentifiers(withoutSourceContext(event));
    expect(event.exception!.values![0]).toMatchObject({ type: 'CastError', value: 'Cast to ObjectId failed at path "userId"; value removed' });
  });

  it('a Mongoose ValidationError: no rejected values or comment text; model, paths and kinds kept', async () => {
    const event = await sent(validationError());
    expectNoIdentifiers(withoutSourceContext(event));
    const value = event.exception!.values![0].value!;
    expect(value).toMatch(/^IssueReport validation failed at /);
    expect(value).toContain('comment (maxlength)');
    expect(value).toContain('surahNumber (Number)');
  });

  it('a database error wrapped as the cause of another error: every entry in the chain is sanitized', async () => {
    const wrapped = new Error('Favorite sync failed', { cause: duplicateKeyError('google', GOOGLE_SUBJECT) });
    const event = await sent(wrapped);
    expectNoIdentifiers(withoutSourceContext(event));
    const values = event.exception!.values!;
    expect(values.map((v) => v.type)).toEqual(expect.arrayContaining(['Error', 'MongoServerError']));
    expect(values.find((v) => v.type === 'Error')!.value).toBe('Favorite sync failed');
  });

  it('a non-database error whose message embeds a token payload: identifiers redacted, the readable part kept', async () => {
    const message = `Token used too late, 1789000000 > 1788999000: {"iss":"accounts.google.com","sub":"${GOOGLE_SUBJECT}","email":"${EMAIL}","aud":"client"} userId=${USER_ID} subject ${APPLE_SUBJECT}`;
    const event = await sent(new Error(message));
    expectNoIdentifiers(withoutSourceContext(event));
    expect(event.exception!.values![0].value).toMatch(/^Token used too late, 1789000000 > 1788999000: \{"iss":"accounts\.google\.com","sub":\[redacted\]/);
  });

  it('ordinary diagnostic errors are left readable', async () => {
    const event = await sent(new TypeError('Cannot read properties of undefined (reading \'verseKey\')'));
    expect(event.exception!.values![0]).toMatchObject({ type: 'TypeError', value: 'Cannot read properties of undefined (reading \'verseKey\')' });
  });

  it('network-type MongoDB errors keep their category and fixed identifiers only', () => {
    const error = Object.assign(new Error(`connect ECONNREFUSED cluster0.example.invalid user ${EMAIL}`), { name: 'MongoNetworkError' });
    expect(summarizeDatabaseError(error)).toBe('MongoDB network failure (MongoNetworkError); details removed');
  });
});

describe('scrubEvent without the original error (text-only fallback)', () => {
  it('database exception entries are rebuilt from fixed identifiers parsed out of the text', () => {
    const event = scrubEvent({
      exception: {
        values: [
          { type: 'MongoServerError', value: duplicateKeyError('google', GOOGLE_SUBJECT).message },
          { type: 'CastError', value: castError().message },
          { type: 'ValidationError', value: validationError().message },
          { type: 'DocumentNotFoundError', value: `No document found for query "{ _id: '${USER_ID}' }" on model "User"` },
        ],
      },
    });
    expectNoIdentifiers(withoutSourceContext(event));
    expect(event.exception!.values!.map((v) => v.value)).toEqual([
      'duplicate key in quranheals_prod.users on index provider_1_providerSubject_1; key values removed',
      'Cast to ObjectId failed at path "userId"; value removed',
      'IssueReport validation failed; values removed',
      'details removed',
    ]);
  });

  it('structured metadata: identifier keys are filtered, harmless keys kept', () => {
    const scrubbed = scrubValue({ userId: USER_ID, sub: GOOGLE_SUBJECT, providerSubject: APPLE_SUBJECT, keyValue: { email: EMAIL }, subscription: 'free', runtime: { name: 'node' } });
    expect(scrubbed).toEqual({ userId: '[Filtered]', sub: '[Filtered]', providerSubject: '[Filtered]', keyValue: '[Filtered]', subscription: 'free', runtime: { name: 'node' } });
  });

  it('logentry, mechanism data, contexts, tags and request paths are scrubbed', () => {
    const event = scrubEvent({
      logentry: { message: `failed for ${EMAIL}`, params: [USER_ID] },
      request: { method: 'GET', url: `/api/ayahs/${USER_ID}?token=x` },
      contexts: { db: { note: `dup key: { providerSubject: "${GOOGLE_SUBJECT}" }`, userId: USER_ID } },
      tags: { 'http.route': '/api/ayahs/:id' },
      exception: { values: [{ type: 'Error', value: 'x', mechanism: { type: 'generic', handled: true, data: { userId: USER_ID, detail: `user ${USER_ID}` } } }] },
    });
    expectNoIdentifiers(withoutSourceContext(event));
    expect(event.request).toEqual({ method: 'GET', url: '/api/ayahs/[id]' });
    expect(event.tags).toEqual({ 'http.route': '/api/ayahs/:id' });
  });

  it('fails closed: if scrubbing throws, the event is dropped instead of sent', () => {
    const hostile = { get exception(): never { throw new Error(`boom ${USER_ID}`); } } as unknown as Sentry.Event;
    expect(beforeSendSafely(hostile)).toBeNull();
  });
});

describe('text patterns (defense in depth for non-database messages)', () => {
  it.each([
    ['duplicate-key block', `x dup key: { email: "${EMAIL}" } y`, 'x dup key: { [redacted] } y'],
    ['cast value', `Cast to ObjectId failed for value "${USER_ID}-x" (type string)`, 'Cast to ObjectId failed for value [redacted] (type string)'],
    ['JSON payload keys', `{"sub":"${GOOGLE_SUBJECT}","email_verified":true}`, '{"sub":[redacted],"email_verified":true}'],
    ['key=value', `providerSubject=${GOOGLE_SUBJECT}; ok`, 'providerSubject=[redacted]; ok'],
    ['Apple subject', `subject was ${APPLE_SUBJECT}.`, 'subject was [subject].'],
    ['long number', `sub ${GOOGLE_SUBJECT} end`, 'sub [number] end'],
    ['ObjectId', `user ${USER_ID} missing`, 'user [id] missing'],
  ])('%s', (_name, input, expected) => {
    expect(scrubString(input)).toBe(expected);
  });

  it('keeps 13-digit timestamps, short numbers and ordinary words such as "subscription"', () => {
    expect(scrubString('at 1789000000000 retried 3 times; subscription active')).toBe('at 1789000000000 retried 3 times; subscription active');
  });
});

describe('logs never carry the identifiers either', () => {
  it('describeError uses the same safe summaries', () => {
    expect(describeError(duplicateKeyError('apple', APPLE_SUBJECT))).toBe('MongoServerError: duplicate key (code 11000) in quranheals_prod.users on index provider_1_providerSubject_1 fields: provider, providerSubject; key values removed');
    expect(describeError(castError())).toBe('CastError: Cast to ObjectId failed at path "userId"; value removed');
    expectNoIdentifiers(describeError(validationError()));
  });

  it('the request error handler reports a duplicate-key error without identifiers', async () => {
    const { events, transport } = memoryTransport();
    initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
    const app = express();
    app.post('/api/auth/google', () => { throw duplicateKeyError('google', GOOGLE_SUBJECT); });
    app.use(errorHandler);
    const response = await request(app).post('/api/auth/google');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).toBe('{"success":false,"message":"Something went wrong."}');
    await flushMonitoring(2000);
    expect(events).toHaveLength(1);
    expectNoIdentifiers(withoutSourceContext(events));
  });

  it('what the error handler writes to the server log (describeError + frames) carries no identifiers', () => {
    // errorHandler skips console output under NODE_ENV=test, so its two logged parts are checked directly.
    const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../src/middleware/errorHandler.ts'), 'utf8') as string;
    expect(source).toContain("console.error('Unhandled request error:', describeError(error), safeStackFrames(error));");
    for (const error of [duplicateKeyError('google', GOOGLE_SUBJECT), castError(), validationError(), emailDuplicateKeyError()]) {
      expectNoIdentifiers(`${describeError(error)}\n${safeStackFrames(error)}`);
    }
  });

  it('stack output is frames only, even when a message spans several lines', () => {
    const error = new Error(`first line\nsecond line with ${EMAIL}\nthird ${USER_ID}`);
    const frames = safeStackFrames(error);
    expect(frames).toMatch(/^\s+at /);
    expectNoIdentifiers(frames);
  });

  it('sanitization itself never writes to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    scrubEvent({ exception: { values: [{ type: 'MongoServerError', value: duplicateKeyError('google', GOOGLE_SUBJECT).message }] } }, { originalException: duplicateKeyError('google', GOOGLE_SUBJECT) });
    beforeSendSafely({ get exception(): never { throw new Error('x'); } } as unknown as Sentry.Event);
    describeError(castError());
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('a real cast failure on a user-scoped model keeps the model name and drops the value', () => {
    const error = new UserFavoriteModel({ userId: 'u', verseKey: '2:255', deleted: { nested: USER_ID } }).validateSync()!;
    expect(error.message).toContain(USER_ID);
    const summary = summarizeDatabaseError(error)!;
    expect(summary).toMatch(/^UserFavorite validation failed at deleted \(Boolean\)/);
    expect(summary).toMatch(/; values removed$/);
    expectNoIdentifiers(summary);
  });
});
