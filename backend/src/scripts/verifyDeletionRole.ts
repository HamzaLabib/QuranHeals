/**
 * Development-only check that a restricted MongoDB user is exactly the
 * deletion-only role the admin deletion tool expects
 * (`npm run account:verify-deletion-role`, loaded with the development-delete
 * env profile; docs/account-deletion-requests.md).
 *
 * It refuses, before connecting, anything but the development database
 * `quranheals_dev` under QURAN_HEALS_ADMIN_PROFILE=development-delete with
 * QURAN_HEALS_SKIP_DOTENV=1. Then it:
 *   1. runs the tool's own strict credential check while connecting, and
 *      inspects the user's privileges (find + remove on exactly the eight
 *      account collections; no insert, update, index or collection actions,
 *      no database-wide remove);
 *   2. reads document COUNTS of the eight collections (numbers only);
 *   3. checks reads and deletes are allowed using ids that cannot exist;
 *   4. checks forbidden operations are refused, using requests that cannot
 *      change data even if they were wrongly allowed (an id that cannot
 *      exist, a document the server must reject, an invalid index type);
 *   5. runs the real deletion transaction (MongooseAccountDeletionService)
 *      for a freshly generated account id that owns no records, and checks
 *      no collection's count went down.
 * It stops at the first operation that is unexpectedly permitted.
 *
 * Output: step names, PASS/FAIL/STOP, counts, action and collection names,
 * MongoDB error code names. Never a connection string, password, email,
 * token, error message or document.
 */
import mongoose from 'mongoose';

import { DELETION_COLLECTIONS } from '../admin/adminAccountDeletion';
import { connectScriptDatabase, disconnectFromDatabase, getDatabaseTarget } from '../config/database';
import { assessCredentialScope, credentialScopeProblems, deletionScopeProblems, isRecognizedPrivilege, type MongoPrivilege } from '../config/credentialScope';
import { DEVELOPMENT_DATABASE, type DatabaseTarget, type ScriptAccess } from '../config/databaseTarget';
import { describeError } from '../monitoring/monitoring';
import { MongooseAccountDeletionService } from '../services/MongooseAccountDeletionService';

export const SCRIPT_NAME = 'account:verify-deletion-role';
export const REQUIRED_PROFILE = 'development-delete';

/** A collection the role must NOT be able to delete from (global Quran content). */
export const FORBIDDEN_COLLECTION = 'emotions';
/** Account collections (all but issuereports) that the deletion transaction touches, and their user-id field. */
const ACCOUNT_OWNERSHIP: readonly { collection: string; field: '_id' | 'userId' }[] = [
  { collection: 'users', field: '_id' },
  { collection: 'sessions', field: 'userId' },
  { collection: 'userfavorites', field: 'userId' },
  { collection: 'userpreferences', field: 'userId' },
  { collection: 'userreflections', field: 'userId' },
  { collection: 'usersynckeys', field: 'userId' },
  { collection: 'applecredentials', field: 'userId' },
];

export class VerificationRefused extends Error {}

/**
 * Everything checkable before connecting: development target named exactly
 * quranheals_dev, the development-delete profile, and no backend/.env.
 */
export function assertVerificationTarget(target: DatabaseTarget, environment: Record<string, string | undefined>): void {
  if (target.environment !== 'development' || target.databaseName !== DEVELOPMENT_DATABASE) {
    throw new VerificationRefused(`${SCRIPT_NAME} runs only against ${DEVELOPMENT_DATABASE} (got environment=${target.environment} database=${target.databaseName}). Nothing was read or changed.`);
  }
  if (environment.QURAN_HEALS_ADMIN_PROFILE !== REQUIRED_PROFILE) {
    throw new VerificationRefused(`${SCRIPT_NAME} requires QURAN_HEALS_ADMIN_PROFILE=${REQUIRED_PROFILE} (got ${environment.QURAN_HEALS_ADMIN_PROFILE ?? 'none'}). Nothing was read or changed.`);
  }
  if (environment.QURAN_HEALS_SKIP_DOTENV !== '1') {
    throw new VerificationRefused(`${SCRIPT_NAME} must be run with an env profile that sets QURAN_HEALS_SKIP_DOTENV=1 (never backend/.env). Nothing was read or changed.`);
  }
}

