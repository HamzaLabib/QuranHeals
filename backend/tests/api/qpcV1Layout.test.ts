import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app';
import {
  buildQpcV1PageLayout,
  CLIENT_KEEP_MS,
  createQpcV1LayoutService,
  QpcLayoutError,
  SERVER_CACHE_MS,
} from '../../src/mushaf/qpcV1Layout';
import { createQfContentClient, QF_HOSTS, QfUnavailableError, readQfCredentials } from '../../src/quranFoundation/qfContentClient';
import type { QuranRepository } from '../../src/services/QuranRepository';

/**
 * QPC V1 Mushaf layout proxy. All Quran Foundation responses here are
 * SYNTHETIC (made-up glyph codes in the documented shape) — no real QF
 * content is stored in this repository.
 */

const unusedRepository = {} as QuranRepository;
const credentials = { environment: 'prelive' as const, clientId: 'test-client', clientSecret: 'test-secret-value' };

/** Two synthetic ayahs on page 61: 3:84 (lines 1–2) and 3:85 (lines 2–3). */
function syntheticVerses() {
  const word = (position: number, line: number, kind = 'word') => ({ position, char_type_name: kind, code_v1: String.fromCharCode(0xfb50 + position), line_number: line, page_number: 61 });
  return [
    { verse_key: '3:84', words: [word(1, 1), word(2, 1), word(3, 2), word(4, 2, 'end')] },
    { verse_key: '3:85', words: [word(1, 2), word(2, 3), word(3, 3, 'pause'), word(4, 3, 'end')] },
  ];
}

function fakeFetch(handlers: { token?: () => { status: number; body: unknown }; content?: (url: string, headers: Record<string, string>) => { status: number; body: unknown } }) {
  return vi.fn(async (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const reply = url.startsWith(QF_HOSTS.prelive.token)
      ? (handlers.token ?? (() => ({ status: 200, body: { access_token: 'token-1', expires_in: 3600 } })))()
      : (handlers.content ?? (() => ({ status: 200, body: { verses: syntheticVerses(), pagination: { total_pages: 1 } } })))(url, init?.headers ?? {});
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body };
  });
}

describe('Quran Foundation credentials', () => {
  it('reads all-or-nothing credentials and defaults to prelive', () => {
    expect(readQfCredentials({})).toEqual({ credentials: null, problems: [] });
    expect(readQfCredentials({ QF_CLIENT_ID: 'a', QF_CLIENT_SECRET: 'b' }).credentials).toEqual({ environment: 'prelive', clientId: 'a', clientSecret: 'b' });
    expect(readQfCredentials({ QF_ENV: 'production', QF_CLIENT_ID: 'a', QF_CLIENT_SECRET: 'b' }).credentials?.environment).toBe('production');
    const partial = readQfCredentials({ QF_CLIENT_ID: 'a' });
    expect(partial.credentials).toBeNull();
    expect(partial.problems.join(' ')).toMatch(/QF_CLIENT_ID and QF_CLIENT_SECRET/);
    expect(readQfCredentials({ QF_ENV: 'staging', QF_CLIENT_ID: 'a', QF_CLIENT_SECRET: 'b' }).credentials).toBeNull();
  });
});

