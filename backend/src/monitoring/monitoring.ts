import * as Sentry from '@sentry/node';

import { errorChain, isDatabaseErrorName, summarizeDatabaseError, summarizeDatabaseErrorText } from './errorSanitizer';

/**
 * Backend error monitoring (Sentry). Off unless SENTRY_DSN is set, and
 * never able to break the app: init/report/flush failures are swallowed,
 * and Sentry being unreachable only drops events.
 *
 * Privacy: errors only — no tracing, no request headers/bodies/cookies/
 * query strings, no local variables, no user info, no HTTP or console
 * breadcrumbs. Every event is scrubbed again in beforeSend (scrubEvent)
 * for tokens, JWTs, Mongo URIs, private keys, emails and long base64 blobs
 * (e.g. reflection ciphertext). See docs/backend-operations.md.
 */

// Error capture only. Excluded on purpose: RequestData (request
// headers/bodies), LocalVariables/LocalVariablesAsync (function-local values
// such as tokens or decrypted data), Http/NodeFetch/Console (breadcrumbs
// with URLs and log lines), ProcessSession, and all tracing integrations.
const ALLOWED_INTEGRATIONS = new Set([
  'EventFilters',
  'FunctionToString',
  'LinkedErrors',
  'Dedupe',
  'NodeSystemError',
  'OnUncaughtException',
  'OnUnhandledRejection',
  'Context',
  'ContextLines',
]);

const FILTERED = '[Filtered]';
const SENSITIVE_KEY =
  /authorization|cookie|token|password|passphrase|secret|credential|private|signature|ciphertext|nonce|wrapped|salt|code|dsn|uri|email|reflection|text|body|userid|user_id|subject|keyvalue|identity|account/i;
/** Short keys that are identifiers only as whole keys (`sub` must not hide `subscription`). */
const SENSITIVE_EXACT_KEYS = new Set(['sub', 'sid', 'uid', '_id', 'ip', 'ip_address']);

/** Keys whose VALUE is redacted wherever it appears in text as `key: value`, `key=value` or `"key":"value"`. */
const SENSITIVE_TEXT_KEYS =
  'providerSubject|userId|user_id|sub|subject|email|idToken|id_token|identityToken|access_token|refresh_token|refreshToken|accessToken|authorizationCode|authorization_code|client_secret|password|passphrase|token|secret|ciphertext|wrappedKey|nonce|salt|keyFingerprint';

/**
 * Pattern-based redaction for free text (messages of non-database errors,
 * paths, contexts). Database errors don't rely on this: their messages are
 * replaced entirely (errorSanitizer.ts). Order matters: specific shapes
 * first, then generic identifiers.
 */