/** The access the deletion tool itself uses under development-delete: strict, deletion-only, fatal on any problem. */
export function verificationAccess(): ScriptAccess {
  return {
    script: SCRIPT_NAME,
    writes: true,
    productionSupported: false,
    enforceCredentialScope: true,
    strictCredentialScope: true,
    deletionOnlyCollections: DELETION_COLLECTIONS,
  };
}

/** Outcome of one attempted operation. `code` is a MongoDB code name only, never a message. */
export type Attempt = { outcome: 'allowed'; changed: number } | { outcome: 'denied' } | { outcome: 'error'; code: string };

export interface RoleProbe {
  /** As reported by MongoDB; undefined when no list was reported (the checks then fail closed). */
  privileges(): Promise<MongoPrivilege[] | undefined>;
  count(collection: string): Promise<number>;
  countOwnedBy(collection: string, field: '_id' | 'userId', userId: string): Promise<number>;
  tryFind(collection: string, id: string): Promise<Attempt>;
  tryUpdate(collection: string, id: string): Promise<Attempt>;
  /** Inserts a document the server must reject (array _id), so nothing can be stored even if insert were permitted. */
  tryInsertRejectedDocument(collection: string): Promise<Attempt>;
  /** Requests an index with an invalid type, so nothing can be built even if index creation were permitted. */
  tryCreateInvalidIndex(collection: string): Promise<Attempt>;
  tryDelete(collection: string, id: string): Promise<Attempt>;
  runDeletionTransaction(userId: string): Promise<Attempt>;
  newId(): string;
}

export type StepStatus = 'PASS' | 'FAIL' | 'STOP';
export type StepResult = { step: string; status: StepStatus; detail: string };
export type VerificationReport = { ok: boolean; stopped: boolean; results: StepResult[] };

function describeAttempt(attempt: Attempt): string {
  if (attempt.outcome === 'allowed') return `allowed (changed ${attempt.changed})`;
  if (attempt.outcome === 'denied') return 'denied (Unauthorized)';
  return `error (${attempt.code})`;
}

/** The privileges the user holds on `target`, as "collection: actions" lines (names only). */
export function summarizePrivileges(target: DatabaseTarget, privileges: MongoPrivilege[] | undefined): string[] {
  const byCollection = new Map<string, Set<string>>();
  for (const entry of (Array.isArray(privileges) ? privileges : []) as unknown[]) {
    if (!isRecognizedPrivilege(entry)) continue;
    const { resource, actions } = entry;
    if (resource.cluster) continue;
    const label = resource.anyResource || resource.db === '' ? '*any database*' : resource.db === target.databaseName ? resource.collection || '*whole database*' : null;
    if (!label) continue;
    const set = byCollection.get(label) ?? new Set<string>();
    actions.forEach((action) => set.add(action));
    byCollection.set(label, set);
  }
  return [...byCollection].sort(([a], [b]) => a.localeCompare(b)).map(([collection, actions]) => `${collection}: ${[...actions].sort().join(', ')}`);
}

/**
 * The checks themselves, against any RoleProbe. Stops at the first
 * operation that is unexpectedly permitted (STOP) and at a failed privilege
 * check (no live probing of a role already known to be wrong).
 */
export async function verifyDeletionRole(probe: RoleProbe, target: DatabaseTarget): Promise<VerificationReport> {
  const results: StepResult[] = [];
  const report = (step: string, status: StepStatus, detail: string) => results.push({ step, status, detail });
  const finish = (stopped: boolean): VerificationReport => ({ ok: !stopped && results.every((r) => r.status === 'PASS'), stopped, results });

  try {
    return await runSteps(probe, target, report, finish);
  } catch (error) {
    // Anything thrown that a step did not classify (network loss, driver
    // error, …) stops the run; never counted as enforcement. Name/code only.
    report('unexpected error', 'STOP', `${safeErrorName(error)}; the run was stopped and nothing further was attempted`);
    return finish(true);
  }
}

