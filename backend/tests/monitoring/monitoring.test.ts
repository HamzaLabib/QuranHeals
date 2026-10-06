import * as Sentry from '@sentry/node';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import { AppError } from '../../src/errors/AppError';
import { errorHandler } from '../../src/middleware/errorHandler';
import {
  flushMonitoring,
  initMonitoring,
  isMonitoringEnabled,
  reportError,
  scrubEvent,
  scrubString,
} from '../../src/monitoring/monitoring';
import type { QuranRepository } from '../../src/services/QuranRepository';

// Fake DSN: events go to the in-memory transport below, never the network.
const FAKE_DSN = 'https://publickey@o0.ingest.example.invalid/1';

// Clearly fake secrets of every kind the backend handles.
const SECRETS = {
  bearer: 'Bearer abc.def.ghi-not-a-real-token',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ1MSJ9.c2lnbmF0dXJlLW5vdC1yZWFs',
  mongo: 'mongodb+srv://quranheals:hunter2-fake@cluster0.example.invalid/?retryWrites=true',
  refresh: '64b7f0c2a1b2c3d4e5f60718.Zm9vYmFyYmF6cXV4LW5vdC1yZWFsLXJlZnJlc2g',
  email: 'someone@example.com',
  pem: '-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgFAKE\n-----END PRIVATE KEY-----',
  ciphertext: 'Q2lwaGVydGV4dDEyMw9ub3QtcmVhbC1jaXBoZXJ0ZXh0LXJlZmxlY3Rpb24yMDI2',
};

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

afterEach(async () => {
  await Sentry.close(500);
  vi.restoreAllMocks();
});

describe('monitoring initialization', () => {
  it('is disabled (and reporting is a no-op) when SENTRY_DSN is absent', () => {
    expect(initMonitoring({ dsn: undefined, environment: 'production' })).toBe(false);
    expect(initMonitoring({ dsn: '  ', environment: 'production' })).toBe(false);
    expect(isMonitoringEnabled()).toBe(false);
    expect(() => reportError(new Error('x'))).not.toThrow();
  });

  it('enables with a DSN, tagging environment and release, error-capture integrations only, no data collection', () => {
    const { transport } = memoryTransport();
    expect(initMonitoring({ dsn: FAKE_DSN, environment: 'production', release: 'abc123', transport })).toBe(true);
    const options = Sentry.getClient()!.getOptions();
    expect(options).toMatchObject({ environment: 'production', release: 'abc123', maxBreadcrumbs: 0 });
    expect(options.tracesSampleRate).toBeUndefined();
    const names = options.integrations.map((integration) => integration.name);
    expect(names).toEqual(expect.arrayContaining(['OnUncaughtException', 'OnUnhandledRejection', 'LinkedErrors']));
    for (const forbidden of ['RequestData', 'LocalVariables', 'LocalVariablesAsync', 'Http', 'NodeFetch', 'Console', 'Express', 'Mongoose']) {
      expect(names).not.toContain(forbidden);
    }
    expect(options.dataCollection).toMatchObject({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false });
  });

  it('a bad DSN never throws', () => {
    expect(() => initMonitoring({ dsn: 'not a dsn', environment: 'production' })).not.toThrow();
  });
});

