import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { acceptClientInstant, acceptCreatedAt, CLIENT_CLOCK_TOLERANCE_MS } from '../../src/services/clientInstants';
import { buildAccountTestApp } from './testApp';

// A device whose clock is decades ahead (services/clientInstants.ts).
const FAR_FUTURE = '2099-01-01T00:00:00.000Z';
const PAST = '2026-01-01T00:00:00.000Z';

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: token });
  return res.body.data.token as string;
}

/** Whether `iso` is the server's time during this request (between `before` and now). */
function isServerTime(iso: string, before: number): boolean {
  const at = Date.parse(iso);
  return at >= before && at <= Date.now();
}

describe('acceptClientInstant', () => {
  const now = Date.parse('2026-10-27T12:00:00.000Z');

  it('keeps past instants and ordinary drift as declared', () => {
    expect(acceptClientInstant(PAST, now)).toBe(PAST);
    const drift = new Date(now + CLIENT_CLOCK_TOLERANCE_MS).toISOString();
    expect(acceptClientInstant(drift, now)).toBe(drift);
  });

  it('stores an instant beyond the tolerance as the server time', () => {
    expect(acceptClientInstant(new Date(now + CLIENT_CLOCK_TOLERANCE_MS + 1).toISOString(), now)).toBe(new Date(now).toISOString());
    expect(acceptClientInstant(FAR_FUTURE, now)).toBe(new Date(now).toISOString());
  });

  it('never lets a creation instant come after the accepted update', () => {
    const updatedAt = new Date(now).toISOString();
    expect(acceptCreatedAt(FAR_FUTURE, updatedAt, now)).toBe(updatedAt);
    expect(acceptCreatedAt(PAST, updatedAt, now)).toBe(PAST);
  });
});

describe('Future device timestamps (favorites, reflections, settings)', () => {
  it('favorites: a future instant is stored as server time and returned, so a later deletion still wins', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'fav', 'fav-sub');
    const before = Date.now();

    const put = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [{ type: 'active', verseKey: '2:255', createdAt: FAR_FUTURE, updatedAt: FAR_FUTURE }] });
    expect(put.status).toBe(200);
    const [saved] = put.body.data.saved;
    expect(saved.type).toBe('active');
    expect(isServerTime(saved.updatedAt, before)).toBe(true);
    expect(Date.parse(saved.createdAt)).toBeLessThanOrEqual(Date.parse(saved.updatedAt));

    // Another device, correct clock, removes it a moment later.
    const deletedAt = new Date(Date.now() + 1000).toISOString();
    const removal = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [{ type: 'tombstone', verseKey: '2:255', deletedAt }] });
    expect(removal.body.data.saved[0]).toEqual({ type: 'tombstone', verseKey: '2:255', deletedAt });
  });

  it('favorites: a future deletion instant is stored as server time', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'fav2', 'fav2-sub');
    const before = Date.now();
    const put = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [{ type: 'tombstone', verseKey: '1:1', deletedAt: FAR_FUTURE }] });
    expect(isServerTime(put.body.data.saved[0].deletedAt, before)).toBe(true);
  });

  it('favorites: past instants are stored exactly as declared', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'fav3', 'fav3-sub');
    const put = await request(app)
      .put('/api/sync/favorites')
      .set('Authorization', `Bearer ${token}`)
      .send({ favorites: [{ type: 'active', verseKey: '94:6', createdAt: PAST, updatedAt: PAST }] });
    expect(put.body.data.saved[0]).toEqual({ type: 'active', verseKey: '94:6', createdAt: PAST, updatedAt: PAST });
  });

  it('reflections: the ciphertext is kept unchanged and only the instant becomes server time; a later edit still wins', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'refl', 'refl-sub');
    const before = Date.now();
    const record = { verseKey: '2:286', ciphertext: 'Zmlyc3Q=', nonce: 'bm9uY2Ux', encryptionVersion: 1, createdAt: FAR_FUTURE, updatedAt: FAR_FUTURE };

    const put = await request(app).put('/api/sync/reflections').set('Authorization', `Bearer ${token}`).send({ reflections: [record] });
    expect(put.status).toBe(200);
    const [saved] = put.body.data.saved;
    expect(saved.ciphertext).toBe(record.ciphertext);
    expect(saved.nonce).toBe(record.nonce);
    expect(isServerTime(saved.updatedAt, before)).toBe(true);
    expect(Date.parse(saved.createdAt)).toBeLessThanOrEqual(Date.parse(saved.updatedAt));

    const laterAt = new Date(Date.now() + 1000).toISOString();
    const later = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [{ ...record, ciphertext: 'c2Vjb25k', nonce: 'bm9uY2Uy', createdAt: PAST, updatedAt: laterAt }] });
    expect(later.body.data.saved[0]).toMatchObject({ ciphertext: 'c2Vjb25k', updatedAt: laterAt });
    expect(later.body.data.conflicts).toEqual([]);
  });

  it('reflections: a future deletion instant is stored as server time', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'refl2', 'refl2-sub');
    const before = Date.now();
    const put = await request(app)
      .put('/api/sync/reflections')
      .set('Authorization', `Bearer ${token}`)
      .send({ reflections: [{ type: 'tombstone', verseKey: '3:8', deletedAt: FAR_FUTURE }] });
    expect(isServerTime(put.body.data.saved[0].deletedAt, before)).toBe(true);
  });

  it('settings: a future per-field instant (and updatedAt) is stored as server time; a later change still wins', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pref', 'pref-sub');
    const before = Date.now();

    const put = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ appearance: 'dark', locale: 'en', updatedAt: FAR_FUTURE, fieldUpdatedAt: { appearance: FAR_FUTURE, locale: PAST } });
    expect(put.status).toBe(200);
    expect(put.body.data.appearance).toBe('dark');
    expect(isServerTime(put.body.data.fieldUpdatedAt.appearance, before)).toBe(true);
    expect(put.body.data.fieldUpdatedAt.locale).toBe(PAST);
    expect(isServerTime(put.body.data.updatedAt, before)).toBe(true);

    const laterAt = new Date(Date.now() + 1000).toISOString();
    const later = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ appearance: 'light', updatedAt: laterAt, fieldUpdatedAt: { appearance: laterAt } });
    expect(later.body.data.appearance).toBe('light');
    expect(later.body.data.fieldUpdatedAt.appearance).toBe(laterAt);
  });

  it('settings: an older app without per-field instants is protected through updatedAt', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pref2', 'pref2-sub');
    const before = Date.now();
    const put = await request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send({ appearance: 'dark', updatedAt: FAR_FUTURE });
    expect(isServerTime(put.body.data.fieldUpdatedAt.appearance, before)).toBe(true);
  });
});
