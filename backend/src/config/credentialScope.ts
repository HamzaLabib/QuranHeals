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
};

/**
 * `privileges` is connectionStatus' authenticatedUserPrivileges: already
 * flattened across inherited roles, so role inheritance needs no handling
 * here. `authenticatedUsers` is undefined when the server did not report it.
 */
export function assessCredentialScope(target: DatabaseTarget, privileges: MongoPrivilege[], authenticatedUsers?: unknown[]): CredentialScope {
  let anyDatabase = false;
  let canWriteTarget = false;
  const otherDatabases = new Set<string>();

  for (const { resource, actions } of privileges) {
    if (resource.cluster) continue; // cluster-level actions (e.g. listDatabases) grant no data access by themselves
    const coversAllDatabases = resource.anyResource === true || resource.db === '';
    const writes = actions.some((action) => WRITE_ACTIONS.has(action));
    if (coversAllDatabases) {
      anyDatabase = true;
      canWriteTarget ||= writes;
    } else if (resource.db === target.databaseName) {
      canWriteTarget ||= writes;
    } else if (resource.db && !SYSTEM_DATABASES.has(resource.db)) {
      otherDatabases.add(resource.db);
    }
  }

  return { authenticated: !Array.isArray(authenticatedUsers) || authenticatedUsers.length > 0, anyDatabase, otherDatabases: [...otherDatabases].sort(), canWriteTarget };
}

/** Human-readable problems with a credential's scope; empty when it is least-privilege for the target. */
export function credentialScopeProblems(target: DatabaseTarget, scope: CredentialScope, options: { readOnly?: boolean } = {}): string[] {
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
  // Only production has a separate read-only (audit) user; development
  // read-only scripts legitimately use the normal development user.
  if (options.readOnly && target.environment === 'production' && scope.canWriteTarget) {
    problems.push(`a read-only run is using a MongoDB user that can write to "${target.databaseName}" (use the read-only audit user)`);
  }
  return problems;
}

export const ENFORCE_CREDENTIAL_SCOPE_ENV = 'MONGODB_ENFORCE_CREDENTIAL_SCOPE';
