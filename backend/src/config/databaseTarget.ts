/**
 * Which MongoDB database a process may use, decided from NODE_ENV plus an
 * explicit MONGODB_DB_NAME — never from MongoDB's implicit default (`test`,
 * used when a URI names no database). The single policy behind the server
 * (server.ts), the seed/migration/mapping scripts (config/database.ts) and
 * docs/backend-environments.md.
 *
 * Pure and side-effect free; error messages never include the URI, its
 * credentials or its host.
 */

export const PRODUCTION_DATABASE = 'quranheals_prod';
export const DEVELOPMENT_DATABASE = 'quranheals_dev';
export const TEST_DATABASE = 'quranheals_test';

export type AppEnvironment = 'development' | 'test' | 'production';
export type DatabaseTarget = { environment: AppEnvironment; databaseName: string };

export class DatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigError';
  }
}

// MongoDB's own reserved/default names: never a valid Quran Heals target.
const RESERVED_DATABASES = new Set(['test', 'admin', 'local', 'config']);
const VALID_NAME = /^[A-Za-z0-9_-]{1,63}$/;

// Per environment: the canonical name, plus optional suffixed personal/CI
// copies (e.g. quranheals_dev_alex). Production allows exactly one name.
const ALLOWED: Record<AppEnvironment, RegExp> = {
  production: new RegExp(`^${PRODUCTION_DATABASE}$`),
  development: new RegExp(`^${DEVELOPMENT_DATABASE}(_[a-z0-9]+)*$`),
  test: new RegExp(`^${TEST_DATABASE}(_[a-z0-9]+)*$`),
};

/**
 * The database named in a MongoDB connection string's path, or null when it
 * names none (mongodb://host/ or mongodb+srv://host/?opts). Handles
 * multi-host seed lists, which `new URL()` cannot parse.
 */
export function databaseNameFromUri(uri: string): string | null {
  const schemeEnd = uri.indexOf('://');
  if (schemeEnd === -1) throw new DatabaseConfigError('MONGODB_URI is not a mongodb:// or mongodb+srv:// connection string.');
  const rest = uri.slice(schemeEnd + 3);
  const slash = rest.indexOf('/');
  if (slash === -1) return null;
  const path = rest.slice(slash + 1).split('?')[0];
  const name = decodeURIComponent(path);
  return name.length > 0 ? name : null;
}

/**
 * Resolves and validates the database target. Throws DatabaseConfigError
 * when MONGODB_URI or MONGODB_DB_NAME is missing, the two disagree, the
 * name is MongoDB's default `test` (or another reserved name), or the name
 * belongs to a different environment — e.g. a development process aimed at
 * quranheals_prod, or a production process at anything but quranheals_prod.
 */
export function resolveDatabaseTarget(input: { nodeEnv: AppEnvironment; uri?: string; dbName?: string }): DatabaseTarget {
  const { nodeEnv } = input;
  const uri = input.uri?.trim();
  const dbName = input.dbName?.trim();

  if (!uri) throw new DatabaseConfigError(`MONGODB_URI is required (NODE_ENV=${nodeEnv}).`);
  if (!dbName) {
    throw new DatabaseConfigError(
      `MONGODB_DB_NAME is required (NODE_ENV=${nodeEnv}); expected "${expectedName(nodeEnv)}". The database is never inferred from MongoDB's default.`,
    );
  }
  if (!VALID_NAME.test(dbName)) throw new DatabaseConfigError(`MONGODB_DB_NAME "${dbName}" is not a valid database name.`);

  const uriName = databaseNameFromUri(uri);
  if (uriName !== null && uriName !== dbName) {
    throw new DatabaseConfigError(
      `MONGODB_URI names database "${uriName}" but MONGODB_DB_NAME is "${dbName}". Remove the database from the URI path or make them match.`,
    );
  }
  if (RESERVED_DATABASES.has(dbName.toLowerCase())) {
    throw new DatabaseConfigError(`MONGODB_DB_NAME "${dbName}" is a MongoDB default/reserved database and is never used by Quran Heals.`);
  }
  if (!ALLOWED[nodeEnv].test(dbName)) {
    throw new DatabaseConfigError(`NODE_ENV=${nodeEnv} may not use database "${dbName}"; expected "${expectedName(nodeEnv)}".`);
  }
  return { environment: nodeEnv, databaseName: dbName };
}

function expectedName(nodeEnv: AppEnvironment): string {
  return nodeEnv === 'production' ? PRODUCTION_DATABASE : nodeEnv === 'development' ? DEVELOPMENT_DATABASE : TEST_DATABASE;
}

export type ScriptAccess = {
  /** Script name, printed in the target banner. */
  script: string;
  /** Whether this run may write. */
  writes: boolean;
  /** Only scripts explicitly built for production may target it at all. */
  productionSupported?: boolean;
  /**
   * Treat any credential-scope problem as fatal for this run, regardless of
   * MONGODB_ENFORCE_CREDENTIAL_SCOPE (the admin deletion tool always does).
   */
  enforceCredentialScope?: boolean;
  /**
   * In production, a writing run that must use a deletion-only user: find
   * and remove on exactly these collections, nothing else that writes
   * (see credentialScope.ts deletionScopeProblems).
   */
  deletionOnlyCollections?: readonly string[];
  /**
   * In production (or with strictCredentialScope), a writing run whose user
   * must hold EXACTLY these actions per collection and nothing else (see
   * credentialScope.ts exactScopeProblems). Used instead of
   * deletionOnlyCollections by users whose role spans several collections.
   */
  exactPrivileges?: Readonly<Record<string, readonly string[]>>;
  /**
   * Apply the read-only and deletion-only checks in EVERY environment, not
   * only production, and make any problem fatal. Set by the explicit
   * development rehearsal profiles (development-read / development-delete),
   * so a restricted development user is checked exactly like production.
   * Production always applies these checks, with or without this flag.
   */
  strictCredentialScope?: boolean;
};

/** Must equal the production database name to allow a production write. */
export const PRODUCTION_WRITE_CONFIRMATION_ENV = 'QURAN_HEALS_CONFIRM_PRODUCTION_WRITE';

/**
 * The extra gate for scripts: production is refused unless the script
 * supports it, and a production write additionally needs
 * QURAN_HEALS_CONFIRM_PRODUCTION_WRITE=quranheals_prod in the environment.
 */
export function assertScriptMayUseTarget(target: DatabaseTarget, access: ScriptAccess, env: Record<string, string | undefined>): void {
  if (target.environment !== 'production') return;
  if (!access.productionSupported) {
    throw new DatabaseConfigError(`${access.script} does not support the production database; run it against ${DEVELOPMENT_DATABASE}.`);
  }
  if (access.writes && env[PRODUCTION_WRITE_CONFIRMATION_ENV] !== target.databaseName) {
    throw new DatabaseConfigError(
      `${access.script} would write to production. Set ${PRODUCTION_WRITE_CONFIRMATION_ENV}=${target.databaseName} to confirm.`,
    );
  }
}

/** The non-secret line every script prints before touching a database. */
export function describeTarget(target: DatabaseTarget, access: ScriptAccess): string {
  return `[${access.script}] environment=${target.environment} database=${target.databaseName} mode=${access.writes ? 'WRITE' : 'read-only'}`;
}
