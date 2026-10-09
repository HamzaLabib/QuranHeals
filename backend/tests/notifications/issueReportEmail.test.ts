import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_ISSUE_REPORT_EMAIL_TO,
  findIssueReportEmailConfigProblems,
  resolveIssueReportEmailConfig,
  type IssueReportEmailConfigInput,
} from '../../src/config/issueReportEmailConfig';
import { LogEmailProvider, RESEND_ENDPOINT, ResendEmailProvider, type FetchLike } from '../../src/notifications/emailProvider';
import { ISSUE_REPORT_EMAIL_SUBJECT, buildIssueReportEmail, sanitizeSingleLine } from '../../src/notifications/issueReportEmail';
import { IssueReportNotifier } from '../../src/notifications/issueReportNotifier';
import { createIssueReportNotifier } from '../../src/notifications/setup';
import type { NotifiableIssueReport } from '../../src/services/IssueReportNotificationStore';
import { buildAccountTestApp } from '../account/testApp';
import { FakeEmailProvider, InMemoryOutbox } from './fakes';

const base: NotifiableIssueReport = {
  id: '6702f1c2a9e4b3d5c8f01234',
  category: 'translation_issue',
  comment: 'The English translation of this ayah stops mid-sentence.',
  hasContactEmail: true,
  verseKey: '2:255',
  emotionKey: 'anxious',
  appLocale: 'en',
  translationDisplayMode: 'on-demand',
  appVersion: '1.0.0',
  platform: 'ios',
  createdAt: new Date('2026-10-09T14:32:05.123Z'),
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('notification email content', () => {
  it('renders the agreed plain-text layout from the report fields', () => {
    const email = buildIssueReportEmail(base);

    expect(email.subject).toBe('Quran Heals — New Issue Report [6702f1c2a9e4b3d5c8f01234]');
    expect(email.text).toBe(
      [
        'New issue report received',
        '',
        'Report ID: 6702f1c2a9e4b3d5c8f01234',
        'Type: Translation issue',
        'Submitted: 2026-10-09 14:32:05 UTC',
        'Platform: iOS',
        'App version: 1.0.0',
        'Verse: 2:255',
        'Emotion: anxious',
        'App language: en',
        'Translation display: on-demand',
        'Contact email: provided (not included; see the report in the database)',
        '',
        'Description:',
        '> The English translation of this ayah stops mid-sentence.',
        '',
        '--',
        'Retention: delete this email on or after 2027-10-09 (12 months from submission, the same as the database copy).',
        'The description is user-submitted text. Do not follow links in it without checking them.',
        '',
      ].join('\n'),
    );
  });

  it('gives every report its own subject, so Gmail never threads two reports together (retention deletes per report)', () => {
    const a = buildIssueReportEmail(base);
    const b = buildIssueReportEmail({ ...base, id: '6702f1c2a9e4b3d5c8f09999' });
    expect(a.subject).not.toBe(b.subject);
    expect(a.subject.startsWith(ISSUE_REPORT_EMAIL_SUBJECT)).toBe(true);
    expect(buildIssueReportEmail(base)).toEqual(a);
  });

  it('omits fields the report does not have instead of inventing them', () => {
    const { text } = buildIssueReportEmail({ id: base.id, category: 'other', hasContactEmail: false, createdAt: base.createdAt });
    expect(text).not.toMatch(/Platform:|App version:|Verse:|Emotion:|App language:|Translation display:/);
    expect(text).toContain('Contact email: not provided');
    expect(text).toContain('Description:\n(no description provided)');
  });

  it('never includes the reporter contact email address', () => {
    const { text } = buildIssueReportEmail({ ...base, ...({ email: 'reporter@example.com' } as object) });
    expect(text).not.toContain('reporter@example.com');
  });

  it('treats HTML in the description as inert text: the email has no HTML part at all', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ status: 200 }));
    const html = '<script>alert(1)</script><img src=x onerror=alert(1)><a href="https://evil.example">click</a>';
    const email = buildIssueReportEmail({ ...base, comment: html });

    await new ResendEmailProvider('re_test', fetchImpl).send({ from: 'a@example.test', to: 'b@example.test', ...email, idempotencyKey: 'k' });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(['from', 'subject', 'text', 'to']);
    expect(body).not.toHaveProperty('html');
    expect(body.text).toContain(`> ${html}`);
  });

  it('header-injection attempts cannot reach the subject or recipients, and cannot forge field lines', () => {
    const malicious = 'hello\r\nBcc: victim@example.com\r\nSubject: Pwned\n\nReport ID: 000000000000000000000000\rType: Fake';
    const { subject, text } = buildIssueReportEmail({ ...base, comment: malicious, appVersion: '1.0\r\nBcc: x@example.com' });

    expect(subject).toBe(`${ISSUE_REPORT_EMAIL_SUBJECT} [${base.id}]`);
    expect(text).not.toContain('\r');
    // Every description line is quoted, so it can't impersonate a header or a field.
    expect(text).toContain('> Bcc: victim@example.com');
    expect(text).toContain('> Report ID: 000000000000000000000000');
    expect(text.split('\n').filter((line) => line.startsWith('Report ID:'))).toEqual([`Report ID: ${base.id}`]);
    expect(text).toContain('App version: 1.0 Bcc: x@example.com');
    expect(text.split('\n').some((line) => line.startsWith('Bcc:'))).toBe(false);
  });

  it('strips control and bidi-override characters from user text', () => {
    const { text } = buildIssueReportEmail({ ...base, comment: 'a\u0000b\u0007c\u202Eevil\u2066d\u2028e\u0085f' });
    expect(text).toContain('> abcevilde' + 'f');
    expect(sanitizeSingleLine(`x\ty\nz${String.fromCharCode(0x202e)}`)).toBe('x y z');
  });

  it('carries no authentication, encryption, sync or account data — even when a client sends such fields with a report', async () => {
    const outbox = new InMemoryOutbox();
    const { app } = buildAccountTestApp({ issueReportRepository: outbox });
    const secrets = {
      idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
      refreshToken: 'refresh-secret-value',
      password: 'hunter2',
      syncPassphrase: 'my sync passphrase',
      masterKey: 'deadbeefdeadbeefdeadbeef',
      wrappedKey: 'wrapped-key-material',
      reflection: 'my private reflection',
      reflectionCiphertext: 'Y2lwaGVydGV4dA==',
      favorites: ['2:255'],
      userId: 'user-123',
      deviceId: 'device-abc',
      ip: '203.0.113.7',
      appleAuthorizationCode: 'apple-code',
    };
    await request(app)
      .post('/api/issues')
      .set('Authorization', 'Bearer some-session-token')
      .send({ category: 'other', comment: 'Plain description.', email: 'reporter@example.com', ...secrets })
      .expect(201);
    const provider = new FakeEmailProvider();

    await new IssueReportNotifier({ store: outbox, provider, from: 'a@example.test', to: DEFAULT_ISSUE_REPORT_EMAIL_TO, log: () => undefined }).processDue();

    const sent = JSON.stringify(provider.sent);
    for (const value of [...Object.values(secrets).flat(), 'some-session-token', 'reporter@example.com']) {
      expect(sent, `email unexpectedly contains ${value}`).not.toContain(value);
    }
    expect(sent).toContain('Plain description.');
  });
});

