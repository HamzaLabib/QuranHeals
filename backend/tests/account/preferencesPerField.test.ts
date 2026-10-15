import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { mergePreferences, toPreferencesDto } from '../../src/services/preferencesMerge';
import { buildAccountTestApp } from './testApp';

/** Per-field account preferences (services/preferencesMerge.ts). */

async function signIn(app: ReturnType<typeof buildAccountTestApp>['app'], googleTokens: Map<string, { providerSubject: string }>, token: string, sub: string) {
  googleTokens.set(token, { providerSubject: sub });
  const res = await request(app).post('/api/auth/google').send({ accountAgeConfirmation: { policyVersion: 1 }, idToken: token });
  return res.body.data.token as string;
}

const T1 = '2026-01-01T00:00:00.000Z';
const T2 = '2026-01-02T00:00:00.000Z';
const T3 = '2026-01-03T00:00:00.000Z';

describe('Preferences: per-field sync', () => {
  it('stores and returns the newly synced settings with their own instants', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf1', 'spf1');

    const res = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({
        quranLanguage: 'quran-text',
        emotionsLanguage: 'ar-EG',
        appearance: 'dark',
        quranFontSize: 30,
        updatedAt: T2,
        fieldUpdatedAt: { quranLanguage: T1, emotionsLanguage: T1, appearance: T2, quranFontSize: T2 },
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      quranLanguage: 'quran-text',
      emotionsLanguage: 'ar-EG',
      appearance: 'dark',
      quranFontSize: 30,
      updatedAt: T2,
      fieldUpdatedAt: { quranLanguage: T1, emotionsLanguage: T1, appearance: T2, quranFontSize: T2 },
    });
    const read = await request(app).get('/api/sync/preferences').set('Authorization', `Bearer ${token}`);
    expect(read.body.data).toEqual(res.body.data);
  });

  it('two devices changing different settings never undo each other, whatever order they upload in', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf2', 'spf2');
    const put = (body: object) => request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send(body);

    await put({ locale: 'en', appearance: 'system', updatedAt: T1, fieldUpdatedAt: { locale: T1, appearance: T1 } });
    // Device B changed Appearance later; Device A changed the language earlier but uploads last (it was offline).
    await put({ appearance: 'dark', updatedAt: T3, fieldUpdatedAt: { appearance: T3 } });
    const res = await put({ locale: 'ar', updatedAt: T2, fieldUpdatedAt: { locale: T2 } });

    expect(res.body.data).toMatchObject({ locale: 'ar', appearance: 'dark', updatedAt: T3 });
  });

  it('the same setting changed on two devices: the later change wins, an exact tie keeps the account value', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf3', 'spf3');
    const put = (body: object) => request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send(body);

    await put({ quranFontSize: 28, updatedAt: T2, fieldUpdatedAt: { quranFontSize: T2 } });
    expect((await put({ quranFontSize: 22, updatedAt: T1, fieldUpdatedAt: { quranFontSize: T1 } })).body.data.quranFontSize).toBe(28);
    expect((await put({ quranFontSize: 32, updatedAt: T2, fieldUpdatedAt: { quranFontSize: T2 } })).body.data.quranFontSize).toBe(28);
    expect((await put({ quranFontSize: 24, updatedAt: T3, fieldUpdatedAt: { quranFontSize: T3 } })).body.data.quranFontSize).toBe(24);
  });

  it('an older app (one updatedAt, three fields) keeps working beside per-field records', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf4', 'spf4');
    const put = (body: object) => request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send(body);

    await put({ appearance: 'light', translationDisplayMode: 'always', updatedAt: T3, fieldUpdatedAt: { appearance: T3, translationDisplayMode: T3 } });
    const res = await put({ locale: 'ar', translationDisplayMode: 'off', translationId: 'en.pickthall.gutenberg16955', updatedAt: T2 });

    // Its locale and translation id are new to the account; its display mode is older than the account's.
    expect(res.body.data).toMatchObject({ locale: 'ar', translationDisplayMode: 'always', translationId: 'en.pickthall.gutenberg16955', appearance: 'light', updatedAt: T3 });
  });

  it('rejects invalid values for the new settings', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf5', 'spf5');
    const put = (body: object) => request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${token}`).send({ updatedAt: T1, ...body });

    for (const body of [
      { appearance: 'blue' },
      { emotionsLanguage: 'fr' },
      { quranFontSize: 23 },
      { quranFontSize: 40 },
      { quranFontSize: '26' },
      { quranLanguage: 'Quran Text!' },
      { appearance: 'dark', fieldUpdatedAt: { appearance: 'yesterday' } },
    ]) {
      expect((await put(body)).status).toBe(400);
    }
  });

  it('ignores a setting it does not know (a newer app), storing the rest', async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const token = await signIn(app, googleTokens, 'pf6', 'spf6');

    const res = await request(app)
      .put('/api/sync/preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ appearance: 'dark', futureSetting: 'x', updatedAt: T1, fieldUpdatedAt: { appearance: T1, futureSetting: T1 } });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ appearance: 'dark', updatedAt: T1, fieldUpdatedAt: { appearance: T1 } });
  });

  it("never shows one account's preferences to another", async () => {
    const { app, googleTokens } = buildAccountTestApp();
    const a = await signIn(app, googleTokens, 'pf7a', 'spf7a');
    const b = await signIn(app, googleTokens, 'pf7b', 'spf7b');

    await request(app).put('/api/sync/preferences').set('Authorization', `Bearer ${a}`).send({ appearance: 'dark', quranFontSize: 32, updatedAt: T1 });

    expect((await request(app).get('/api/sync/preferences').set('Authorization', `Bearer ${b}`)).body.data).toBeNull();
  });
});

describe('mergePreferences (pure rules)', () => {
  const legacy = { locale: 'ar', translationDisplayMode: 'on-demand' as const, updatedAt: new Date(T2) };

  it('reads a record stored before per-field instants as changed at its updatedAt', () => {
    expect(toPreferencesDto(legacy)).toEqual({ locale: 'ar', translationDisplayMode: 'on-demand', updatedAt: T2, fieldUpdatedAt: { locale: T2, translationDisplayMode: T2 } });
  });

  it('returns null (nothing to write) when no incoming field is newer', () => {
    expect(mergePreferences(legacy, { locale: 'en' }, new Date(T1))).toBeNull();
    expect(mergePreferences(legacy, { locale: 'en' }, new Date(T2))).toBeNull();
    expect(mergePreferences(legacy, {}, new Date(T3))).toBeNull();
  });

  it('keeps the untouched fields at their own instant when the record moves forward', () => {
    const merged = mergePreferences(legacy, { appearance: 'dark' }, new Date(T3))!;
    expect(merged.updatedAt.toISOString()).toBe(T3);
    expect(toPreferencesDto(merged).fieldUpdatedAt).toEqual({ locale: T2, translationDisplayMode: T2, appearance: T3 });
  });
});
