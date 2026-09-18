import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { buildAccountTestApp } from './testApp';
import { MongooseSyncRepository } from '../../src/services/MongooseSyncRepository';
import { UserSyncKeyModel } from '../../src/models/UserSyncKey';

const oldKey = { wrappedKey: 'old-ciphertext', nonce: 'old-nonce', salt: 'old-salt', kdfIterations: 210000, encryptionVersion: 1 };
const newKey = { ...oldKey, wrappedKey: 'new-ciphertext', nonce: 'new-nonce', salt: 'new-salt', encryptionVersion: 2 };

async function setup() {
  const context = buildAccountTestApp();
  context.googleTokens.set('google-token', { providerSubject: 'user-1' });
  const login = await request(context.app).post('/api/auth/google').send({ idToken: 'google-token' });
  const token = login.body.data.token as string;
  await request(context.app).put('/api/sync/key').set('Authorization', `Bearer ${token}`).send(oldKey);
  return { ...context, token };
}

describe('atomic sync password replacement', () => {
  it('requires a session', async () => {
    const { app } = buildAccountTestApp();
    expect((await request(app).patch('/api/sync/key').send({ expected: oldKey, replacement: newKey })).status).toBe(401);
  });

  it('replaces the complete wrapper, rejects stale writes, and preserves existing sessions', async () => {
    const { app, token } = await setup();
    const replace = () => request(app).patch('/api/sync/key').set('Authorization', `Bearer ${token}`).send({ expected: oldKey, replacement: newKey });
    expect((await replace()).body.data).toEqual(newKey);
    expect((await replace()).status).toBe(409);
    const saved = await request(app).get('/api/sync/key').set('Authorization', `Bearer ${token}`);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual(newKey);
  });

  it('two competing writes have exactly one winner', async () => {
    const { app, token } = await setup();
    const results = await Promise.all([newKey, { ...newKey, nonce: 'another' }].map(replacement =>
      request(app).patch('/api/sync/key').set('Authorization', `Bearer ${token}`).send({ expected: oldKey, replacement })));
    expect(results.map(result => result.status).sort()).toEqual([200, 409]);
  });

  it('validates the entire replacement before touching the old wrapper', async () => {
    const { app, token } = await setup();
    const invalid = await request(app).patch('/api/sync/key').set('Authorization', `Bearer ${token}`)
      .send({ expected: oldKey, replacement: { ...newKey, salt: '', kdfIterations: 1 } });
    expect(invalid.status).toBe(400);
    expect((await request(app).get('/api/sync/key').set('Authorization', `Bearer ${token}`)).body.data).toEqual(oldKey);
  });

  it('a database failure leaves the valid old wrapper in place', async () => {
    const { app, token, syncRepository } = await setup();
    vi.spyOn(syncRepository, 'replaceSyncKey').mockRejectedValueOnce(new Error('Storage failed'));
    expect((await request(app).patch('/api/sync/key').set('Authorization', `Bearer ${token}`)
      .send({ expected: oldKey, replacement: newKey })).status).toBe(500);
    expect((await request(app).get('/api/sync/key').set('Authorization', `Bearer ${token}`)).body.data).toEqual(oldKey);
  });

  it('cannot replace another account key using a caller-supplied user ID', async () => {
    const { app, token, googleTokens } = await setup();
    googleTokens.set('other-token', { providerSubject: 'user-2' });
    const login = await request(app).post('/api/auth/google').send({ idToken: 'other-token' });
    const otherToken = login.body.data.token as string;
    expect((await request(app).patch('/api/sync/key').set('Authorization', `Bearer ${otherToken}`)
      .send({ expected: oldKey, replacement: newKey })).status).toBe(409);
    expect((await request(app).get('/api/sync/key').set('Authorization', `Bearer ${token}`)).body.data).toEqual(oldKey);
  });

  it('production persistence uses one conditional majority-acknowledged update without upsert/delete', async () => {
    const lean = vi.fn().mockResolvedValue(newKey);
    const update = vi.spyOn(UserSyncKeyModel, 'findOneAndUpdate').mockReturnValue({ lean } as never);
    const repository = new MongooseSyncRepository();
    expect(await repository.replaceSyncKey('user-1', oldKey, newKey)).toEqual(newKey);
    expect(update).toHaveBeenCalledExactlyOnceWith(
      { userId: 'user-1', ...oldKey }, { $set: newKey },
      { new: true, runValidators: true, writeConcern: { w: 'majority' } },
    );
    lean.mockResolvedValueOnce(null);
    expect(await repository.replaceSyncKey('user-1', oldKey, newKey)).toBeNull();
  });
});