function safeErrorName(error: unknown): string {
  const { name, code, codeName } = (error ?? {}) as { name?: unknown; code?: unknown; codeName?: unknown };
  const label = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : null);
  return [label(name) ?? 'Error', label(codeName) ?? (typeof code === 'number' ? `code ${code}` : null)].filter(Boolean).join(' ');
}

async function runSteps(
  probe: RoleProbe,
  target: DatabaseTarget,
  report: (step: string, status: StepStatus, detail: string) => void,
  finish: (stopped: boolean) => VerificationReport,
): Promise<VerificationReport> {
  // 1. Privileges.
  const privileges = await probe.privileges();
  const problems = [
    ...credentialScopeProblems(target, assessCredentialScope(target, privileges)),
    ...deletionScopeProblems(target, privileges, DELETION_COLLECTIONS),
  ];
  const summary = summarizePrivileges(target, privileges).join('; ') || 'no privileges reported on this database';
  if (problems.length > 0) {
    report('privileges', 'FAIL', `${problems.join('; ')}. Reported: ${summary}`);
    return finish(true);
  }
  report('privileges', 'PASS', `find + remove on exactly the ${DELETION_COLLECTIONS.length} account collections; nothing else writes. Reported: ${summary}`);

  // 2. Counts (numbers only).
  const before = new Map<string, number>();
  for (const collection of DELETION_COLLECTIONS) {
    try {
      before.set(collection, await probe.count(collection));
    } catch {
      report(`count ${collection}`, 'FAIL', 'counting was refused or failed');
      return finish(true);
    }
  }
  report('counts', 'PASS', [...before].map(([c, n]) => `${c}=${n}`).join(', '));

  // 3. Permitted operations, with ids that cannot exist.
  for (const collection of DELETION_COLLECTIONS) {
    const find = await probe.tryFind(collection, probe.newId());
    if (find.outcome !== 'allowed') {
      report(`find ${collection}`, 'FAIL', `expected allowed, got ${describeAttempt(find)}`);
      return finish(true);
    }
    const remove = await probe.tryDelete(collection, probe.newId());
    if (remove.outcome !== 'allowed') {
      report(`remove ${collection}`, 'FAIL', `expected allowed, got ${describeAttempt(remove)}`);
      return finish(true);
    }
    if (remove.changed !== 0) {
      report(`remove ${collection}`, 'STOP', `a delete by a freshly generated id removed ${remove.changed} document(s); investigate before anything else`);
      return finish(true);
    }
  }
  report('permitted operations', 'PASS', `find and remove allowed on all ${DELETION_COLLECTIONS.length} collections (ids that cannot exist; 0 changed)`);

  // 4. Forbidden operations: each must be refused with Unauthorized.
  const forbidden: [string, () => Promise<Attempt>][] = [
    ['update users', () => probe.tryUpdate('users', probe.newId())],
    ['insert users', () => probe.tryInsertRejectedDocument('users')],
    ['create index users', () => probe.tryCreateInvalidIndex('users')],
    [`remove ${FORBIDDEN_COLLECTION}`, () => probe.tryDelete(FORBIDDEN_COLLECTION, probe.newId())],
  ];
  for (const [step, attempt] of forbidden) {
    const result = await attempt();
    if (result.outcome !== 'denied') {
      report(step, 'STOP', `expected denied (Unauthorized), got ${describeAttempt(result)}: the role permits an operation it must not. No data was changed by this check; stopping.`);
      return finish(true);
    }
    report(step, 'PASS', 'denied (Unauthorized)');
  }

  // 5. The real deletion transaction, for an account id that owns nothing.
  const syntheticUserId = probe.newId();
  for (const { collection, field } of ACCOUNT_OWNERSHIP) {
    if ((await probe.countOwnedBy(collection, field, syntheticUserId)) !== 0) {
      report('deletion transaction', 'STOP', `the generated id unexpectedly owns records in ${collection}; not running the transaction`);
      return finish(true);
    }
  }
  const transaction = await probe.runDeletionTransaction(syntheticUserId);
  if (transaction.outcome !== 'allowed') {
    report('deletion transaction', 'FAIL', `expected to run, got ${describeAttempt(transaction)}`);
    return finish(true);
  }
  const decreased: string[] = [];
  for (const collection of DELETION_COLLECTIONS) {
    const after = await probe.count(collection);
    if (after < (before.get(collection) ?? 0)) decreased.push(`${collection} ${before.get(collection)}→${after}`);
  }
  if (decreased.length > 0) {
    report('deletion transaction', 'STOP', `counts went down after deleting a nonexistent account: ${decreased.join(', ')}. Investigate (other activity on the development database?)`);
    return finish(true);
  }
  report('deletion transaction', 'PASS', 'MongooseAccountDeletionService ran under this role for a nonexistent account id; no collection count went down');

  return finish(false);
}

