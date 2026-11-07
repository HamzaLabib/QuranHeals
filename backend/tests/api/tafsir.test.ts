import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import type { QuranRepository } from '../../src/services/QuranRepository';

/** The tafsir reader's optional editions, served by SHA-256 name (src/tafsir/routes.ts). SYNTHETIC files only. */
let dir: string;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const app = (tafsirDataDir: string | null = dir) => createApp({ repository: {} as QuranRepository, databaseHealthCheck: async () => true, mushafOfflineStore: null, tafsirDataDir });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tafsir-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function put(edition: string, name: string, bytes: Buffer) {
  await mkdir(join(dir, edition), { recursive: true });
  await writeFile(join(dir, edition, name), bytes);
}

describe('GET /api/tafsir/v1/editions/:edition/:sha256.json', () => {
  const file = Buffer.from('{"format":"quran-heals-tafsir","synthetic":true}\n');

  it('serves the exact bytes, immutable, when the name is the content SHA-256', async () => {
    await put('saadi', `${sha(file)}.json`, file);
    const response = await request(app()).get(`/api/tafsir/v1/editions/saadi/${sha(file)}.json`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body as Buffer, file)).toBe(0);
    expect(response.headers['content-length']).toBe(String(file.length));
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('refuses a file whose content does not match its name (altered or partial)', async () => {
    const name = sha(file);
    await put('saadi', `${name}.json`, Buffer.from('{"altered":true}'));
    expect((await request(app()).get(`/api/tafsir/v1/editions/saadi/${name}.json`)).status).toBe(404);
  });

  it('serves nothing outside the four editions, malformed names, traversal, or with no data directory', async () => {
    await put('saadi', `${sha(file)}.json`, file);
    for (const path of [
      `/api/tafsir/v1/editions/other/${sha(file)}.json`,
      `/api/tafsir/v1/editions/saadi/${sha(file)}`,
      `/api/tafsir/v1/editions/saadi/${sha(file).toUpperCase()}.json`,
      `/api/tafsir/v1/editions/saadi/..%2F..%2Fpackage.json`,
      '/api/tafsir/v1/editions/saadi/',
    ]) expect((await request(app()).get(path)).status).toBe(404);
    expect((await request(app(null)).get(`/api/tafsir/v1/editions/saadi/${sha(file)}.json`)).status).toBe(404);
  });

  it('a file added after a miss is served on the next request', async () => {
    const server = app();
    expect((await request(server).get(`/api/tafsir/v1/editions/zilal/${sha(file)}.json`)).status).toBe(404);
    await put('zilal', `${sha(file)}.json`, file);
    expect((await request(server).get(`/api/tafsir/v1/editions/zilal/${sha(file)}.json`)).status).toBe(200);
  });
});
