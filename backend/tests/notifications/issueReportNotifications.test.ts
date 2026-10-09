import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMITED_MESSAGE } from '../../src/middleware/rateLimits';
import { ResendEmailProvider, type EmailProvider, type FetchLike } from '../../src/notifications/emailProvider';
import {
  CLAIM_LEASE_MS,
  IssueReportNotificationError,
  IssueReportNotifier,
  NOTIFICATION_MAX_ATTEMPTS,
  RETRY_DELAYS_MS,
  notificationIdempotencyKey,
} from '../../src/notifications/issueReportNotifier';
import { notificationStatusReport } from '../../src/scripts/issueReportNotificationStatus';
import type { IssueReportNotificationStore } from '../../src/services/IssueReportNotificationStore';
import { buildAccountTestApp } from '../account/testApp';
import { FakeEmailProvider, InMemoryOutbox, testClock } from './fakes';

const TO = 'quranheals.support@gmail.com';
const FROM = 'Quran Heals <reports@example.test>';
const report = { category: 'translation_issue', comment: 'The translation of this ayah seems cut off.', verseKey: '2:255', appVersion: '1.0.0', platform: 'ios' };
const HOUR = 3_600_000;

function setup(options: { script?: ConstructorParameters<typeof FakeEmailProvider>[0]; delayMs?: number; failCreate?: boolean; rateLimit?: number } = {}) {
  const clock = testClock();
  const outbox = new InMemoryOutbox({ now: clock.now, failCreate: options.failCreate });
  const provider = new FakeEmailProvider(options.script, options.delayMs);
  const failures: Error[] = [];
  const logs: string[] = [];
  const makeNotifier = (store: IssueReportNotificationStore = outbox, p: EmailProvider = provider) =>
    new IssueReportNotifier({ store, provider: p, from: FROM, to: TO, now: clock.now, log: (line) => logs.push(line), reportFailure: (e) => failures.push(e) });
  const notifier = makeNotifier();
  const nudge = vi.fn();
  const { app } = buildAccountTestApp({
    issueReportRepository: outbox,
    onIssueReportSaved: nudge,
    ...(options.rateLimit ? { rateLimits: { issueReports: { windowMs: 60_000, limit: options.rateLimit } } } : {}),
  });
  return { app, clock, outbox, provider, notifier, makeNotifier, nudge, failures, logs };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('submitting a report', () => {
  it('saves a valid report and queues exactly one pending notification job with it', async () => {
    const { app, outbox, nudge, provider } = setup();

    const res = await request(app).post('/api/issues').send(report);

    expect(res.status).toBe(201);
    const saved = outbox.only();
    expect(saved).toMatchObject({ category: 'translation_issue', verseKey: '2:255' });
    expect(saved.notification).toMatchObject({ state: 'pending', attempts: 0 });
    expect(nudge).toHaveBeenCalledTimes(1);
    // The request never waits on, or sends, email itself.
    expect(provider.sent).toHaveLength(0);
  });

  it('keeps the existing response exactly: 201 { success: true, data: null }', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/issues').send(report);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it('rejects an invalid report with the existing 400 and queues no notification', async () => {
    const { app, outbox, nudge } = setup();

    const res = await request(app).post('/api/issues').send({ ...report, category: 'not-a-category' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Invalid issue report.' });
    expect(outbox.reports.size).toBe(0);
    expect(nudge).not.toHaveBeenCalled();
  });

  it('a MongoDB save failure returns the existing safe 500, and no job exists and no email can be sent', async () => {
    const { app, outbox, nudge, notifier, provider } = setup({ failCreate: true });

    const res = await request(app).post('/api/issues').send(report);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: 'Something went wrong.' });
    expect(nudge).not.toHaveBeenCalled();
    expect(outbox.reports.size).toBe(0);
    await notifier.processDue();
    expect(provider.sent).toHaveLength(0);
  });

  it('a throwing save hook (or an unreachable provider) never turns a saved report into a failed submission', async () => {
    const outbox = new InMemoryOutbox();
    const { app } = buildAccountTestApp({
      issueReportRepository: outbox,
      onIssueReportSaved: () => {
        throw new Error('notifier exploded');
      },
    });

    const res = await request(app).post('/api/issues').send(report);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: null });
    expect(outbox.only().notification?.state).toBe('pending');
  });

  it('keeps the existing per-IP report rate limit: extra reports get 429 and queue nothing', async () => {
    const { app, outbox, nudge } = setup({ rateLimit: 2 });
    for (let i = 0; i < 2; i++) await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.9').send(report).expect(201);

    const limited = await request(app).post('/api/issues').set('X-Forwarded-For', '203.0.113.9').send(report);

    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ success: false, message: RATE_LIMITED_MESSAGE });
    expect(outbox.reports.size).toBe(2);
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it('exposes no endpoint for sending email or choosing a recipient', async () => {
    const { app, notifier, outbox, provider } = setup();
    for (const path of ['/api/issues/notify', '/api/issues/email', '/api/notifications', '/api/email']) {
      expect((await request(app).post(path).send({ to: 'attacker@example.com', text: 'hi' })).status).toBe(404);
    }
    // A `to`/`from`/`subject` in a report body is stripped by validation and never reaches the email.
    await request(app).post('/api/issues').send({ ...report, to: 'attacker@example.com', from: 'x@example.com', subject: 'Injected' }).expect(201);
    expect(Object.keys(outbox.only())).not.toContain('to');
    await notifier.processDue();
    expect(provider.sent[0].to).toBe(TO);
    expect(provider.sent[0].from).toBe(FROM);
    expect(provider.sent[0].subject).toBe(`Quran Heals — New Issue Report [${outbox.only().id}]`);
  });
});

