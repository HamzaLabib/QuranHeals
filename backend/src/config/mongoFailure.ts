/**
 * Classifies a MongoDB driver error for scripts, without exposing it. Only
 * the error's class name, numeric code and MongoDB codeName (a fixed
 * identifier such as "Unauthorized") are read — never `message`, which can
 * contain the host, user name, database or command. Used by
 * scripts/mappingVisibilityAudit.ts.
 */

export type MongoFailureKind = 'authentication' | 'authorization' | 'network' | 'tls' | 'connection-string' | 'query' | 'unknown';

export type MongoFailure = { kind: MongoFailureKind; identifiers: string; hint: string };

const AUTHENTICATION_CODES = new Set([18]); // AuthenticationFailed
const AUTHORIZATION_CODES = new Set([13]); // Unauthorized
const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ESERVFAIL', 'ENODATA']);
const SOCKET_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE']);
const TLS_CODES = /^(CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|SELF_SIGNED_|DEPTH_ZERO_)/;
// Driver (Mongo*) and Mongoose (Mongoose*) names for "could not reach a server".
const NETWORK_ERROR_NAMES = new Set([
  'MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoTopologyClosedError',
]);
// Only fixed identifiers are ever printed.
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.-]{1,64}$/;

type ErrorLike = { name?: unknown; code?: unknown; codeName?: unknown; cause?: unknown; reason?: { servers?: unknown } };

const HINTS: Record<MongoFailureKind, string> = {
  authentication:
    'the user name or password was rejected. Check the user name, re-copy the password, and URL-encode special characters in it (for example @ : / ? # [ ] %). Atlas users authenticate against "admin", which is the default; no authSource is needed.',
  authorization:
    'the user is authenticated but not allowed to run this operation. In Atlas the privilege must be `read` on database `quranheals_prod` with the collection field left EMPTY (a collection-specific privilege only allows that one collection).',
  network:
    'the cluster could not be reached. Check that your current public IP is in the Atlas Network Access list, that a VPN, proxy or firewall is not blocking port 27017, and that DNS resolves the cluster (mongodb+srv needs SRV/TXT lookups).',
  tls: 'the TLS connection failed. Check the system clock, and that no proxy or antivirus intercepts TLS; do not disable certificate checks.',
  'connection-string':
    'the connection string could not be used. Copy it again from Atlas (Connect → Drivers), keep it on one line, and URL-encode special characters in the password.',
  query: 'a query failed after connecting; the MongoDB code name above identifies why.',
  unknown: 'unclassified error; the identifiers above are all that can be shown safely.',
};

/**
 * The error, its causes, and — for a server-selection error — each server's
 * last error, which is where the real reason sits (refused connection,
 * failed login, TLS). Bounded, so a cyclic structure cannot loop.
 */
function chain(error: unknown): ErrorLike[] {
  const errors: ErrorLike[] = [];
  const pending: unknown[] = [error];
  while (pending.length > 0 && errors.length < 20) {
    const current = pending.shift();
    if (!current || typeof current !== 'object' || errors.includes(current as ErrorLike)) continue;
    const item = current as ErrorLike;
    errors.push(item);
    pending.push(item.cause);
    const servers = item.reason?.servers;
    const descriptions = servers instanceof Map ? [...servers.values()] : servers && typeof servers === 'object' ? Object.values(servers) : [];
    for (const description of descriptions) pending.push((description as { error?: unknown } | null)?.error);
  }
  return errors;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && SAFE_IDENTIFIER.test(value) ? value : null;
}

export function classifyMongoFailure(error: unknown): MongoFailure {
  const errors = chain(error);
  const names = errors.map((e) => identifier(e.name)).filter((v): v is string => v !== null);
  const codes = errors.map((e) => e.code);
  const codeNames = errors.map((e) => identifier(e.codeName)).filter((v): v is string => v !== null);
  const stringCodes = codes.filter((c): c is string => typeof c === 'string');

  let kind: MongoFailureKind = 'unknown';
  if (codes.some((c) => typeof c === 'number' && AUTHENTICATION_CODES.has(c)) || codeNames.includes('AuthenticationFailed') || names.includes('MongoMissingCredentialsError')) {
    kind = 'authentication';
  } else if (codes.some((c) => typeof c === 'number' && AUTHORIZATION_CODES.has(c)) || codeNames.includes('Unauthorized')) {
    kind = 'authorization';
  } else if (names.includes('MongoParseError') || names.includes('MongoInvalidArgumentError')) {
    kind = 'connection-string';
  } else if (stringCodes.some((c) => TLS_CODES.test(c))) {
    kind = 'tls';
  } else if (
    stringCodes.some((c) => DNS_CODES.has(c) || SOCKET_CODES.has(c)) ||
    names.some((n) => NETWORK_ERROR_NAMES.has(n))
  ) {
    kind = 'network';
  } else if (names.includes('MongoServerError') || codeNames.length > 0) {
    kind = 'query';
  }

  const parts = [
    ...new Set(names),
    ...new Set(codes.map(identifier).filter((v): v is string => v !== null).map((c) => `code ${c}`)),
    ...new Set(codeNames),
  ];
  return { kind, identifiers: parts.join(', ') || 'no identifiers', hint: HINTS[kind] };
}

/** One line safe for logs: the step that failed, the kind of failure, fixed identifiers and what to check. */
export function describeMongoFailure(step: string, error: unknown): string {
  const { kind, identifiers, hint } = classifyMongoFailure(error);
  return `failed during ${step}: ${kind} error (${identifiers}) — ${hint}`;
}