const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[private key]'],
  [/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[mongodb uri]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  // This backend's refresh tokens: `${sessionObjectId}.${secret}`.
  [/\b[a-f0-9]{24}\.[A-Za-z0-9_-]{20,}/g, '[refresh token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // MongoDB duplicate-key values, whatever the error class.
  [/dup key: \{[^}]*\}/g, 'dup key: { [redacted] }'],
  // Mongoose cast messages: `... for value "<input>" (type string) ...`.
  [/\bfor value ("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g, 'for value [redacted]'],
  // `key: value` / `key=value` / `"key":"value"` for identifier and secret keys (JSON payloads in library messages).
  [new RegExp(`(?<![A-Za-z0-9_])(["']?)(${SENSITIVE_TEXT_KEYS})\\1(\\s*[:=]\\s*)("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|[^\\s,;}\\]]+)`, 'gi'), '$1$2$1$3[redacted]'],
  // Sign in with Apple subjects: 000000.<32 hex>.0000
  [/\b\d{6}\.[0-9a-f]{32}\.\d{4}\b/gi, '[subject]'],
  // Google subjects and other long numeric identifiers (timestamps in ms are 13 digits and survive).
  [/\b\d{15,}\b/g, '[number]'],
  // MongoDB ObjectIds (user, session and document ids).
  [/\b[a-f0-9]{24}\b/gi, '[id]'],
  // Long base64/base64url runs containing a digit: ciphertext, keys, codes.
  [/(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]'],
];

export function scrubString(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key) || SENSITIVE_EXACT_KEYS.has(key.toLowerCase());
}

/** Deep-scrubs strings and drops values under sensitive keys. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (depth > 6) return FILTERED;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, isSensitiveKey(key) ? FILTERED : scrubValue(entry, depth + 1)]),
  );
}

type ExceptionValue = NonNullable<NonNullable<Sentry.Event['exception']>['values']>[number];

/**
 * The safe value for one exception entry. A database error is matched to
 * its original error object (the reported error or one of its causes, by
 * class name) and described only from fixed identifiers; without an
 * original, from identifiers parsed out of the text. Any other error keeps
 * its message, scrubbed.
 */
function safeExceptionValue(exception: ExceptionValue, originals: unknown[]): string | undefined {
  const type = exception.type ?? '';
  if (isDatabaseErrorName(type)) {
    const index = originals.findIndex((original) => (original as { name?: unknown }).name === type);
    const original = index >= 0 ? originals.splice(index, 1)[0] : undefined;
    return (original !== undefined ? summarizeDatabaseError(original) : null) ?? summarizeDatabaseErrorText(type, exception.value ?? '') ?? 'details removed';
  }
  return exception.value === undefined ? undefined : scrubString(exception.value);
}

/** beforeSend: the last line of defense before anything leaves the process. */
export function scrubEvent<E extends Sentry.Event>(event: E, hint?: Sentry.EventHint): E {
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  if (event.request) {
    const path = event.request.url?.split('?')[0];
    event.request = { method: event.request.method, ...(path ? { url: scrubString(path) } : {}) };
  }
  if (event.message) event.message = scrubString(event.message);
  if (event.logentry) event.logentry = { message: scrubString(event.logentry.message ?? '') };
  const originals = errorChain(hint?.originalException);
  for (const exception of event.exception?.values ?? []) {
    if (exception.type) exception.type = scrubString(exception.type);
    const value = safeExceptionValue(exception, originals);
    if (value !== undefined) exception.value = value;
    if (exception.mechanism?.data) exception.mechanism.data = scrubValue(exception.mechanism.data) as typeof exception.mechanism.data;
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.contexts) event.contexts = scrubValue(event.contexts) as E['contexts'];
  if (event.tags) event.tags = scrubValue(event.tags) as E['tags'];
  return event;
}

/**
 * Fails closed: if scrubbing itself throws, the event is dropped rather
 * than sent unscrubbed. Never logs the event or the error.
 */
export function beforeSendSafely<E extends Sentry.Event>(event: E, hint?: Sentry.EventHint): E | null {
  try {
    return scrubEvent(event, hint);
  } catch {
    return null;
  }
}

export type MonitoringConfig = {
  dsn?: string;
  environment: string;
  release?: string;
  /** Test-only: an in-memory transport so tests never touch the network. */
  transport?: Sentry.NodeOptions['transport'];
};

let enabled = false;

/** Returns whether monitoring is active. Never throws. */
export function initMonitoring(config: MonitoringConfig): boolean {
  const dsn = config.dsn?.trim();
  if (!dsn) return (enabled = false);
  try {
    Sentry.init({
      dsn,
      environment: config.environment,
      release: config.release,
      serverName: 'quran-heals-api',
      tracesSampleRate: undefined,
      maxBreadcrumbs: 0,
      integrations: (defaults) => defaults.filter((integration) => ALLOWED_INTEGRATIONS.has(integration.name)),
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        genAI: { inputs: false, outputs: false },
        databaseQueryData: false,
        queues: false,
        stackFrameVariables: false,
      },
      beforeSend: (event, hint) => beforeSendSafely(event, hint),
      beforeBreadcrumb: () => null,
      ...(config.transport ? { transport: config.transport } : {}),
    });
    enabled = Sentry.isEnabled();
  } catch {
    enabled = false;
  }
  return enabled;
}

export function isMonitoringEnabled(): boolean {
  return enabled;
}

/** Reports an unexpected error with route-level tags only. No-op when disabled; never throws. */
export function reportError(error: unknown, context: { method?: string; route?: string } = {}): void {
  if (!enabled) return;
  try {
    Sentry.withScope((scope) => {
      if (context.method) scope.setTag('http.method', context.method);
      if (context.route) scope.setTag('http.route', context.route);
      Sentry.captureException(error);
    });
  } catch {
    // Monitoring must never affect request handling.
  }
}

/** Sends queued events before exit, bounded so an unreachable Sentry can't hang shutdown. */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (!enabled) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // ignore
  }
}

/**
 * A log-safe one-line description of an error: a database error is described
 * from fixed identifiers only (errorSanitizer.ts); any other error by its
 * name and scrubbed message. Never includes attached request data.
 */
export function describeError(error: unknown): string {
  const database = summarizeDatabaseError(error);
  if (database !== null) return `${scrubString(String((error as Error).name))}: ${database}`;
  if (error instanceof Error) return `${error.name}: ${scrubString(error.message)}`;
  return scrubString(String(error));
}

export type CronSchedule = { crontab: string; checkinMarginMinutes: number; maxRuntimeMinutes: number };

/**
 * Sentry Crons check-ins for a scheduled job (the issue-report retention
 * Render Cron Job): `in_progress` now, then `ok` or `error` from finish().
 * Sentry upserts the monitor from `schedule` and raises an issue when a
 * check-in is MISSED (the job never ran), fails, or exceeds its runtime —
 * the one failure a job cannot report about itself. No-op when monitoring
 * is disabled; never throws. Sends only the slug and status, no job data.
 */
export function cronCheckIn(monitorSlug: string, schedule: CronSchedule): { finish(ok: boolean): void } {
  if (!enabled) return { finish: () => undefined };
  let checkInId: string | undefined;
  try {
    checkInId = Sentry.captureCheckIn(
      { monitorSlug, status: 'in_progress' },
      {
        schedule: { type: 'crontab', value: schedule.crontab },
        checkinMargin: schedule.checkinMarginMinutes,
        maxRuntime: schedule.maxRuntimeMinutes,
        timezone: 'Etc/UTC',
      },
    );
  } catch {
    checkInId = undefined;
  }
  return {
    finish: (ok) => {
      try {
        if (checkInId) Sentry.captureCheckIn({ checkInId, monitorSlug, status: ok ? 'ok' : 'error' });
      } catch {
        // Monitoring must never affect the job.
      }
    },
  };
}