describe('delivery', () => {
  it('provider success: sends one email to the configured recipient and records the job as accepted (not as delivered)', async () => {
    const { app, outbox, notifier, provider, clock } = setup();
    await request(app).post('/api/issues').send(report);

    const run = await notifier.processDue();

    expect(run).toMatchObject({ accepted: 1, retryScheduled: 0, failed: 0 });
    const saved = outbox.only();
    expect(provider.sent).toEqual([expect.objectContaining({ to: TO, from: FROM, idempotencyKey: notificationIdempotencyKey(saved.id) })]);
    expect(provider.sent[0].text).toContain(`Report ID: ${saved.id}`);
    expect(saved.notification).toMatchObject({ state: 'accepted', attempts: 1, acceptedAt: clock.now() });
    expect(saved.notification?.nextAttemptAt).toBeUndefined();
  });

  it('temporary failure: schedules a retry after the backoff, keeps the report, and does not resend early', async () => {
    const { app, outbox, notifier, provider, clock } = setup({ script: [{ ok: false, retryable: true, code: 'http_503' }] });
    await request(app).post('/api/issues').send(report);

    const run = await notifier.processDue();

    expect(run).toMatchObject({ accepted: 0, retryScheduled: 1, failed: 0 });
    const n = outbox.only().notification!;
    expect(n).toMatchObject({ state: 'pending', attempts: 1, lastError: 'http_503' });
    expect(n.nextAttemptAt).toEqual(new Date(clock.now().getTime() + RETRY_DELAYS_MS[0]));

    clock.advance(RETRY_DELAYS_MS[0] - 1);
    await notifier.processDue();
    expect(provider.sent).toHaveLength(1);
  });

  it('retry after a temporary failure succeeds, with the same idempotency key on every attempt', async () => {
    const { app, outbox, notifier, provider, clock } = setup({ script: [{ ok: false, retryable: true, code: 'timeout' }] });
    await request(app).post('/api/issues').send(report);
    await notifier.processDue();

    clock.advance(RETRY_DELAYS_MS[0]);
    const run = await notifier.processDue();

    expect(run.accepted).toBe(1);
    expect(provider.sent).toHaveLength(2);
    expect(new Set(provider.sent.map((e) => e.idempotencyKey)).size).toBe(1);
    expect(outbox.only().notification).toMatchObject({ state: 'accepted', attempts: 2 });
    expect(outbox.only().notification?.lastError).toBeUndefined();
  });

  it('permanent failure: recorded as failed with an error code, reported to monitoring without content, report kept', async () => {
    const { app, outbox, notifier, provider, clock, failures, logs } = setup({ script: [{ ok: false, retryable: false, code: 'http_422' }] });
    await request(app).post('/api/issues').send(report);

    const run = await notifier.processDue();
    clock.advance(24 * HOUR);
    await notifier.processDue();

    expect(run.failed).toBe(1);
    expect(provider.sent).toHaveLength(1);
    const saved = outbox.only();
    expect(saved.comment).toBe(report.comment);
    expect(saved.notification).toMatchObject({ state: 'failed', attempts: 1, lastError: 'http_422' });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(IssueReportNotificationError);
    expect(failures[0].message).toBe('Issue-report email notification failed permanently (http_422).');
    expect(logs.join('\n')).not.toContain(report.comment);
  });

  it('retries are bounded: after NOTIFICATION_MAX_ATTEMPTS temporary failures the job fails, all within the 24-hour idempotency window', async () => {
    const script = Array.from({ length: 20 }, () => ({ ok: false as const, retryable: true, code: 'http_503' }));
    const { app, outbox, notifier, provider, clock, failures } = setup({ script });
    await request(app).post('/api/issues').send(report);
    const start = clock.now().getTime();

    for (let i = 0; i < 20; i++) {
      await notifier.processDue();
      clock.advance(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    }

    expect(provider.sent).toHaveLength(NOTIFICATION_MAX_ATTEMPTS);
    expect(outbox.only().notification).toMatchObject({ state: 'failed', attempts: NOTIFICATION_MAX_ATTEMPTS, lastError: 'http_503' });
    expect(failures).toHaveLength(1);
    expect(start).toBeLessThan(clock.now().getTime());
    const worstCase = RETRY_DELAYS_MS.reduce((sum, d) => sum + d, 0) + NOTIFICATION_MAX_ATTEMPTS * CLAIM_LEASE_MS;
    expect(worstCase).toBeLessThan(24 * HOUR);
    expect(RETRY_DELAYS_MS).toHaveLength(NOTIFICATION_MAX_ATTEMPTS - 1);
  });

  it('one report produces one job and one email, however many times the worker runs', async () => {
    const { app, outbox, notifier, provider } = setup();
    await request(app).post('/api/issues').send(report);

    await notifier.processDue();
    await notifier.processDue();
    await notifier.processDue();

    expect(provider.sent).toHaveLength(1);
    expect(outbox.claims).toBe(1);
  });

  it('two concurrent workers (e.g. old and new instance during a deploy) never send the same report twice', async () => {
    const { app, outbox, makeNotifier } = setup();
    for (let i = 0; i < 6; i++) await request(app).post('/api/issues').send({ ...report, comment: `report ${i}` });
    const providerA = new FakeEmailProvider([], 5);
    const providerB = new FakeEmailProvider([], 5);
    const a = makeNotifier(outbox, providerA);
    const b = makeNotifier(outbox, providerB);

    await Promise.all([a.processDue(), b.processDue(), a.processDue(), b.processDue()]);

    const keys = [...providerA.sent, ...providerB.sent].map((e) => e.idempotencyKey);
    expect(keys).toHaveLength(6);
    expect(new Set(keys).size).toBe(6);
    expect(providerA.sent.length).toBeGreaterThan(0);
    expect(providerB.sent.length).toBeGreaterThan(0);
    expect([...outbox.reports.values()].every((r) => r.notification?.state === 'accepted')).toBe(true);
  });

  it('overlapping runs in one process are serialized, and a nudge during a run triggers one more pass', async () => {
    const { app, outbox, notifier, provider } = setup({ delayMs: 5 });
    await request(app).post('/api/issues').send(report);
    const first = notifier.processDue();
    // Saved while the first run is in flight (no await between these calls).
    void outbox.create({ category: 'other', comment: 'second' });
    const second = notifier.processDue();

    expect(second).toBe(first);
    await first;
    expect(provider.sent).toHaveLength(2);
  });

  it('restart: pending jobs saved before a restart are delivered by the next process when it starts', async () => {
    const { app, outbox, makeNotifier } = setup();
    for (let i = 0; i < 3; i++) await request(app).post('/api/issues').send(report);
    // No notifier ran before the "restart". A new process builds a fresh one over the same database.
    const providerAfterRestart = new FakeEmailProvider();
    const restarted = makeNotifier(outbox, providerAfterRestart);

    restarted.start();
    await vi.waitFor(() => expect(providerAfterRestart.sent).toHaveLength(3));
    await restarted.stop();

    expect([...outbox.reports.values()].every((r) => r.notification?.state === 'accepted')).toBe(true);
  });

  it('restart mid-send: a job claimed by a process that died is re-claimed only after its lease expires, and the dead claim can no longer write', async () => {
    const { app, outbox, makeNotifier, clock } = setup();
    await request(app).post('/api/issues').send(report);
    // The old process claimed the job, then died before recording an outcome.
    const deadClaim = (await outbox.claimNext(clock.now(), CLAIM_LEASE_MS))!;
    const provider = new FakeEmailProvider();
    const restarted = makeNotifier(outbox, provider);

    await restarted.processDue();
    expect(provider.sent).toHaveLength(0);

    clock.advance(CLAIM_LEASE_MS);
    await restarted.processDue();

    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].idempotencyKey).toBe(notificationIdempotencyKey(deadClaim.report.id));
    expect(outbox.only().notification).toMatchObject({ state: 'accepted', attempts: 2 });
    expect(await outbox.markFailed(deadClaim.report.id, deadClaim.claimToken, clock.now(), 'stale')).toBe(false);
    expect(outbox.only().notification?.state).toBe('accepted');
  });

  it('an interrupted final attempt is not followed by a ninth one: the job fails as max_attempts', async () => {
    const { app, outbox, notifier, provider, clock } = setup();
    await request(app).post('/api/issues').send(report);
    const n = outbox.only().notification!;
    n.state = 'sending';
    n.attempts = NOTIFICATION_MAX_ATTEMPTS;
    n.nextAttemptAt = clock.now();

    await notifier.processDue();

    expect(provider.sent).toHaveLength(0);
    expect(outbox.only().notification).toMatchObject({ state: 'failed', lastError: 'max_attempts' });
  });

  it('a database outage during a run is logged and retried on the next poll; nothing throws', async () => {
    const { makeNotifier, provider, logs } = setup();
    const broken: IssueReportNotificationStore = {
      claimNext: async () => {
        throw new Error('MongoNetworkError: connection refused');
      },
      markAccepted: async () => false,
      scheduleRetry: async () => false,
      markFailed: async () => false,
      status: async () => ({ counts: { pending: 0, sending: 0, accepted: 0, failed: 0 }, oldestActiveDueAt: null, failed: [] }),
    };

    await expect(makeNotifier(broken).processDue()).resolves.toMatchObject({ accepted: 0 });
    expect(provider.sent).toHaveLength(0);
    expect(logs.some((line) => line.includes('could not read the outbox'))).toBe(true);
  });

  it('a report deleted (e.g. by the retention purge or a deletion request) before delivery is never emailed', async () => {
    const { app, outbox, notifier, provider } = setup();
    await request(app).post('/api/issues').send(report);
    outbox.reports.clear();

    await notifier.processDue();

    expect(provider.sent).toHaveLength(0);
  });

  it('reports saved while email is off get no job, and are never emailed later', async () => {
    const outbox = new InMemoryOutbox({ queueNotification: false });
    const { app } = buildAccountTestApp({ issueReportRepository: outbox });
    const res = await request(app).post('/api/issues').send(report);
    expect(res.body).toEqual({ success: true, data: null });
    expect(outbox.only().notification).toBeUndefined();

    const provider = new FakeEmailProvider();
    await new IssueReportNotifier({ store: outbox, provider, from: FROM, to: TO, log: () => undefined }).processDue();
    expect(provider.sent).toHaveLength(0);
  });
});