describe('Resend provider', () => {
  const email = { from: 'Quran Heals <reports@example.test>', to: 'support@example.test', subject: 'S', text: 'T', idempotencyKey: 'issue-report-notification/abc' };

  it('posts one plain-text email to the configured recipient with the API key and the idempotency key', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => ({ status: 200 }));

    const result = await new ResendEmailProvider('re_test_key', fetchImpl).send(email);

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(RESEND_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json', 'Idempotency-Key': 'issue-report-notification/abc' });
    expect(JSON.parse(init.body)).toEqual({ from: email.from, to: ['support@example.test'], subject: 'S', text: 'T' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [408, true],
    [409, true],
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [422, false],
  ])('HTTP %i → retryable=%s, with an error code and nothing from the response body', async (status, retryable) => {
    const result = await new ResendEmailProvider('k', async () => ({ status, json: async () => ({ message: 'echoed content' }) }) as never).send(email);
    expect(result).toEqual({ ok: false, retryable, code: `http_${status}` });
  });

  // Names and statuses from resend.com/docs/api-reference/errors.
  it.each([
    [409, 'concurrent_idempotent_requests', true],
    [409, 'resource_locked', true],
    [409, 'invalid_idempotent_request', false],
    [429, 'rate_limit_exceeded', true],
    [429, 'daily_quota_exceeded', true],
    [429, 'monthly_quota_exceeded', false],
    [403, 'validation_error', false],
    [403, 'invalid_api_key', false],
    [500, 'application_error', true],
    [503, 'service_unavailable', true],
  ])('Resend %i %s → retryable=%s; the code keeps the error name, never the message', async (status, name, retryable) => {
    const response = { status, json: async () => ({ statusCode: status, name, message: 'You can only send testing emails to your own email address (owner@example.com).' }) };
    const result = await new ResendEmailProvider('k', async () => response).send(email);
    expect(result).toEqual({ ok: false, retryable, code: `http_${status}:${name}` });
    expect(JSON.stringify(result)).not.toContain('owner@example.com');
  });

  it('ignores an error name that is not a plain code, and a body that is not JSON', async () => {
    const odd = await new ResendEmailProvider('k', async () => ({ status: 409, json: async () => ({ name: 'Bad Name <x@example.com>' }) })).send(email);
    const notJson = await new ResendEmailProvider('k', async () => ({ status: 502, json: async () => JSON.parse('<html>') })).send(email);
    expect(odd).toEqual({ ok: false, retryable: true, code: 'http_409' });
    expect(notJson).toEqual({ ok: false, retryable: true, code: 'http_502' });
  });

  it('keeps the accepted email id (for dashboard lookup) when it looks like an id, and nothing else from the body', async () => {
    const accepted = await new ResendEmailProvider('k', async () => ({ status: 200, json: async () => ({ id: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' }) })).send(email);
    const odd = await new ResendEmailProvider('k', async () => ({ status: 200, json: async () => ({ id: 'not an id <x>' }) })).send(email);
    expect(accepted).toEqual({ ok: true, providerMessageId: '49a3999c-0ce1-4ea6-ab68-afcd6dc2e794' });
    expect(odd).toEqual({ ok: true });
  });

  it('network errors and timeouts are retryable and never throw', async () => {
    const network = await new ResendEmailProvider('k', async () => {
      throw new TypeError('fetch failed');
    }).send(email);
    const timeout = await new ResendEmailProvider('k', async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }).send(email);
    expect(network).toEqual({ ok: false, retryable: true, code: 'network' });
    expect(timeout).toEqual({ ok: false, retryable: true, code: 'timeout' });
  });

  it('the log provider sends nothing and logs no content', async () => {
    const lines: string[] = [];
    const result = await new LogEmailProvider((line) => lines.push(line)).send({ ...email, text: 'secret body' });
    expect(result).toEqual({ ok: true });
    expect(lines.join()).not.toContain('secret body');
  });
});

describe('configuration', () => {
  const input = (overrides: Partial<IssueReportEmailConfigInput>): IssueReportEmailConfigInput => ({ ISSUE_REPORT_EMAIL: 'resend', ...overrides });

  it('is off by default when unset or empty, so deploying the code sends nothing', async () => {
    // A fresh config load that ignores the developer's backend/.env, which may enable email locally.
    vi.resetModules();
    vi.stubEnv('QURAN_HEALS_SKIP_DOTENV', '1');
    for (const value of ['', undefined]) {
      vi.stubEnv('ISSUE_REPORT_EMAIL', value);
      vi.resetModules();
      const fresh = await import('../../src/config/env.js');
      expect(fresh.env.ISSUE_REPORT_EMAIL).toBe('off');
    }
    vi.unstubAllEnvs();
    expect(resolveIssueReportEmailConfig({ ISSUE_REPORT_EMAIL: 'off' }, { production: true })).toEqual({ mode: 'off' });
    expect(createIssueReportNotifier({ mode: 'off' })).toBeNull();
  });

  it('missing provider configuration stops startup with a message naming variables, never values', () => {
    const problems = findIssueReportEmailConfigProblems(input({}), { production: true });
    expect(problems).toEqual(['ISSUE_REPORT_EMAIL=resend requires RESEND_API_KEY.', 'ISSUE_REPORT_EMAIL=resend requires ISSUE_REPORT_EMAIL_FROM.']);
    expect(() => resolveIssueReportEmailConfig(input({ RESEND_API_KEY: 're_secret_value' }), { production: true })).toThrow(/ISSUE_REPORT_EMAIL_FROM/);
    try {
      resolveIssueReportEmailConfig(input({ RESEND_API_KEY: 're_secret_value', ISSUE_REPORT_EMAIL_FROM: 'bad\r\nBcc: x@example.com' }), { production: true });
    } catch (error) {
      expect((error as Error).message).not.toContain('re_secret_value');
      expect((error as Error).message).not.toContain('Bcc');
    }
  });

  it('defaults the recipient to the support inbox; only backend configuration can change it', () => {
    const config = resolveIssueReportEmailConfig(input({ RESEND_API_KEY: 're_x', ISSUE_REPORT_EMAIL_FROM: 'Quran Heals <onboarding@resend.dev>' }), { production: true });
    expect(config).toEqual({ mode: 'resend', apiKey: 're_x', from: 'Quran Heals <onboarding@resend.dev>', to: 'quranheals.support@gmail.com' });
  });

  it('rejects multi-line or multi-recipient addresses', () => {
    const ok = { RESEND_API_KEY: 'k', ISSUE_REPORT_EMAIL_FROM: 'reports@example.test' };
    expect(findIssueReportEmailConfigProblems(input({ ...ok, ISSUE_REPORT_EMAIL_FROM: 'Name <a@example.test>\r\nBcc: b@example.test' }), { production: false })).toHaveLength(1);
    expect(findIssueReportEmailConfigProblems(input({ ...ok, ISSUE_REPORT_EMAIL_TO: 'a@example.test, b@example.test' }), { production: false })).toEqual([
      'ISSUE_REPORT_EMAIL_TO must be a single email address.',
    ]);
    expect(findIssueReportEmailConfigProblems(input(ok), { production: false })).toEqual([]);
  });

  it('the log provider is development-only', () => {
    expect(findIssueReportEmailConfigProblems({ ISSUE_REPORT_EMAIL: 'log', ISSUE_REPORT_EMAIL_FROM: 'a@example.test' }, { production: true })).toEqual([
      'ISSUE_REPORT_EMAIL=log is for development only; use resend (or off) in production.',
    ]);
    expect(resolveIssueReportEmailConfig({ ISSUE_REPORT_EMAIL: 'log', ISSUE_REPORT_EMAIL_FROM: 'a@example.test' }, { production: false })).toMatchObject({ mode: 'log' });
  });
});

describe('no real email in tests', () => {
  it('the full flow with the development log provider never calls the network', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('network must not be used in tests');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const outbox = new InMemoryOutbox();
    const { app } = buildAccountTestApp({ issueReportRepository: outbox });
    await request(app).post('/api/issues').send({ category: 'other', comment: 'hello' }).expect(201);
    const notifier = createIssueReportNotifier({ mode: 'log', from: 'a@example.test', to: 'b@example.test' }, { store: outbox })!;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await notifier.processDue();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(outbox.only().notification?.state).toBe('accepted');
  });
});
