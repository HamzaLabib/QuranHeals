import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import type { QuranRepository } from '../../src/services/QuranRepository';

// GHSA-27r3-jxmh-p828: body-parser < 2.4.0 could be crashed by trailing bytes after a compressed request body.
// The app never sends compressed requests, so the parsers run with inflate: false (src/app.ts).
function app() {
  return createApp({ repository: {} as QuranRepository, databaseHealthCheck: async () => true });
}

const json = JSON.stringify({ idToken: 'not-a-real-token' });

describe('request bodies', () => {
  it('refuses compressed JSON with a generic 415 before decompressing it', async () => {
    for (const [encoding, body] of [['gzip', gzipSync(json)], ['deflate', deflateSync(json)], ['br', Buffer.from(json)]] as const) {
      const response = await request(app())
        .post('/api/auth/google')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', encoding)
        .send(body);
      expect(response.status, encoding).toBe(415);
      expect(response.body).toEqual({ success: false, message: 'Invalid request.' });
    }
  });

  it('refuses a compressed body followed by trailing bytes the same way', async () => {
    const response = await request(app())
      .post('/api/auth/google')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'gzip')
      .send(Buffer.concat([gzipSync(json), Buffer.from('trailing bytes')]));
    expect(response.status).toBe(415);
  });

  it('refuses compressed form bodies too', async () => {
    const response = await request(app())
      .post('/api/auth/google')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Content-Encoding', 'gzip')
      .send(gzipSync('idToken=x'));
    expect(response.status).toBe(415);
  });

  it('still parses ordinary JSON, with or without an identity Content-Encoding', async () => {
    for (const encoding of [undefined, 'identity']) {
      const call = request(app()).post('/api/auth/google').set('Content-Type', 'application/json');
      if (encoding) call.set('Content-Encoding', encoding);
      // The body reached the sign-in validation: an empty object is its schema error, not a parser error.
      const response = await call.send('{}');
      expect(response.status, String(encoding)).toBe(400);
      expect(response.body).toEqual({ success: false, message: 'Invalid sign-in request.' });
    }
  });

  it('resolves a patched body-parser', () => {
    const lock = JSON.parse(readFileSync(resolve(__dirname, '../../package-lock.json'), 'utf8')) as {
      packages: Record<string, { version?: string }>;
    };
    const [major, minor] = (lock.packages['node_modules/body-parser']?.version ?? '0.0.0').split('.').map(Number);
    expect(major > 2 || (major === 2 && minor >= 4)).toBe(true);
  });
});