describe('Content API client', () => {
  it('gets a client-credentials token (scope content), then calls the API with x-auth-token and x-client-id', async () => {
    const fetch = fakeFetch({});
    const client = createQfContentClient(credentials, { fetch });
    await client.get('/content/api/v4/verses/by_page/61');
    const [tokenUrl, tokenInit] = fetch.mock.calls[0];
    expect(tokenUrl).toBe('https://prelive-oauth2.quran.foundation/oauth2/token');
    expect(tokenInit?.body).toBe('grant_type=client_credentials&scope=content');
    expect(tokenInit?.headers?.Authorization).toBe(`Basic ${Buffer.from('test-client:test-secret-value').toString('base64')}`);
    const [apiUrl, apiInit] = fetch.mock.calls[1];
    expect(apiUrl).toBe('https://apis-prelive.quran.foundation/content/api/v4/verses/by_page/61');
    expect(apiInit?.headers).toMatchObject({ 'x-auth-token': 'token-1', 'x-client-id': 'test-client' });
    expect(JSON.stringify(apiInit?.headers)).not.toContain('test-secret-value');
  });

  it('reuses the token until shortly before expiry, and refetches it once on a 401', async () => {
    let clock = 0;
    let tokens = 0;
    let rejectNext = false;
    const fetch = fakeFetch({
      token: () => ({ status: 200, body: { access_token: `token-${(tokens += 1)}`, expires_in: 3600 } }),
      content: (_url, headers) => (rejectNext && headers['x-auth-token'] === 'token-1' ? { status: 401, body: {} } : { status: 200, body: { verses: [] } }),
    });
    const client = createQfContentClient(credentials, { fetch, now: () => clock });
    await client.get('/a');
    await client.get('/b');
    expect(tokens).toBe(1);
    rejectNext = true;
    await client.get('/c');
    expect(tokens).toBe(2);
    clock = 3600 * 1000;
    await client.get('/d');
    expect(tokens).toBe(3);
  });

  it('failures never include credentials', async () => {
    const client = createQfContentClient(credentials, { fetch: fakeFetch({ token: () => ({ status: 400, body: { error: 'invalid_client' } }) }) });
    const error = await client.get('/x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QfUnavailableError);
    expect(String((error as Error).message)).not.toMatch(/test-secret-value|test-client/);
  });
});

describe('page layout', () => {
  const fetchedAt = new Date('2026-10-11T00:00:00Z');

  it('groups glyphs into lines in reading order, keeping each word`s ayah, and tells the app to keep it ≤ 7 days', () => {
    const layout = buildQpcV1PageLayout(61, syntheticVerses(), fetchedAt);
    expect(layout.fontFamily).toBe('QCF_P061');
    expect(layout.verseKeys).toEqual(['3:84', '3:85']);
    expect(layout.lines.map((line) => [line.line, line.words.map((word) => `${word.verseKey}/${word.position}/${word.kind}`)])).toEqual([
      [1, ['3:84/1/word', '3:84/2/word']],
      [2, ['3:84/3/word', '3:84/4/end', '3:85/1/word']],
      [3, ['3:85/2/word', '3:85/3/mark', '3:85/4/end']],
    ]);
    expect(layout.lines[0].words[0].glyph).toBe(syntheticVerses()[0].words[0].code_v1); // passed through unmodified
    expect(Date.parse(layout.keepUntil) - Date.parse(layout.fetchedAt)).toBe(CLIENT_KEEP_MS);
    expect(CLIENT_KEEP_MS).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
  });

  it.each([
    ['an ayah that does not exist', (v: ReturnType<typeof syntheticVerses>) => { v[0].verse_key = '3:201'; }],
    ['ayahs out of sequence', (v: ReturnType<typeof syntheticVerses>) => { v[1].verse_key = '3:86'; }],
    ['a gap in word positions', (v: ReturnType<typeof syntheticVerses>) => { v[0].words[1].position = 5; }],
    ['a word from another page', (v: ReturnType<typeof syntheticVerses>) => { v[0].words[0].page_number = 62; }],
    ['lines going backwards', (v: ReturnType<typeof syntheticVerses>) => { v[1].words[0].line_number = 1; }],
    ['a line beyond 15', (v: ReturnType<typeof syntheticVerses>) => { v[1].words[3].line_number = 16; }],
    ['a missing ayah marker', (v: ReturnType<typeof syntheticVerses>) => { v[0].words[3].char_type_name = 'word'; }],
    ['an unknown word type', (v: ReturnType<typeof syntheticVerses>) => { v[0].words[0].char_type_name = 'image'; }],
    ['an empty glyph code', (v: ReturnType<typeof syntheticVerses>) => { v[0].words[0].code_v1 = ''; }],
  ])('rejects %s', (_label, corrupt) => {
    const verses = syntheticVerses();
    corrupt(verses);
    expect(() => buildQpcV1PageLayout(61, verses, fetchedAt)).toThrow(QpcLayoutError);
  });
});

describe('GET /api/mushaf/qpc-v1/pages/:page', () => {
  const appWith = (service = createQpcV1LayoutService(createQfContentClient(credentials, { fetch: fakeFetch({}) }))) =>
    createApp({ repository: unusedRepository, qpcV1Layout: service, databaseHealthCheck: async () => true });

  it('serves page 61`s layout (prototype scope)', async () => {
    const response = await request(appWith()).get('/api/mushaf/qpc-v1/pages/61').expect(200);
    expect(response.body.data).toMatchObject({ page: 61, edition: 'qpc-v1', attribution: 'Quran Foundation', verseKeys: ['3:84', '3:85'] });
    expect(response.headers['cache-control']).toBe('private, max-age=86400');
  });

  it('only page 61 for now; anything else is a 404', async () => {
    for (const page of ['62', '1', '0', '061', 'abc']) {
      await request(appWith()).get(`/api/mushaf/qpc-v1/pages/${page}`).expect(404);
    }
  });

  it('without credentials, answers 503 without detail', async () => {
    // Explicitly unconfigured: a developer's backend/.env may hold real credentials, and tests never call Quran Foundation.
    const response = await request(createApp({ repository: unusedRepository, databaseHealthCheck: async () => true, qpcV1Layout: createQpcV1LayoutService(null) }))
      .get('/api/mushaf/qpc-v1/pages/61').expect(503);
    expect(response.body).toEqual({ success: false, message: 'The 1405 Mushaf layout is not available right now.' });
  });

  it('a rejected upstream layout is a 503, never a partial page', async () => {
    const bad = syntheticVerses();
    bad[0].words[3].char_type_name = 'word';
    const service = createQpcV1LayoutService(createQfContentClient(credentials, { fetch: fakeFetch({ content: () => ({ status: 200, body: { verses: bad } }) }) }));
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await request(appWith(service)).get('/api/mushaf/qpc-v1/pages/61').expect(503);
    expect(spy.mock.calls.join(' ')).toMatch(/category=validation reason="3:84 does not end with its ayah marker"/);
    expect(spy.mock.calls.join(' ')).not.toMatch(/test-secret-value|token-1/);
  });

  it('caches a page for 24 hours on the server, then fetches it again', async () => {
    let clock = Date.parse('2026-10-11T00:00:00Z');
    const fetch = fakeFetch({});
    const service = createQpcV1LayoutService(createQfContentClient(credentials, { fetch, now: () => clock }), { now: () => new Date(clock) });
    await service.getPage(61);
    await service.getPage(61);
    const contentCalls = () => fetch.mock.calls.filter(([url]) => String(url).startsWith(QF_HOSTS.prelive.api)).length;
    expect(contentCalls()).toBe(1);
    clock += SERVER_CACHE_MS + 1;
    await service.getPage(61);
    expect(contentCalls()).toBe(2);
  });
});

describe('diagnostics: why a page is unavailable (server log only, never secrets)', () => {
  /** Runs one request and returns the single warning it logged. */
  async function failureLog(service: ReturnType<typeof createQpcV1LayoutService>) {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await request(createApp({ repository: unusedRepository, qpcV1Layout: service, databaseHealthCheck: async () => true }))
      .get('/api/mushaf/qpc-v1/pages/61');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ success: false, message: 'The 1405 Mushaf layout is not available right now.' });
    const line = spy.mock.calls.map((call) => call.join(' ')).join('\n');
    spy.mockRestore();
    // Never the client id, secret, token, query string or a response body.
    expect(line).not.toMatch(/test-client|test-secret-value|token-1|Basic |words=|mushaf=|\?/);
    return line;
  }
  const clientWith = (handlers: Parameters<typeof fakeFetch>[0]) => createQpcV1LayoutService(createQfContentClient(credentials, { fetch: fakeFetch(handlers) }));

  it('upstream 404 on the content route (the Pre-live failure observed on 2026-10-11)', async () => {
    const line = await failureLog(clientWith({ content: () => ({ status: 404, body: { message: 'The requested resource could not be found', type: 'not_found' } }) }));
    expect(line).toBe('QPC V1 layout for page 61 unavailable: category=upstream stage=content env=prelive status=404 path=/content/api/v4/verses/by_page/61');
  });

  it('credentials refused at the token endpoint', async () => {
    const line = await failureLog(clientWith({ token: () => ({ status: 401, body: { error: 'invalid_client' } }) }));
    expect(line).toMatch(/category=auth stage=token env=prelive status=401$/);
  });

  it('content refused even after a fresh token', async () => {
    const line = await failureLog(clientWith({ content: () => ({ status: 403, body: {} }) }));
    expect(line).toMatch(/category=auth stage=content env=prelive status=403 path=\/content\/api\/v4\/verses\/by_page\/61$/);
  });

  it('upstream server error', async () => {
    expect(await failureLog(clientWith({ content: () => ({ status: 500, body: {} }) }))).toMatch(/category=upstream stage=content env=prelive status=500/);
  });

  it('no network answer, keeping only the system error code', async () => {
    const fetch = vi.fn(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', hostname: 'prelive-oauth2.quran.foundation' } }); });
    const line = await failureLog(createQpcV1LayoutService(createQfContentClient(credentials, { fetch })));
    expect(line).toMatch(/category=network stage=token env=prelive code=ENOTFOUND$/);
  });

  it('a timeout', async () => {
    const fetch = vi.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); });
    expect(await failureLog(createQpcV1LayoutService(createQfContentClient(credentials, { fetch })))).toMatch(/category=timeout stage=token env=prelive$/);
  });

  it('a token answer without an access token', async () => {
    expect(await failureLog(clientWith({ token: () => ({ status: 200, body: { token_type: 'bearer' } }) }))).toMatch(/category=malformed stage=token env=prelive status=200$/);
  });

  it('no credentials configured', async () => {
    expect(await failureLog(createQpcV1LayoutService(null))).toMatch(/category=not_configured$/);
  });
});
