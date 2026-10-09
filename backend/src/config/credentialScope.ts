import type { DatabaseTarget } from './databaseTarget';

/**
 * Least-privilege check of the MongoDB credential a process connected with
 * (D4). The database-name guards in databaseTarget.ts stop the APP from
 * choosing the wrong database; this verifies the CREDENTIAL itself cannot
 * reach another Quran Heals database (e.g. a local development user that can
 * also read quranheals_prod). It reads the authenticated user's own
 * privileges via `connectionStatus`, which every user may run on itself.
 *
 * Pure analysis here; config/database.ts runs it after connecting. Messages
 * contain database names only — never the URI, host or user name.
 */

/** One entry of connectionStatus.authInfo.authenticatedUserPrivileges. */
export type MongoPrivilege = {
  resource: { db?: string; collection?: string; cluster?: boolean; anyResource?: boolean };
  actions: string[];
};

// Any of these on a database means the credential can change its data or schema.
const WRITE_ACTIONS = new Set([
  'insert', 'update', 'remove', 'createCollection', 'dropCollection', 'dropDatabase',
  'createIndex', 'dropIndex', 'collMod', 'renameCollectionSameDB', 'convertToCapped', 'bypassDocumentValidation',
]);

// MongoDB system databases a normal user's privileges legitimately mention.
const SYSTEM_DATABASES = new Set(['admin', 'local', 'config']);

export type CredentialScope = {
  /** False when MongoDB reports no authenticated user at all (e.g. a server without access control), which grants everything. */
  authenticated: boolean;
  /** Privileges on every database (readAnyDatabase, readWriteAnyDatabase, atlasAdmin, …). */
  anyDatabase: boolean;
  /** Other application databases the credential can access, e.g. quranheals_prod from development. */
  otherDatabases: string[];
  /** Whether the credential can write to the target database. */
  canWriteTarget: boolean;
  /** Whether MongoDB reported a privilege list at all (an array). */
  privilegesReported: boolean;
  /** Privilege entries whose shape was not recognized (ignored for the checks above). */
  unrecognizedEntries: number;
  /** Whether any recognized privilege grants `find` on the target database. */
  canReadTarget: boolean;
};

/**
 * A privilege entry in the shape connectionStatus reports: a resource that
 * is exactly one of the cluster, any resource, or a named database
 * (optionally a collection), and a list of action names.
 */
export function isRecognizedPrivilege(entry: unknown): entry is MongoPrivilege {
  if (!entry || typeof entry !== 'object') return false;
  const { resource, actions } = entry as { resource?: unknown; actions?: unknown };
  if (!Array.isArray(actions) || !actions.every((action) => typeof action === 'string')) return false;
  if (!resource || typeof resource !== 'object') return false;
  const r = resource as { db?: unknown; collection?: unknown; cluster?: unknown; anyResource?: unknown };
  if (r.collection !== undefined && typeof r.collection !== 'string') return false;
  const kinds = [r.cluster === true, r.anyResource === true, typeof r.db === 'string'].filter(Boolean).length;
  return kinds === 1;
}

/**
 * `privileges` is connectionStatus' authenticatedUserPrivileges: already
 * flattened across inherited roles, so role inheritance needs no handling
 * here. It may be missing (not reported) or contain entries of an
 * unexpected shape; both are recorded so strict checks can fail closed.
 * `authenticatedUsers` is undefined when the server did not report it.
 */
export function assessCredentialScope(target: DatabaseTarget, privileges: MongoPrivilege[] | undefined, authenticatedUsers?: unknown[]): CredentialScope {
  let anyDatabase = false;
  let canWriteTarget = false;
  let canReadTarget = false;
  let unrecognizedEntries = 0;
  const otherDatabases = new Set<string>();
  const privilegesReported = Array.isArray(privileges);

  for (const entry of privilegesReported ? (privileges as unknown[]) : []) {
    if (!isRecognizedPrivilege(entry)) {
      unrecognizedEntries++;
      continue;
    }
    const { resource, actions } = entry;
    if (resource.cluster) continue; // cluster-level actions (e.g. listDatabases) grant no data access by themselves
    const coversAllDatabases = resource.anyResource === true || resource.db === '';
    const writes = actions.some((action) => WRITE_ACTIONS.has(action));
    if (coversAllDatabases) {
      anyDatabase = true;
      canWriteTarget ||= writes;
      canReadTarget ||= actions.includes('find');
    } else if (resource.db === target.databaseName) {
      canWriteTarget ||= writes;
      canReadTarget ||= actions.includes('find');
    } else if (resource.db && !SYSTEM_DATABASES.has(resource.db)) {
      otherDatabases.add(resource.db);
    }
  }

  return {
    authenticated: !Array.isArray(authenticatedUsers) || authenticatedUsers.length > 0,
    anyDatabase,
    otherDatabases: [...otherDatabases].sort(),
    canWriteTarget,
    privilegesReported,
    unrecognizedEntries,
    canReadTarget,
  };
}

