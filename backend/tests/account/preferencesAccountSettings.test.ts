import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { mergeRecentEmotions, RECENT_EMOTIONS_LIMIT } from '../../src/services/preferencesMerge';
import { buildAccountTestApp } from './testApp';

/**
 * The settings added 2026-10-27 (services/preferencesMerge.ts): stored and
 * returned per field; validated; kept exactly as stored by an older app's
 * write; the Mushaf guide's completion only moving forward; and Home's
 * recent emotions merged as a history (union, one per emotion, its latest
 * use, at most the limit), with future instants stored as server time.
 */

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: token });
  return res.body.data.token as string;
}

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';
const WIRD = { enabled: true, frequency: 'daily', time: '20:30', weekday: null, anchor: null };
const CHECK_IN = { enabled: true, frequency: 'twiceDaily', time: '21:00', weekday: null, anchor: null, twice: { morning: '07:15', evening: '22:45' } };

async function account(sub: string) {
  const { app, googleTokens } = buildAccountTestApp();
  const token = await signIn(app, googleTokens, `t-${sub}`, sub);
  const put = (body: Record<string, unknown>) => request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send(body);
  const get = async () => (await request(app).get('/api/sync/preferences').set('Authorization', `Bearer ${token}`)).body.data;
  return { put, get };
}

describe('account settings added 2026-10-27', () => {
  it('every new setting is stored and returned with its own instant', async () => {
    const { put, get } = await account('s1');
    const values = {
      translationEnabledMode: 'always', favoriteReciter: 'husary', keepAwake: false, wordMeaningsVisible: false, memorizationModeVisible: true,
      notificationWird: WIRD, notificationEmotionCheckIn: CHECK_IN, mushafGuide: 'closed', memorizationGuide: 'done',
    };
    const res = await put({ ...values, updatedAt: T1, fieldUpdatedAt: Object.fromEntries(Object.keys(values).map((field) => [field, T1])) });
    expect(res.status).toBe(200);
    const stored = await get();
    expect(stored).toMatchObject(values);
    for (const field of Object.keys(values)) expect(stored.fieldUpdatedAt[field]).toBe(T1);
  });

  it('per field, the newer change wins; two different settings never undo each other', async () => {
    const { put, get } = await account('s2');
    await put({ keepAwake: false, updatedAt: T2, fieldUpdatedAt: { keepAwake: T2 } });
    await put({ keepAwake: true, favoriteReciter: 'shatri', updatedAt: T1, fieldUpdatedAt: { keepAwake: T1, favoriteReciter: T1 } });
    expect(await get()).toMatchObject({ keepAwake: false, favoriteReciter: 'shatri' });
  });

  it('an older app`s write (no new fields) keeps every new field exactly as stored', async () => {
    const { put, get } = await account('s3');
    await put({ keepAwake: false, notificationWird: WIRD, updatedAt: T1, fieldUpdatedAt: { keepAwake: T1, notificationWird: T1 } });
    await put({ locale: 'ar', updatedAt: T3 });
    expect(await get()).toMatchObject({ locale: 'ar', keepAwake: false, notificationWird: WIRD, fieldUpdatedAt: { keepAwake: T1, notificationWird: T1 } });
  });

  it('invalid values are refused, an unknown field is stripped', async () => {
    const { put, get } = await account('s4');
    expect((await put({ keepAwake: 'yes', updatedAt: T1 })).status).toBe(400);
    expect((await put({ favoriteReciter: 'Not A Reciter!', updatedAt: T1 })).status).toBe(400);
    expect((await put({ notificationWird: { ...WIRD, time: '25:00' }, updatedAt: T1 })).status).toBe(400);
    expect((await put({ notificationWird: { ...WIRD, pushToken: 'abc' }, updatedAt: T1 })).status).toBe(400);
    expect((await put({ mushafGuide: 'unseen', updatedAt: T1 })).status).toBe(400);
    expect((await put({ appearance: 'dark', aFutureSetting: 1, updatedAt: T1 })).status).toBe(200);
    expect(await get()).not.toHaveProperty('aFutureSetting');
  });

  it('the Mushaf guide only moves forward: a later "closed" never replaces "finished"', async () => {
    const { put, get } = await account('s5');
    await put({ mushafGuide: 'finished', updatedAt: T1, fieldUpdatedAt: { mushafGuide: T1 } });
    const res = await put({ mushafGuide: 'closed', updatedAt: T3, fieldUpdatedAt: { mushafGuide: T3 } });
    expect(res.body.data).toMatchObject({ mushafGuide: 'finished', fieldUpdatedAt: { mushafGuide: T1 } });
    // 'finished' always replaces 'closed', even at an earlier instant.
    const other = await account('s5b');
    await other.put({ mushafGuide: 'closed', updatedAt: T3, fieldUpdatedAt: { mushafGuide: T3 } });
    await other.put({ mushafGuide: 'finished', updatedAt: T1, fieldUpdatedAt: { mushafGuide: T1 } });
    expect(await other.get()).toMatchObject({ mushafGuide: 'finished' });
    expect(await get()).toMatchObject({ mushafGuide: 'finished' });
  });
});

describe('Home`s recent emotions on the account', () => {
  it('two devices` lists merge: one entry per emotion, its latest use, most recent first', async () => {
    const { put, get } = await account('r1');
    await put({ recentEmotions: [{ key: 'sad', at: T1 }, { key: 'anxious', at: T2 }], updatedAt: T2, fieldUpdatedAt: { recentEmotions: T2 } });
    const res = await put({ recentEmotions: [{ key: 'sad', at: T3 }, { key: 'lonely', at: T1 }], updatedAt: T1, fieldUpdatedAt: { recentEmotions: T1 } });
    expect(res.body.data.recentEmotions).toEqual([{ key: 'sad', at: T3 }, { key: 'anxious', at: T2 }, { key: 'lonely', at: T1 }]);
    expect((await get()).fieldUpdatedAt.recentEmotions).toBe(T2);
  });

  it('the limit holds after merging (the most recent are kept)', async () => {
    const { put } = await account('r2');
    const at = (i: number) => new Date(Date.parse(T1) + i * 1000).toISOString();
    await put({ recentEmotions: Array.from({ length: 12 }, (_, i) => ({ key: `a${i}`, at: at(i * 2) })), updatedAt: T1 });
    const res = await put({ recentEmotions: Array.from({ length: 12 }, (_, i) => ({ key: `b${i}`, at: at(i * 2 + 1) })), updatedAt: T1 });
    const keys = res.body.data.recentEmotions.map((entry: { key: string }) => entry.key);
    expect(keys).toHaveLength(RECENT_EMOTIONS_LIMIT);
    expect(keys.slice(0, 2)).toEqual(['b11', 'a11']);
    expect(keys).not.toContain('a5');
  });

  it('more than the limit in one request is refused', async () => {
    const { put } = await account('r3');
    const res = await put({ recentEmotions: Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, at: T1 })), updatedAt: T1 });
    expect(res.status).toBe(400);
  });

  it('a use declared in the future is stored at the server`s time', async () => {
    const { put } = await account('r4');
    const before = Date.now();
    const res = await put({ recentEmotions: [{ key: 'sad', at: '2099-01-01T00:00:00.000Z' }], updatedAt: T1 });
    const at = Date.parse(res.body.data.recentEmotions[0].at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('mergeRecentEmotions: duplicates within one list collapse to the latest use', () => {
    expect(mergeRecentEmotions([{ key: 'sad', at: T1 }, { key: 'sad', at: T3 }], [{ key: 'sad', at: T2 }])).toEqual([{ key: 'sad', at: T3 }]);
  });
});