describe('retries through the Resend client (fake fetch, no network)', () => {
  type Call = { url: string; headers: Record<string, string>; body: string };
  function resendWith(responses: { status: number; body?: unknown }[]) {
    const calls: Call[] = [];
    const queue = [...responses];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      const next = queue.shift() ?? { status: 200, body: { id: 'final-id' } };
      return { status: next.status, json: async () => next.body };
    };
    return { provider: new ResendEmailProvider('re_test', fetchImpl), calls };
  }
  const fullReport = { ...report, email: 'reporter@example.com', emotionKey: 'sad', appLocale: 'ar', translationDisplayMode: 'always', surahNumber: 2, ayahNumber: 255 };

  it('every retry sends a byte-identical request — same idempotency key, same body — and records the accepted id', async () => {
    const { app, outbox, makeNotifier, clock } = setup();
    await request(app).post('/api/issues').send(fullReport);
    const { provider, calls } = resendWith([
      { status: 503, body: { name: 'service_unavailable' } },
      { status: 409, body: { name: 'concurrent_idempotent_requests' } },
      { status: 429, body: { name: 'rate_limit_exceeded' } },
      { status: 200, body: { id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' } },
    ]);
    const notifier = makeNotifier(outbox, provider);

    for (let i = 0; i < 4; i++) {
      await notifier.processDue();
      clock.advance(RETRY_DELAYS_MS[i] ?? 0);
    }

    expect(calls).toHaveLength(4);
    for (const call of calls.slice(1)) {
      expect(call.headers).toEqual(calls[0].headers);
      expect(call.body).toBe(calls[0].body);
    }
    expect(calls[0].headers['Idempotency-Key']).toBe(notificationIdempotencyKey(outbox.only().id));
    expect(outbox.only().notification).toMatchObject({ state: 'accepted', attempts: 4, providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
  });

  it('a retry after a backend restart (new process, re-claimed after the lease) is byte-identical too', async () => {
    const { app, outbox, makeNotifier, clock } = setup();
    await request(app).post('/api/issues').send(fullReport);
    const before = resendWith([{ status: 500, body: { name: 'application_error' } }]);
    await makeNotifier(outbox, before.provider).processDue();
    // "Restart": a second attempt claimed and abandoned mid-send, then a fresh process.
    clock.advance(RETRY_DELAYS_MS[0]);
    await outbox.claimNext(clock.now(), CLAIM_LEASE_MS);
    clock.advance(CLAIM_LEASE_MS);
    clock.advance(24 * 60_000);
    const after = resendWith([]);

    await makeNotifier(outbox, after.provider).processDue();

    expect(after.calls).toHaveLength(1);
    expect(after.calls[0].body).toBe(before.calls[0].body);
    expect(after.calls[0].headers).toEqual(before.calls[0].headers);
    expect(outbox.only().notification).toMatchObject({ state: 'accepted', attempts: 3 });
  });

  it('a payload-conflict 409 (invalid_idempotent_request) fails at once and is not retried', async () => {
    const { app, outbox, makeNotifier, clock, failures } = setup();
    await request(app).post('/api/issues').send(report);
    const { provider, calls } = resendWith([{ status: 409, body: { name: 'invalid_idempotent_request' } }]);
    const notifier = makeNotifier(outbox, provider);

    await notifier.processDue();
    clock.advance(24 * HOUR);
    await notifier.processDue();

    expect(calls).toHaveLength(1);
    expect(outbox.only().notification).toMatchObject({ state: 'failed', attempts: 1, lastError: 'http_409:invalid_idempotent_request' });
    expect(failures[0].message).toBe('Issue-report email notification failed permanently (http_409:invalid_idempotent_request).');
  });

  it('a concurrent-request 409 is retried (bounded like any temporary failure)', async () => {
    const { app, outbox, makeNotifier } = setup();
    await request(app).post('/api/issues').send(report);
    const { provider } = resendWith([{ status: 409, body: { name: 'concurrent_idempotent_requests' } }]);

    await makeNotifier(outbox, provider).processDue();

    expect(outbox.only().notification).toMatchObject({ state: 'pending', attempts: 1, lastError: 'http_409:concurrent_idempotent_requests' });
  });

  it('resend.dev testing sender + a recipient that is not the Resend account email: 403, failed once, report kept, no retry', async () => {
    const { app, outbox, makeNotifier, clock, failures } = setup();
    await request(app).post('/api/issues').send(report);
    const { provider, calls } = resendWith([{ status: 403, body: { name: 'validation_error', message: 'You can only send testing emails to your own email address (owner@example.com).' } }]);
    const notifier = makeNotifier(outbox, provider);

    const run = await notifier.processDue();
    clock.advance(24 * HOUR);
    await notifier.processDue();

    expect(run.failed).toBe(1);
    expect(calls).toHaveLength(1);
    expect(outbox.only()).toMatchObject({ comment: report.comment, notification: { state: 'failed', lastError: 'http_403:validation_error' } });
    expect(JSON.stringify(outbox.only().notification)).not.toContain('owner@example.com');
    expect(failures).toHaveLength(1);
  });

  it('logs "accepted", never "delivered", and says acceptance is not inbox delivery', async () => {
    const { app, outbox, makeNotifier, logs } = setup();
    await request(app).post('/api/issues').send(report);
    const { provider } = resendWith([{ status: 200, body: { id: 'abc-123' } }]);

    await makeNotifier(outbox, provider).processDue();

    const line = logs.find((l) => l.includes('accepted by resend'))!;
    expect(line).toContain('id=abc-123');
    expect(line).toContain('not proof of inbox delivery');
    expect(logs.join('\n')).not.toMatch(/delivered/i);
  });
});

describe('observability', () => {
  it('the status report shows pending, retry-scheduled, accepted and failed jobs by id and error code only', async () => {
    const { app, outbox, notifier, clock } = setup({
      script: [
        { ok: true },
        { ok: false, retryable: true, code: 'http_429' },
        { ok: false, retryable: false, code: 'http_403' },
      ],
    });
    for (let i = 0; i < 3; i++) {
      await request(app).post('/api/issues').send({ ...report, email: 'reporter@example.com', comment: `secret description ${i}` });
      clock.advance(1);
    }
    await notifier.processDue();
    await request(app).post('/api/issues').send(report);

    const status = await notificationStatusReport(outbox, clock.now());

    expect(status).toMatchObject({ pending: 2, sending: 0, accepted: 1, failed: 1 });
    expect(status.failedReports).toEqual([expect.objectContaining({ lastError: 'http_403' })]);
    const printed = JSON.stringify(status);
    expect(printed).not.toContain('secret description');
    expect(printed).not.toContain('reporter@example.com');
  });

  it('worker log lines carry report ids and error codes, never descriptions or contact emails', async () => {
    const { app, notifier, logs } = setup({ script: [{ ok: false, retryable: true, code: 'http_500' }] });
    await request(app).post('/api/issues').send({ ...report, email: 'reporter@example.com', comment: 'very private wording' });
    await notifier.processDue();

    const text = logs.join('\n');
    expect(text).toMatch(/attempt 1\/8 failed \(http_500\) report=\w+; retry at /);
    expect(text).not.toContain('very private wording');
    expect(text).not.toContain('reporter@example.com');
  });
});
