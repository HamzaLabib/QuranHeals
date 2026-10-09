import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { ACCOUNT_AGE_CONFIRMATION_REQUIRED_MESSAGE } from '../../src/controllers/authController';
import { UserModel } from '../../src/models/User';
import { ACCOUNT_AGE_POLICY_VERSION } from '../../src/validators/authValidators';
import { buildAccountTestApp } from './testApp';

/**
 * 16+ account policy: a NEW account needs the current self-declared
 * account-age confirmation; an existing account never does. This is a
 * documented declaration step, not age verification — any client can send
 * the field.
 */

type Built = ReturnType<typeof buildAccountTestApp>;
type Provider = 'google' | 'apple';

const DECLARATION = { policyVersion: ACCOUNT_AGE_POLICY_VERSION };

function tokens(built: Built, provider: Provider) {
  return provider === 'google' ? built.googleTokens : built.appleTokens;
}

function signIn(built: Built, provider: Provider, body: Record<string, unknown>) {
  return request(built.app).post(`/api/auth/${provider}`).send(body);
}

/** Creates an account the supported way (with the declaration) and returns its session. */
async function existingAccount(built: Built, provider: Provider, subject: string) {
  tokens(built, provider).set(`first-${subject}`, { providerSubject: subject, email: `${subject}@example.test` });
  const res = await signIn(built, provider, { idToken: `first-${subject}`, accountAgeConfirmation: DECLARATION });
  expect(res.status).toBe(200);
  return res.body.data as { token: string; refreshToken: string; user: { id: string } };
}

function expectNothingCreated(built: Built, before: { users: number; sessions: number }) {
  expect(built.userRepository.size).toBe(before.users);
  expect(built.sessionRepository.sessionCount).toBe(before.sessions);
}

describe.each<Provider>(['google', 'apple'])('%s sign-in: new accounts need the account-age declaration', (provider) => {
  it('1/2. a new account with a valid declaration is created and gets a session', async () => {
    const built = buildAccountTestApp();
    tokens(built, provider).set('new', { providerSubject: 'new-sub' });

    const res = await signIn(built, provider, { idToken: 'new', accountAgeConfirmation: DECLARATION });

    expect(res.status).toBe(200);
    expect(res.body.data.token).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user.provider).toBe(provider);
    expect(built.userRepository.size).toBe(1);
    expect(built.sessionRepository.sessionCount).toBe(1);
  });

  it('3/4/11. a new account WITHOUT the declaration is refused (403): no account, no session', async () => {
    const built = buildAccountTestApp();
    tokens(built, provider).set('new', { providerSubject: 'new-sub' });

    const res = await signIn(built, provider, { idToken: 'new' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, message: ACCOUNT_AGE_CONFIRMATION_REQUIRED_MESSAGE });
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });

  it('5. an unsupported policy version is refused for a new account (403), nothing created', async () => {
    const built = buildAccountTestApp();
    tokens(built, provider).set('new', { providerSubject: 'new-sub' });

    for (const policyVersion of [ACCOUNT_AGE_POLICY_VERSION + 1, 7, 999]) {
      const res = await signIn(built, provider, { idToken: 'new', accountAgeConfirmation: { policyVersion } });
      expect(res.status).toBe(403);
    }
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });

  it('5. a malformed declaration is rejected (400) before anything else happens', async () => {
    const built = buildAccountTestApp();
    tokens(built, provider).set('new', { providerSubject: 'new-sub' });

    const malformed: unknown[] = [
      true,
      'yes',
      1,
      null,
      [],
      {},
      { policyVersion: '1' },
      { policyVersion: 1.5 },
      { policyVersion: 0 },
      { policyVersion: -1 },
      { policyVersion: 1e9 },
      { policyVersion: 1, dateOfBirth: '2000-01-01' },
      { policyVersion: 1, age: 30 },
      { policyVersion: 1, confirmedAt: '2026-10-09T00:00:00.000Z' },
    ];
    for (const accountAgeConfirmation of malformed) {
      const res = await signIn(built, provider, { idToken: 'new', accountAgeConfirmation });
      expect(res.status, JSON.stringify(accountAgeConfirmation)).toBe(400);
    }
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });

  it('6/7/9. an EXISTING account signs in without the declaration: same account, no duplicate', async () => {
    const built = buildAccountTestApp();
    const first = await existingAccount(built, provider, 'returning');
    tokens(built, provider).set('again', { providerSubject: 'returning' });

    const res = await signIn(built, provider, { idToken: 'again' }); // what an older build sends

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(first.user.id);
    expect(built.userRepository.size).toBe(1);
    expect(built.sessionRepository.sessionCount).toBe(2);
  });

  it('6/7. an existing account with a declaration (updated build) is still the same account', async () => {
    const built = buildAccountTestApp();
    const first = await existingAccount(built, provider, 'returning');
    tokens(built, provider).set('again', { providerSubject: 'returning' });

    const res = await signIn(built, provider, { idToken: 'again', accountAgeConfirmation: DECLARATION });

    expect(res.body.data.user.id).toBe(first.user.id);
    expect(built.userRepository.size).toBe(1);
  });

  it('6/7. an existing account with an unsupported version still signs in (the version only gates creation)', async () => {
    const built = buildAccountTestApp();
    const first = await existingAccount(built, provider, 'returning');
    tokens(built, provider).set('again', { providerSubject: 'returning' });

    const res = await signIn(built, provider, { idToken: 'again', accountAgeConfirmation: { policyVersion: 7 } });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(first.user.id);
  });

  it('12. token verification still runs: an unverifiable token is 401 even with a declaration', async () => {
    const built = buildAccountTestApp();

    const res = await signIn(built, provider, { idToken: 'forged', accountAgeConfirmation: DECLARATION });

    expect(res.status).toBe(401);
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });

  it('12. a declaration never selects an account: identity still comes only from the verified token', async () => {
    const built = buildAccountTestApp();
    const victim = await existingAccount(built, provider, 'victim');
    tokens(built, provider).set('attacker', { providerSubject: 'attacker-sub' });

    const res = await signIn(built, provider, {
      idToken: 'attacker',
      accountAgeConfirmation: DECLARATION,
      userId: victim.user.id,
      providerSubject: 'victim',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).not.toBe(victim.user.id);
  });

  it('a different identity from the same provider is a NEW account and needs the declaration', async () => {
    const built = buildAccountTestApp();
    await existingAccount(built, provider, 'someone');
    tokens(built, provider).set('other', { providerSubject: 'someone-else' });

    expect((await signIn(built, provider, { idToken: 'other' })).status).toBe(403);
    expectNothingCreated(built, { users: 1, sessions: 1 });
  });
});