/** Human-readable problems with a credential's scope; empty when it is least-privilege for the target. */
export function credentialScopeProblems(target: DatabaseTarget, scope: CredentialScope, options: { readOnly?: boolean; strict?: boolean } = {}): string[] {
  const problems: string[] = [];
  if (!scope.authenticated) {
    problems.push('the connection is not authenticated as a database user, so it is not limited to any database');
  }
  if (scope.anyDatabase) {
    problems.push(`the MongoDB user has privileges on every database, not only "${target.databaseName}"`);
  }
  if (scope.otherDatabases.length > 0) {
    problems.push(`the MongoDB user can also access ${scope.otherDatabases.map((name) => `"${name}"`).join(', ')}`);
  }
  // Only production has a separate read-only (audit) user by default;
  // development read-only scripts legitimately use the normal development
  // user — unless a strict development rehearsal profile asks for the
  // production rule (a development read-only user).
  if (options.readOnly && (target.environment === 'production' || options.strict) && scope.canWriteTarget) {
    problems.push(`a read-only run is using a MongoDB user that can write to "${target.databaseName}" (use the read-only audit user)`);
  }
  // Strict: read-only access must be positively confirmed, never assumed
  // from a missing, empty or unreadable privilege list.
  if (options.readOnly && options.strict) {
    if (!scope.privilegesReported) {
      problems.push('MongoDB did not report the user\'s privileges, so read-only access cannot be confirmed');
    } else if (scope.unrecognizedEntries > 0) {
      problems.push(`${scope.unrecognizedEntries} privilege entr${scope.unrecognizedEntries === 1 ? 'y has' : 'ies have'} an unrecognized shape, so read-only access cannot be confirmed`);
    } else if (!scope.canReadTarget) {
      problems.push(`the reported privileges show no read access to "${target.databaseName}", so the user's role was not recognized`);
    }
  }
  return problems;
}

export const ENFORCE_CREDENTIAL_SCOPE_ENV = 'MONGODB_ENFORCE_CREDENTIAL_SCOPE';

/** The only actions a deletion-only user may hold, and only on the account collections. */
export const DELETION_ALLOWED_ACTIONS: readonly string[] = ['find', 'remove'];

/**
 * Problems with a credential meant to be DELETION-ONLY on `target` (the
 * admin deletion tool's restricted user). An allowlist, not a blocklist:
 * the user may hold `find` and `remove` on exactly `collections` of the
 * target database and NOTHING else. Every other grant is a problem —
 * any other action (write, index, administration, user or role
 * management, diagnostics), any database-wide grant, any grant on another
 * database (system databases included), any cluster-wide action, and any
 * privilege entry of unrecognized shape — and so is a missing privilege
 * list or a missing find/remove. Applies on top of credentialScopeProblems.
 * Messages name actions, collections and databases only.
 */
export function deletionScopeProblems(target: DatabaseTarget, privileges: MongoPrivilege[] | undefined, collections: readonly string[]): string[] {
  if (!Array.isArray(privileges)) return ['MongoDB did not report the deletion user\'s privileges, so its role cannot be confirmed'];

  const problems = new Set<string>();
  const required = new Set(collections);
  const allowedActions = new Set(DELETION_ALLOWED_ACTIONS);
  const granted = new Map<string, Set<string>>();
  const quoted = (actions: string[]) => actions.map((action) => `"${action}"`).join(', ');

  for (const entry of privileges as unknown[]) {
    if (!isRecognizedPrivilege(entry)) {
      problems.add('a privilege entry has an unrecognized shape, so the deletion user\'s role cannot be confirmed');
      continue;
    }
    const { resource, actions } = entry;
    if (actions.length === 0) continue;
    if (resource.cluster) {
      problems.add(`the deletion user has cluster-wide actions (${quoted(actions)}); it should have none`);
    } else if (resource.anyResource || resource.db === '') {
      problems.add(`the deletion user has actions on every database (${quoted(actions)}); it should only reach "${target.databaseName}"`);
    } else if (resource.db !== target.databaseName) {
      problems.add(`the deletion user has actions on "${resource.db}" (${quoted(actions)}); it should only reach "${target.databaseName}"`);
    } else if (!resource.collection) {
      problems.add(`the deletion user has database-wide actions on "${target.databaseName}" (${quoted(actions)}); it should only have find and remove on the account collections`);
    } else if (!required.has(resource.collection)) {
      problems.add(`the deletion user has actions on "${resource.collection}" (${quoted(actions)}), which account deletion never needs`);
    } else {
      for (const action of actions) {
        if (allowedActions.has(action)) {
          const set = granted.get(resource.collection) ?? new Set<string>();
          set.add(action);
          granted.set(resource.collection, set);
        } else {
          problems.add(`the deletion user has "${action}" on "${resource.collection}"; only find and remove are allowed`);
        }
      }
    }
  }

  const missing = collections.filter((name) => !DELETION_ALLOWED_ACTIONS.every((action) => granted.get(name)?.has(action)));
  if (missing.length > 0) problems.add(`the deletion user lacks find/remove on: ${missing.join(', ')}`);
  return [...problems];
}
