import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { buildAccountTestApp } from './testApp';

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ idToken: token });
  return res.body.data.token as string;
}

describe('Preferences sync', () => {
  it('requires authentication', async () => {
    const { app } = buildAccountTestApp();
    expect((await request(app).get('/api/sync/preferences')).status).toBe(401);
  });

  it('first sign-in with no cloud preference stores the uploaded local preference', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't1', 's1');

    const res = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'ar-EG', translationDisplayMode: 'on-demand', updatedAt: '2026-01-01T00:00:00.000Z' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ locale: 'ar-EG', translationDisplayMode: 'on-demand' });
  });

  it('last-write-wins by updatedAt: an older update never overwrites a newer stored preference', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't2', 's2');

    await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'ar', updatedAt: '2026-02-01T00:00:00.000Z' });

    const olderUpdate = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'en', updatedAt: '2026-01-01T00:00:00.000Z' });

    expect(olderUpdate.body.data.locale).toBe('ar');
  });

  it('a strictly newer cross-device update is applied', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't3', 's3');

    await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ translationDisplayMode: 'off', updatedAt: '2026-01-01T00:00:00.000Z' });

    const newer = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ translationDisplayMode: 'always', updatedAt: '2026-01-02T00:00:00.000Z' });

    expect(newer.body.data.translationDisplayMode).toBe('always');
  });

  it('supports syncing a translationId when applicable', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't4', 's4');

    const res = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ translationId: 'pickthall', updatedAt: '2026-01-01T00:00:00.000Z' });

    expect(res.body.data.translationId).toBe('pickthall');
  });

  it('rejects an invalid locale/display mode', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 't5', 's5');

    const res = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ locale: 'fr', updatedAt: '2026-01-01T00:00:00.000Z' });

    expect(res.status).toBe(400);
  });
});