describe('cross-provider: an existing account never lets the other provider skip the declaration', () => {
  it('an existing Google account does not let the same email create an Apple account without a declaration', async () => {
    const built = buildAccountTestApp();
    await existingAccount(built, 'google', 'shared');
    built.appleTokens.set('apple-same-email', { providerSubject: 'apple-sub', email: 'shared@example.test' });

    expect((await signIn(built, 'apple', { idToken: 'apple-same-email' })).status).toBe(403);
    expectNothingCreated(built, { users: 1, sessions: 1 });
  });
});

describe('Apple: a refused new account never stores an Apple credential', () => {
  it('11. the authorization code is not exchanged when creation is refused', async () => {
    const built = buildAccountTestApp();
    built.appleTokens.set('new', { providerSubject: 'new-sub' });
    built.appleRevocationClient.codesToRefreshTokens.set('code', 'apple-refresh');

    const res = await signIn(built, 'apple', { idToken: 'new', authorizationCode: 'code' });

    expect(res.status).toBe(403);
    expect(built.appleRevocationClient.exchangedCodes).toEqual([]);
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });

  it('an existing Apple account without a declaration still captures its credential as before', async () => {
    const built = buildAccountTestApp();
    const first = await existingAccount(built, 'apple', 'apple-returning');
    built.appleTokens.set('again', { providerSubject: 'apple-returning' });
    built.appleRevocationClient.codesToRefreshTokens.set('code', 'apple-refresh');

    const res = await signIn(built, 'apple', { idToken: 'again', authorizationCode: 'code' });

    expect(res.status).toBe(200);
    expect(await built.appleCredentialRepository.get(first.user.id)).toBe('apple-refresh');
  });
});

describe('existing sessions are untouched by the declaration requirement', () => {
  it('8. session restoration (GET /api/auth/session) works with no declaration anywhere', async () => {
    const built = buildAccountTestApp();
    const account = await existingAccount(built, 'google', 'restore');

    const res = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${account.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(account.user.id);
  });

  it('9. refresh-token rotation is unchanged (and creates no account)', async () => {
    const built = buildAccountTestApp();
    const account = await existingAccount(built, 'google', 'refresh');

    const rotated = await request(built.app).post('/api/auth/refresh').send({ refreshToken: account.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(account.refreshToken);

    const restored = await request(built.app).get('/api/auth/session').set('Authorization', `Bearer ${rotated.body.data.token}`);
    expect(restored.body.data.id).toBe(account.user.id);
    expect(built.userRepository.size).toBe(1);
  });

  it.each<Provider>(['google', 'apple'])('10. %s re-authentication for account deletion needs no declaration', async (provider) => {
    const built = buildAccountTestApp();
    const account = await existingAccount(built, provider, `del-${provider}`);
    tokens(built, provider).set('fresh', { providerSubject: `del-${provider}` });
    if (provider === 'apple') built.appleRevocationClient.codesToRefreshTokens.set('fresh-code', 'apple-refresh');

    const res = await request(built.app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ provider, idToken: 'fresh', ...(provider === 'apple' ? { authorizationCode: 'fresh-code' } : {}) });

    expect(res.status).toBe(200);
    expect(built.userRepository.size).toBe(0);
  });

  it('a deleted account signing in again from an older build is not silently re-created', async () => {
    const built = buildAccountTestApp();
    const account = await existingAccount(built, 'google', 'gone');
    built.googleTokens.set('fresh', { providerSubject: 'gone' });
    const deleted = await request(built.app)
      .delete('/api/account')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ provider: 'google', idToken: 'fresh' });
    expect(deleted.status).toBe(200);

    built.googleTokens.set('back', { providerSubject: 'gone' });
    expect((await signIn(built, 'google', { idToken: 'back' })).status).toBe(403);
    expect(built.userRepository.size).toBe(0);
  });
});

