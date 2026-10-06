import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app';
import type { QuranRepository } from '../../src/services/QuranRepository';

const unusedRepository = {} as QuranRepository;
const appWith = (databaseHealthCheck: () => Promise<boolean>) => createApp({ repository: unusedRepository, databaseHealthCheck });

describe('GET /api/health', () => {
  it('200 when the app is up and MongoDB answers', async () => {
    const response = await request(appWith(async () => true)).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ success: true, data: { status: 'ok', database: 'connected' } });
  });

  it('503 when MongoDB is unavailable, so uptime monitors alert', async () => {
    const response = await request(appWith(async () => false)).get('/api/health').expect(503);
    expect(response.body).toMatchObject({ success: false, data: { status: 'degraded', database: 'unavailable' } });
  });

  it('503 (not a crash or a leaked error) when the check itself throws', async () => {
    const response = await request(appWith(async () => { throw new Error('mongodb+srv://u:secret@db.example.invalid/quranheals_prod timed out'); }))
      .get('/api/health')
      .expect(503);
    expect(JSON.stringify(response.body)).not.toMatch(/secret|example\.invalid|quranheals_prod|mongodb/);
  });

  it('exposes only status words — no database name, host or URI', async () => {
    const response = await request(appWith(async () => true)).get('/api/health');
    expect(Object.keys(response.body.data).sort()).toEqual(['database', 'environment', 'status', 'uptimeSeconds']);
  });

  it('defaults to a real ping, which reports unavailable when no connection is open', async () => {
    const response = await request(createApp({ repository: unusedRepository })).get('/api/health');
    expect(response.status).toBe(503);
  });
});
