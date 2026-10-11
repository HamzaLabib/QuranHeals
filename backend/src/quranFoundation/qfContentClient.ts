/**
 * Quran Foundation Content API client (server only).
 *
 * OAuth2 client-credentials with scope `content`; the access token (1 h) is
 * cached until a minute before expiry and refetched once on a 401. The
 * client secret never leaves this process: it is not logged, not returned
 * in errors, and the mobile app only ever talks to our own backend.
 * Pre-live and production credentials, hosts and tokens are never mixed
 * (one environment per client).
 *
 * Docs: https://api-docs.quran.foundation/docs/quickstart
 */

export type QfEnvironment = 'prelive' | 'production';

export const QF_HOSTS: Record<QfEnvironment, { token: string; api: string }> = {
  prelive: { token: 'https://prelive-oauth2.quran.foundation/oauth2/token', api: 'https://apis-prelive.quran.foundation' },
  production: { token: 'https://oauth2.quran.foundation/oauth2/token', api: 'https://apis.quran.foundation' },
};

export type QfCredentials = { environment: QfEnvironment; clientId: string; clientSecret: string };

export type QfEnv = { QF_ENV?: string; QF_CLIENT_ID?: string; QF_CLIENT_SECRET?: string };

/** Credentials from the environment, or null (never partially configured). Problems name variables only. */
export function readQfCredentials(env: QfEnv): { credentials: QfCredentials | null; problems: string[] } {
  const problems: string[] = [];
  const environment = (env.QF_ENV?.trim() || 'prelive') as QfEnvironment;
  if (environment !== 'prelive' && environment !== 'production') problems.push('QF_ENV must be "prelive" or "production".');
  const clientId = env.QF_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.QF_CLIENT_SECRET?.trim() ?? '';
  if (Boolean(clientId) !== Boolean(clientSecret)) problems.push('QF_CLIENT_ID and QF_CLIENT_SECRET must be set together.');
  if (problems.length > 0 || !clientId) return { credentials: null, problems };
  return { credentials: { environment, clientId, clientSecret }, problems };
}

/**
 * Why a Quran Foundation request failed — safe to log: a category, the
 * stage, the environment, the upstream HTTP status and the request path
 * WITHOUT its query. Never credentials, tokens or response bodies.
 *  - not_configured: no QF_* credentials
 *  - auth:           token refused, or content refused even with a fresh token (401/403)
 *  - upstream:       Quran Foundation answered with an error (e.g. 404, 5xx)
 *  - network:        no answer (DNS, refused, TLS…)
 *  - timeout:        no answer in time
 *  - malformed:      an answer we could not use (e.g. no access_token)
 */
export type QfFailureCategory = 'not_configured' | 'auth' | 'upstream' | 'network' | 'timeout' | 'malformed';

export class QfUnavailableError extends Error {
  constructor(
    message: string,
    readonly category: QfFailureCategory,
    readonly details: { stage?: 'token' | 'content'; status?: number; environment?: QfEnvironment; path?: string; code?: string } = {},
  ) {
    super(message);
    this.name = 'QfUnavailableError';
  }

  get status(): number | undefined {
    return this.details.status;
  }

  /** One line for server logs — no secrets, tokens or bodies. */
  describe(): string {
    const { stage, status, environment, path, code } = this.details;
    return [`category=${this.category}`, stage && `stage=${stage}`, environment && `env=${environment}`, status !== undefined && `status=${status}`, code && `code=${code}`, path && `path=${path}`]
      .filter(Boolean)
      .join(' ');
  }
}

/** The path without its query string (page numbers are fine; query values are not logged). */
const pathOnly = (path: string) => path.split('?')[0];

/** A fetch that threw (no HTTP answer) → network or timeout, with only a system error code kept. */
function connectionFailure(error: unknown, details: QfUnavailableError['details']): QfUnavailableError {
  const name = (error as { name?: unknown })?.name;
  if (name === 'AbortError' || name === 'TimeoutError') return new QfUnavailableError('Quran Foundation did not answer in time', 'timeout', details);
  const cause = (error as { cause?: { code?: unknown } })?.cause?.code;
  const code = typeof cause === 'string' && /^[A-Z_]{2,40}$/.test(cause) ? cause : undefined;
  return new QfUnavailableError('Quran Foundation could not be reached', 'network', { ...details, code });
}