describe('13. no other route creates an account', () => {
  const SRC = join(__dirname, '../../src');
  const relative = (file: string) => file.replace(/\\/g, '/').split('/src/')[1];
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      // Operator scripts and seeds never run in the API process.
      if (statSync(path).isDirectory()) return name === 'scripts' || name === 'seed' ? [] : sourceFiles(path);
      return path.endsWith('.ts') ? [path] : [];
    });
  }

  it('findOrCreateByProviderIdentity is only called from authController, behind the declaration check', () => {
    const callers = sourceFiles(SRC).filter((file) => /\.findOrCreateByProviderIdentity\(/.test(readFileSync(file, 'utf8')));
    expect(callers.map(relative)).toEqual(['controllers/authController.ts']);

    const controller = readFileSync(join(SRC, 'controllers/authController.ts'), 'utf8');
    expect(controller.match(/\.findOrCreateByProviderIdentity\(/g)).toHaveLength(1);
    expect(controller).toMatch(/if \(hasCurrentAgeDeclaration\(declaration\)\) \{\s*return userRepository\.findOrCreateByProviderIdentity\(identity\);/);
  });

  it('the only code that can insert a User is MongooseUserRepository', () => {
    const userWriters = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        /UserModel\.(create|insertMany|bulkWrite|updateOne|updateMany|replaceOne)\(|new UserModel\(/.test(text) ||
        (/UserModel\.findOneAndUpdate\(/.test(text) && /upsert: true/.test(text))
      );
    });
    expect(userWriters.map(relative)).toEqual(['services/MongooseUserRepository.ts']);
  });

  it('a verified identity with no declaration cannot create an account through any other endpoint or header', async () => {
    const built = buildAccountTestApp();
    built.googleTokens.set('new', { providerSubject: 'new-sub' });
    built.appleTokens.set('new', { providerSubject: 'new-sub' });
    const attempts = [
      request(built.app).post('/api/auth/refresh').send({ refreshToken: 'x.y' }),
      request(built.app).get('/api/auth/session').set('Authorization', 'Bearer forged'),
      request(built.app).delete('/api/account').send({ provider: 'google', idToken: 'new' }),
      request(built.app).post('/api/sync/reflections/reset').send({ provider: 'apple', idToken: 'new' }),
      request(built.app).put('/api/sync/favorites').send({ verseKeys: ['1:1'] }),
      request(built.app).put('/api/sync/key').send({}),
      request(built.app).put('/api/auth/google').send({ idToken: 'new' }),
      request(built.app).post('/api/auth/google').set('User-Agent', 'QuranHeals/0.0.1 (legacy)').send({ idToken: 'new' }),
      request(built.app).post('/api/auth/apple').set('X-App-Version', '0.0.1').send({ idToken: 'new' }),
    ];
    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    // Logout always answers 200 by design; it still creates nothing.
    expect((await request(built.app).post('/api/auth/logout').send({})).status).toBe(200);
    expectNothingCreated(built, { users: 0, sessions: 0 });
  });
});

describe('14. nothing age-related is stored', () => {
  it('the User model has no date-of-birth, age or declaration field', () => {
    const paths = Object.keys(UserModel.schema.paths).map((path) => path.toLowerCase());
    for (const forbidden of ['birth', 'dob', 'age', 'declaration', 'confirm', 'policyversion']) {
      expect(paths.filter((path) => path.includes(forbidden))).toEqual([]);
    }
  });

  it('a created account holds only identity fields; the declaration is neither echoed nor kept', async () => {
    const built = buildAccountTestApp();
    built.googleTokens.set('new', { providerSubject: 'new-sub' });

    const res = await signIn(built, 'google', { idToken: 'new', accountAgeConfirmation: DECLARATION });
    const stored = await built.userRepository.findById(res.body.data.user.id);

    expect(Object.keys(res.body.data.user).sort()).toEqual(['createdAt', 'id', 'provider']);
    expect(Object.keys(stored ?? {}).sort()).toEqual(['createdAt', 'email', 'id', 'provider']);
    expect(JSON.stringify(res.body)).not.toMatch(/policyVersion|accountAgeConfirmation/);
  });
});