describe('redaction', () => {
  it.each(Object.entries(SECRETS))('scrubString removes %s', (_name, secret) => {
    const scrubbed = scrubString(`failure near ${secret} in request`);
    expect(scrubbed).not.toContain(secret.replace(/^Bearer /, ''));
    expect(scrubbed).toMatch(/^failure near /);
  });

  it('keeps ordinary error text readable', () => {
    expect(scrubString('Cannot read properties of undefined (reading "verseKey")')).toBe('Cannot read properties of undefined (reading "verseKey")');
  });

  it('scrubEvent drops request data, user, extra and breadcrumbs, and scrubs contexts and tags', () => {
    const event = scrubEvent({
      message: `token ${SECRETS.jwt}`,
      user: { email: SECRETS.email, ip_address: '1.2.3.4' },
      extra: { body: { reflection: 'private text' } },
      breadcrumbs: [{ message: SECRETS.bearer }],
      request: { method: 'PUT', url: '/api/sync/reflections?token=abc', headers: { authorization: SECRETS.bearer }, data: '{"ciphertext":"x"}', cookies: { a: 'b' } },
      contexts: { custom: { authorization: SECRETS.bearer, note: SECRETS.mongo } },
      tags: { route: '/api/sync/reflections' },
      exception: { values: [{ type: 'Error', value: SECRETS.mongo, stacktrace: { frames: [{ function: 'f', vars: { password: 'x' } }] } }] },
    });
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.breadcrumbs).toBeUndefined();
    expect(event.request).toEqual({ method: 'PUT', url: '/api/sync/reflections' });
    expect(JSON.stringify(event)).not.toMatch(/hunter2|eyJhbGci|abc\.def|someone@|private text|ciphertext|password/);
    expect(event.tags).toEqual({ route: '/api/sync/reflections' });
  });

  it('events actually sent to Sentry are scrubbed', async () => {
    const { events, transport } = memoryTransport();
    initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
    reportError(new Error(Object.values(SECRETS).join(' | ')), { method: 'POST', route: '/api/auth/refresh' });
    await flushMonitoring(2000);
    expect(events).toHaveLength(1);
    const sent = JSON.stringify(events[0]);
    for (const secret of Object.values(SECRETS)) expect(sent).not.toContain(secret.replace(/^Bearer /, ''));
    expect(events[0]).toMatchObject({ environment: 'production', tags: { 'http.method': 'POST', 'http.route': '/api/auth/refresh' } });
    expect(events[0].user).toBeUndefined();
  });
});

describe('error handler reporting', () => {
  function appThatThrows(error: unknown) {
    const app = express();
    app.use(express.json());
    app.post('/api/boom/:id', () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it('reports an unexpected error once, with route tags only, and keeps the generic 500', async () => {
    const { events, transport } = memoryTransport();
    initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
    const response = await request(appThatThrows(new TypeError('boom'))).post('/api/boom/42').send({ refreshToken: SECRETS.refresh });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ success: false, message: 'Something went wrong.' });
    await flushMonitoring(2000);
    expect(events).toHaveLength(1);
    expect(events[0].tags).toMatchObject({ 'http.method': 'POST', 'http.route': '/api/boom/:id' });
    expect(JSON.stringify(events[0])).not.toContain(SECRETS.refresh);
  });

  it('does not report expected 4xx AppErrors, but reports 5xx AppErrors', async () => {
    const { events, transport } = memoryTransport();
    initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
    expect((await request(appThatThrows(new AppError('Sign in required.', 401))).post('/api/boom/1')).status).toBe(401);
    expect((await request(appThatThrows(new AppError('Account deletion could not be completed.', 502))).post('/api/boom/1')).status).toBe(502);
    await flushMonitoring(2000);
    expect(events.map((event) => event.exception?.values?.[0]?.value)).toEqual(['Account deletion could not be completed.']);
  });

  it('answers malformed JSON with a generic 400, never logging or reporting the raw body', async () => {
    const { events, transport } = memoryTransport();
    initMonitoring({ dsn: FAKE_DSN, environment: 'production', transport });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await request(appThatThrows(new Error('unused')))
      .post('/api/boom/1')
      .set('Content-Type', 'application/json')
      .send(`{"refreshToken":"${SECRETS.refresh}"`);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ success: false, message: 'Invalid request.' });
    await flushMonitoring(2000);
    expect(events).toHaveLength(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain(SECRETS.refresh);
  });
});

describe('Sentry unreachable', () => {
  it('reporting and flushing complete without throwing, and the API keeps serving', async () => {
    // Real transport, pointed at a closed local port: delivery fails, nothing else may.
    expect(initMonitoring({ dsn: 'https://publickey@127.0.0.1:9/1', environment: 'production' })).toBe(true);
    expect(() => reportError(new Error('boom'))).not.toThrow();
    await expect(flushMonitoring(1000)).resolves.toBeUndefined();
    const app = createApp({ repository: {} as QuranRepository, databaseHealthCheck: async () => true });
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    expect(health.body.data).toMatchObject({ status: 'ok', database: 'connected' });
  });
});
