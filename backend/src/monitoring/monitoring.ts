import * as Sentry from '@sentry/node';

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
const SENSITIVE_KEY = /authorization|cookie|token|password|passphrase|secret|credential|private|signature|ciphertext|nonce|wrapped|salt|code|dsn|uri|email|reflection|text|body/i;

const SENSITIVE_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[private key]'],
  [/mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi, '[mongodb uri]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]'],
  // This backend's refresh tokens: `${sessionObjectId}.${secret}`.
  [/\b[a-f0-9]{24}\.[A-Za-z0-9_-]{20,}/g, '[refresh token]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
  // Long base64/base64url runs containing a digit: ciphertext, keys, codes.
  [/(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}/g, '[redacted]'],
];

export function scrubString(value: string): string {
  return SENSITIVE_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

/** Deep-scrubs strings and drops values under sensitive keys. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, SENSITIVE_KEY.test(key) ? FILTERED : scrubValue(entry, depth + 1)]),
  );
}

/** beforeSend: the last line of defense before anything leaves the process. */
export function scrubEvent<E extends Sentry.Event>(event: E): E {
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  if (event.request) {
    const path = event.request.url?.split('?')[0];
    event.request = { method: event.request.method, ...(path ? { url: scrubString(path) } : {}) };
  }
  if (event.message) event.message = scrubString(event.message);
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubString(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  if (event.contexts) event.contexts = scrubValue(event.contexts) as E['contexts'];
  if (event.tags) event.tags = scrubValue(event.tags) as E['tags'];
  return event;
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
      beforeSend: (event) => scrubEvent(event),
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

/** A log-safe one-line description of an error (scrubbed message, no attached request data). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${scrubString(error.message)}`;
  return scrubString(String(error));
}
