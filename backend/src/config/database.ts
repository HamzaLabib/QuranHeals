import mongoose, { type ConnectOptions } from 'mongoose';

import { assessCredentialScope, credentialScopeProblems, deletionScopeProblems, ENFORCE_CREDENTIAL_SCOPE_ENV, exactScopeProblems, type ExactPrivileges, type MongoPrivilege } from './credentialScope';
import {
  assertScriptMayUseTarget,
  DatabaseConfigError,
  describeTarget,
  resolveDatabaseTarget,
  type DatabaseTarget,
  type ScriptAccess,
} from './databaseTarget';
import { env } from './env';

/** The validated database for this process (see config/databaseTarget.ts). Throws DatabaseConfigError. */
export function getDatabaseTarget(): DatabaseTarget {
  return resolveDatabaseTarget({ nodeEnv: env.NODE_ENV, uri: env.MONGODB_URI, dbName: env.MONGODB_DB_NAME });
}

const CREDENTIAL_SCOPE_TIMEOUT_MS = 5000;

/** Rejects if `promise` takes longer than `ms`, so a stalled check can never hang startup. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Least-privilege check of the connected credential (config/credentialScope.ts).
 * A warning by default, so existing deployments keep running during the
 * credential migration; fatal when MONGODB_ENFORCE_CREDENTIAL_SCOPE=true.
 * Messages name databases only.
 */
type ScopeCheck = {
  readOnly: boolean;
  enforce?: boolean;
  strict?: boolean;
  deletionOnlyCollections?: readonly string[];
  exactPrivileges?: ExactPrivileges;
};

async function checkCredentialScope(target: DatabaseTarget, check: ScopeCheck): Promise<void> {
  let problems: string[];
  try {
    // connectionStatus is permitted for every user on itself; it needs no
    // extra role, so the least-privilege users can always run this check.
    const status = (await withTimeout(
      mongoose.connection.db!.command({ connectionStatus: 1, showPrivileges: true }),
      CREDENTIAL_SCOPE_TIMEOUT_MS,
    )) as { authInfo?: { authenticatedUsers?: unknown[]; authenticatedUserPrivileges?: MongoPrivilege[] } };
    // Passed through as reported (possibly missing): strict checks must fail closed rather than assume an empty list.
    const privileges = status.authInfo?.authenticatedUserPrivileges;
    problems = credentialScopeProblems(target, assessCredentialScope(target, privileges, status.authInfo?.authenticatedUsers), { readOnly: check.readOnly, strict: check.strict });
    // Deletion-only users exist in production, and in development only under
    // the strict development-delete rehearsal profile; ordinary development
    // runs use the normal development user.
    if (check.deletionOnlyCollections && (target.environment === 'production' || check.strict)) {
      problems.push(...deletionScopeProblems(target, privileges, check.deletionOnlyCollections));
    }
    if (check.exactPrivileges && (target.environment === 'production' || check.strict)) {
      problems.push(...exactScopeProblems(target, privileges, check.exactPrivileges));
    }
  } catch {
    problems = ["the MongoDB user's privileges could not be verified"];
  }
  if (problems.length === 0) return;

  const message = `MongoDB credential scope: ${problems.join('; ')}. See docs/backend-environments.md.`;
  if (env.MONGODB_ENFORCE_CREDENTIAL_SCOPE === 'true' || check.enforce || check.strict) {
    await mongoose.disconnect();
    throw new DatabaseConfigError(`${message} (${ENFORCE_CREDENTIAL_SCOPE_ENV}=true)`);
  }
  console.warn(`WARNING ${message}`);
}

async function connectTo(target: DatabaseTarget, options: ConnectOptions, check: ScopeCheck): Promise<DatabaseTarget> {
  mongoose.set('strictQuery', true);
  // dbName is always explicit, so MongoDB's implicit `test` default can never apply.
  await mongoose.connect(env.MONGODB_URI!, { ...options, dbName: target.databaseName });
  const connected = mongoose.connection.db?.databaseName;
  if (connected !== target.databaseName) {
    await mongoose.disconnect();
    throw new DatabaseConfigError(`Connected to database "${connected}" instead of "${target.databaseName}".`);
  }
  await checkCredentialScope(target, check);
  return target;
}

/** Server startup: validates the target before connecting, then confirms the connected database. */
export async function connectToDatabase(options: ConnectOptions = {}): Promise<DatabaseTarget> {
  return connectTo(getDatabaseTarget(), options, { readOnly: false });
}

/**
 * Seed/migration/mapping scripts: same validation, plus production is
 * refused unless the script supports it (and a production write is
 * explicitly confirmed). Prints the target before connecting.
 */
export async function connectScriptDatabase(access: ScriptAccess, options: ConnectOptions = {}): Promise<DatabaseTarget> {
  const target = getDatabaseTarget();
  assertScriptMayUseTarget(target, access, process.env);
  console.error(describeTarget(target, access));
  return connectTo(target, options, {
    readOnly: !access.writes,
    enforce: access.enforceCredentialScope,
    strict: access.strictCredentialScope,
    deletionOnlyCollections: access.writes ? access.deletionOnlyCollections : undefined,
    exactPrivileges: access.writes ? access.exactPrivileges : undefined,
  });
}

export async function disconnectFromDatabase() {
  await mongoose.disconnect();
}

const DATABASE_PING_TIMEOUT_MS = 2000;

/** True only when the Mongoose connection is open and answers a ping within 2s. Never throws. */
export async function pingDatabase(): Promise<boolean> {
  const db = mongoose.connection.readyState === 1 ? mongoose.connection.db : undefined;
  if (!db) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), DATABASE_PING_TIMEOUT_MS);
    });
    return await Promise.race([db.admin().ping().then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