const UNAUTHORIZED = 13;
const ATLAS_ERROR = 8000;
/**
 * The Atlas shared-tier authorization refusal, in full: "user is not
 * allowed to do action [<action>] on [<db>.<collection>]". Anchored at both
 * ends so a longer or different code-8000 message never matches.
 */
const ATLAS_DENIAL = /^user is not allowed to do action \[([A-Za-z]{1,64})\] on \[([A-Za-z0-9_$-]{1,64})\.([A-Za-z0-9_.$-]{1,128})\]\.?$/;

/** What an attempted operation was, so a refusal can be tied to it. `collection: null` means any collection of `db`. */
export type ExpectedAction = { action: string; db: string; collection: string | null };

/**
 * Whether `error` is the server refusing exactly this operation for lack of
 * privilege: MongoDB's Unauthorized (code 13), or Atlas's code 8000 whose
 * message names this action on this namespace. Any other error — network,
 * timeout, malformed request, invalid document, validation, a code-8000
 * error about something else (quota, limits, a different action or
 * namespace) — is NOT a refusal. The message is only matched, never kept.
 */
export function isAuthorizationDenial(error: unknown, expected: ExpectedAction): boolean {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (code === UNAUTHORIZED) return true;
  if (code !== ATLAS_ERROR || typeof message !== 'string') return false;
  const match = ATLAS_DENIAL.exec(message.trim());
  if (!match) return false;
  const [, action, db, collection] = match;
  return action === expected.action && db === expected.db && (expected.collection === null || collection === expected.collection);
}

/** Maps a driver error to an Attempt: a denial only per isAuthorizationDenial; otherwise a code NAME, never a message. */
export function classifyAttemptError(error: unknown, expected: ExpectedAction): Attempt {
  if (isAuthorizationDenial(error, expected)) return { outcome: 'denied' };
  const { code, codeName, name } = (error ?? {}) as { code?: unknown; codeName?: unknown; name?: unknown };
  const label = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(value) ? value : null);
  return { outcome: 'error', code: label(codeName) ?? (typeof code === 'number' ? `code ${code}` : label(name) ?? 'unknown') };
}

async function attempt(expected: ExpectedAction, operation: () => Promise<number>): Promise<Attempt> {
  try {
    return { outcome: 'allowed', changed: await operation() };
  } catch (error) {
    return classifyAttemptError(error, expected);
  }
}

/** The live probe: raw driver collections on the connected development database. */
export class MongoRoleProbe implements RoleProbe {
  private get db() {
    return mongoose.connection.db!;
  }

  private expect(action: string, collection: string | null): ExpectedAction {
    return { action, db: this.db.databaseName, collection };
  }

  newId(): string {
    return new mongoose.Types.ObjectId().toHexString();
  }

  private idFilter(id: string) {
    return { _id: new mongoose.Types.ObjectId(id) };
  }