type FetchLike = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /** Present on real responses; used by `stream`. */
  body?: ReadableStream<Uint8Array> | null;
}>;

export type QfContentClient = {
  get(path: string): Promise<unknown>;
  /**
   * A large response body as a stream (e.g. a Content Sync snapshot), with
   * its own time limit for the whole transfer. Errors as `get`.
   */
  stream(path: string, options: { timeoutMs: number; signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
};

export function createQfContentClient(
  credentials: QfCredentials,
  options: { fetch?: FetchLike; now?: () => number; timeoutMs?: number } = {},
): QfContentClient {
  const doFetch: FetchLike = options.fetch ?? (fetch as unknown as FetchLike);
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const hosts = QF_HOSTS[credentials.environment];
  let token: { value: string; expiresAt: number } | null = null;

  const withTimeout = async <T>(work: (signal: AbortSignal) => Promise<T>) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const environment = credentials.environment;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return token.value;
    const details = { stage: 'token' as const, environment };
    const basic = Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64');
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await withTimeout((signal) => doFetch(hosts.token, {
        method: 'POST',
        headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials&scope=content',
        signal,
      }));
    } catch (error) {
      throw connectionFailure(error, details);
    }
    if (!response.ok) {
      const category = response.status === 400 || response.status === 401 || response.status === 403 ? 'auth' : 'upstream';
      throw new QfUnavailableError('Quran Foundation token request failed', category, { ...details, status: response.status });
    }
    const body = (await response.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new QfUnavailableError('Quran Foundation token response was malformed', 'malformed', { ...details, status: response.status });
    }
    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 3600;
    token = { value: body.access_token, expiresAt: now() + (lifetime - 60) * 1000 };
    return token.value;
  }

  async function get(path: string, retried = false): Promise<unknown> {
    const value = await accessToken();
    const details = { stage: 'content' as const, environment, path: pathOnly(path) };
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await withTimeout((signal) => doFetch(`${hosts.api}${path}`, {
        headers: { 'x-auth-token': value, 'x-client-id': credentials.clientId, Accept: 'application/json' },
        signal,
      }));
    } catch (error) {
      throw connectionFailure(error, details);
    }
    if (response.status === 401 && !retried) {
      token = null;
      return get(path, true);
    }
    if (!response.ok) {
      const category = response.status === 401 || response.status === 403 ? 'auth' : 'upstream';
      throw new QfUnavailableError('Quran Foundation content request failed', category, { ...details, status: response.status });
    }
    try {
      return await response.json();
    } catch {
      throw new QfUnavailableError('Quran Foundation content response was not JSON', 'malformed', { ...details, status: response.status });
    }
  }

  async function stream(path: string, { timeoutMs: limit, signal }: { timeoutMs: number; signal?: AbortSignal }, retried = false): Promise<ReadableStream<Uint8Array>> {
    const value = await accessToken();
    const details = { stage: 'content' as const, environment, path: pathOnly(path) };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limit);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(`${hosts.api}${path}`, {
        headers: { 'x-auth-token': value, 'x-client-id': credentials.clientId, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw connectionFailure(error, details);
    }
    if (response.status === 401 && !retried) {
      clearTimeout(timer);
      token = null;
      return stream(path, { timeoutMs: limit, signal }, true);
    }
    if (!response.ok || !response.body) {
      clearTimeout(timer);
      const category = response.status === 401 || response.status === 403 ? 'auth' : response.ok ? 'malformed' : 'upstream';
      throw new QfUnavailableError('Quran Foundation content request failed', category, { ...details, status: response.status });
    }
    // The timer keeps running while the caller reads; it is cleared when the body ends or fails.
    const reader = response.body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(out) {
        try {
          const { value: chunk, done } = await reader.read();
          if (done) { clearTimeout(timer); out.close(); } else out.enqueue(chunk);
        } catch (error) {
          clearTimeout(timer);
          out.error(connectionFailure(error, details));
        }
      },
      cancel(reason) { clearTimeout(timer); controller.abort(); return reader.cancel(reason); },
    });
  }

  return { get: (path) => get(path), stream: (path, options) => stream(path, options) };
}
