import { MongoNetworkError, MongoNetworkTimeoutError, MongoParseError, MongoServerError, MongoServerSelectionError } from 'mongodb';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';

import { classifyMongoFailure, describeMongoFailure } from '../../src/config/mongoFailure';

/**
 * The audit script's failure line must say WHY a run failed (step + kind)
 * without ever echoing the driver message, which can contain the host, user,
 * password or command. Errors are built with the real driver classes and
 * messages that deliberately contain such secrets.
 */

const HOST = 'cluster0-shard-00-01.abcd1.mongodb.net';
const USER = 'quranheals-prod-audit';
const PASSWORD = 'Sup3r$ecret';
const SECRETS = [HOST, 'abcd1', USER, PASSWORD, 'mongodb+srv://', 'quranheals_prod', 'emotionversemappings'];

function expectNoSecrets(line: string) {
  for (const secret of SECRETS) expect(line).not.toContain(secret);
}

const withCause = <T extends Error>(error: T, cause: object): T => Object.assign(error, { cause });

describe('classifyMongoFailure', () => {
  it.each([
    ['authentication (bad password / user)', new MongoServerError({ message: `bad auth : authentication failed for ${USER}@${HOST}`, code: 18, codeName: 'AuthenticationFailed' }), 'authentication'],
    ['authorization (privilege too narrow, e.g. collection-specific)', new MongoServerError({ message: `user is not allowed to do action [find] on [quranheals_prod.emotionversemappings]`, code: 13, codeName: 'Unauthorized' }), 'authorization'],
    ['connection string (unencoded special characters)', new MongoParseError(`Password contains unescaped characters: mongodb+srv://${USER}:${PASSWORD}@${HOST}`), 'connection-string'],
    ['server selection timeout (IP access list / firewall)', new MongoServerSelectionError(`Server selection timed out after 10000 ms connecting to ${HOST}:27017`, {} as never), 'network'],
    ['socket error', new MongoNetworkError(`connection 1 to ${HOST}:27017 closed`), 'network'],
    ['socket timeout', new MongoNetworkTimeoutError(`connection timed out to ${HOST}`), 'network'],
    ['DNS (SRV lookup)', Object.assign(new Error(`querySrv ENOTFOUND _mongodb._tcp.${HOST}`), { code: 'ENOTFOUND' }), 'network'],
    ['wrapped socket refusal', withCause(new MongoNetworkError(`failed to connect to ${HOST}`), { code: 'ECONNREFUSED', message: `connect ECONNREFUSED ${HOST}` }), 'network'],
    ['TLS', withCause(new MongoNetworkError(`TLS handshake to ${HOST} failed`), { code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' }), 'tls'],
    ['other query failure', new MongoServerError({ message: `PlanExecutor error on ${HOST}`, code: 292, codeName: 'QueryExceededMemoryLimitNoDiskUseAllowed' }), 'query'],
    ['unknown', new Error(`something odd at ${HOST}`), 'unknown'],
  ] as const)('%s', (_label, error, kind) => {
    expect(classifyMongoFailure(error).kind).toBe(kind);
  });

  it('recognises the Mongoose wrapper (what scripts actually receive from mongoose.connect)', () => {
    const error = new mongoose.Error.MongooseServerSelectionError(`Could not connect to any servers in your MongoDB Atlas cluster: ${HOST}`);
    expect(classifyMongoFailure(error).kind).toBe('network');
  });

  it("reads each server's last error inside a selection error (login failure, refused socket, TLS)", () => {
    const selection = (serverError: object) =>
      Object.assign(new mongoose.Error.MongooseServerSelectionError(`selection failed for ${HOST}`), { reason: { servers: new Map([[`${HOST}:27017`, { error: serverError }]]) } });
    expect(classifyMongoFailure(selection({ name: 'MongoServerError', code: 18, codeName: 'AuthenticationFailed', message: `bad auth ${USER}` })).kind).toBe('authentication');
    expect(classifyMongoFailure(selection({ name: 'MongoNetworkError', cause: { code: 'CERT_HAS_EXPIRED' } })).kind).toBe('tls');
    const refused = classifyMongoFailure(selection({ name: 'MongoNetworkError', cause: { code: 'ECONNREFUSED', message: `connect ECONNREFUSED ${HOST}` } }));
    expect(refused.kind).toBe('network');
    expect(refused.identifiers).toContain('code ECONNREFUSED');
    expectNoSecrets(refused.identifiers);
  });

  it('a cyclic error structure cannot hang the classifier', () => {
    const error: Record<string, unknown> = { name: 'MongoNetworkError' };
    error.cause = error;
    expect(classifyMongoFailure(error).kind).toBe('network');
  });

  it('authentication wins even when wrapped in a selection error', () => {
    const error = withCause(new MongoServerSelectionError(`selection failed for ${HOST}`, {} as never), { name: 'MongoServerError', code: 18, codeName: 'AuthenticationFailed' });
    expect(classifyMongoFailure(error).kind).toBe('authentication');
  });

  it('never reports a non-identifier string as an identifier', () => {
    const error = Object.assign(new Error('x'), { name: `Mongo ${HOST} Error`, code: `bad code ${PASSWORD}`, codeName: `Unauthorized on ${HOST}` });
    const { identifiers } = classifyMongoFailure(error);
    expectNoSecrets(identifiers);
    expect(identifiers).toBe('no identifiers');
  });
});

describe('describeMongoFailure', () => {
  it('names the failing step, the kind and safe identifiers, and points to the fix', () => {
    const line = describeMongoFailure('read emotions (find)', new MongoServerError({ message: `not authorized on quranheals_prod to execute command { find: "emotions" } as ${USER}`, code: 13, codeName: 'Unauthorized' }));
    expect(line).toMatch(/^failed during read emotions \(find\): authorization error \(MongoServerError, code 13, Unauthorized\) — /);
    expect(line).toMatch(/collection field left EMPTY/);
    expectNoSecrets(line.replace('`quranheals_prod`', '')); // the hint names the expected database, never the actual target
  });

  it.each([
    new MongoServerError({ message: `bad auth : authentication failed (user ${USER}, password ${PASSWORD}) on ${HOST}`, code: 18, codeName: 'AuthenticationFailed' }),
    new MongoParseError(`Invalid URI mongodb+srv://${USER}:${PASSWORD}@${HOST}/quranheals_prod`),
    new MongoServerSelectionError(`connect ETIMEDOUT ${HOST}:27017`, {} as never),
    Object.assign(new Error(`querySrv ENOTFOUND _mongodb._tcp.${HOST}`), { code: 'ENOTFOUND' }),
  ])('never includes the host, user, password or connection string (%#)', (error) => {
    expectNoSecrets(describeMongoFailure('connect + credential check', error).replace(/`quranheals_prod`/g, ''));
  });
});