  async privileges(): Promise<MongoPrivilege[] | undefined> {
    const status = (await this.db.command({ connectionStatus: 1, showPrivileges: true })) as { authInfo?: { authenticatedUserPrivileges?: MongoPrivilege[] } };
    // As reported (possibly missing): the checks fail closed on a missing list.
    return status.authInfo?.authenticatedUserPrivileges;
  }

  async count(collection: string): Promise<number> {
    return this.db.collection(collection).countDocuments({});
  }

  async countOwnedBy(collection: string, field: '_id' | 'userId', userId: string): Promise<number> {
    return this.db.collection(collection).countDocuments(field === '_id' ? this.idFilter(userId) : { userId });
  }

  tryFind(collection: string, id: string): Promise<Attempt> {
    return attempt(this.expect('find', collection), async () => {
      await this.db.collection(collection).findOne(this.idFilter(id), { projection: { _id: 1 } });
      return 0;
    });
  }

  tryUpdate(collection: string, id: string): Promise<Attempt> {
    return attempt(this.expect('update', collection), async () =>
      (await this.db.collection(collection).updateOne(this.idFilter(id), { $set: { qhRoleProbe: true } }, { upsert: false })).modifiedCount);
  }

  tryInsertRejectedDocument(collection: string): Promise<Attempt> {
    // MongoDB never stores a document whose _id is an array.
    return attempt(this.expect('insert', collection), async () =>
      ((await this.db.collection(collection).insertOne({ _id: [1, 2] } as never)).acknowledged ? 1 : 0));
  }

  tryCreateInvalidIndex(collection: string): Promise<Attempt> {
    // "qh-invalid-type" is not an index type, so no index can be built.
    return attempt(this.expect('createIndex', collection), async () => {
      await this.db.collection(collection).createIndex({ qhRoleProbe: 'qh-invalid-type' } as never, { name: 'qh_role_probe_invalid' });
      return 1;
    });
  }

  tryDelete(collection: string, id: string): Promise<Attempt> {
    return attempt(this.expect('remove', collection), async () => (await this.db.collection(collection).deleteOne(this.idFilter(id))).deletedCount);
  }

  runDeletionTransaction(userId: string): Promise<Attempt> {
    // A refusal of any account collection's remove counts as denied (still a FAIL for this step).
    return attempt(this.expect('remove', null), async () => {
      await new MongooseAccountDeletionService().deleteAccount(userId);
      return 0;
    });
  }
}

export function formatReport(report: VerificationReport): string {
  const lines = report.results.map((r) => `${r.status.padEnd(4)} ${r.step}: ${r.detail}`);
  const verdict = report.ok
    ? 'RESULT: the role is exactly the deletion-only role the tool expects.'
    : report.stopped && report.results.some((r) => r.status === 'STOP')
      ? 'RESULT: STOPPED — an operation was unexpectedly permitted or data changed. Do not use this role; report it.'
      : 'RESULT: FAILED — the role does not match. Do not use it for deletion.';
  return [...lines, verdict].join('\n');
}

export async function runVerifyDeletionRole(environment: Record<string, string | undefined> = process.env): Promise<VerificationReport> {
  assertVerificationTarget(getDatabaseTarget(), environment);
  // The tool's own strict development-delete check runs while connecting; a mismatch refuses here.
  const target = await connectScriptDatabase(verificationAccess(), { autoIndex: false, autoCreate: false });
  try {
    assertVerificationTarget(target, environment);
    return await verifyDeletionRole(new MongoRoleProbe(), target);
  } finally {
    await disconnectFromDatabase();
  }
}

if (require.main === module) {
  runVerifyDeletionRole()
    .then((report) => {
      console.log(formatReport(report));
      process.exitCode = report.ok ? 0 : report.results.some((r) => r.status === 'STOP') ? 2 : 1;
    })
    .catch((error) => {
      // Refusals carry a safe message; anything else is scrubbed (never a URI, email or token).
      console.error(error instanceof VerificationRefused ? error.message : `${SCRIPT_NAME} failed: ${describeError(error)}`);
      process.exitCode = 1;
    });
}
