/**
 * Transactional email delivery behind a small interface, so the notifier
 * never depends on a specific provider and tests never send real email.
 *
 * Results carry only short codes (`http_503`, `http_409:invalid_idempotent_request`,
 * `timeout`, ...). From a provider's response only two fields are ever read:
 * the error `name` (kept only if it looks like a code) and the accepted
 * email's `id`. The free-text `message` is never read into an error, a log
 * or Sentry, since it could echo addresses or content.
 *
 * `ok: true` means the provider ACCEPTED the email for delivery — not that
 * it reached the inbox. Delivery, bounces and spam placement are only
 * visible in the provider's dashboard (by `providerMessageId`) or the inbox.
 */

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** Stable per notification, so a retry of an already-accepted send is deduplicated where the provider supports it. */
  idempotencyKey: string;
};

export type SendResult = { ok: true; providerMessageId?: string } | { ok: false; retryable: boolean; code: string };

export interface EmailProvider {
  readonly name: string;
  /** Never throws: every failure is a SendResult. */
  send(email: OutgoingEmail): Promise<SendResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; json?: () => Promise<unknown> }>;

export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const RESEND_TIMEOUT_MS = 15_000;

const ERROR_NAME = /^[a-z_]{1,30}$/;
const MESSAGE_ID = /^[A-Za-z0-9-]{1,64}$/;

/**
 * Resend errors (resend.com/docs/api-reference/errors) that change the
 * status-based default below:
 *  - 409 invalid_idempotent_request: the key was already used within 24 h
 *    with a DIFFERENT payload. Retrying the same request can never succeed,
 *    and an earlier attempt may already have been accepted — permanent.
 *  - 429 monthly_quota_exceeded: won't clear within the retry schedule — permanent.
 * Retried: 409 concurrent_idempotent_requests (the same send is still in
 * flight) and resource_locked, any other 409/429 (rate_limit_exceeded,
 * daily_quota_exceeded, which resets at 00:00 UTC), 408 and 5xx.
 * Everything else (400/401/403/404/422 — including the 403 a resend.dev
 * sender gets for any recipient other than the account's own address) is
 * permanent.
 */
const PERMANENT_ERROR_NAMES = new Set(['invalid_idempotent_request', 'monthly_quota_exceeded']);

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function classifyResendError(status: number, name: string | undefined): { retryable: boolean; code: string } {
  const code = name ? `http_${status}:${name}` : `http_${status}`;
  if (name && PERMANENT_ERROR_NAMES.has(name)) return { retryable: false, code };
  return { retryable: isRetryableStatus(status), code };
}

async function readField(response: { json?: () => Promise<unknown> }, field: 'name' | 'id', pattern: RegExp): Promise<string | undefined> {
  try {
    const value = ((await response.json?.()) as Record<string, unknown> | null)?.[field];
    return typeof value === 'string' && pattern.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resend's REST API over fetch (no SDK dependency). The Idempotency-Key
 * header makes Resend return the original result instead of sending again
 * when the same notification is retried within its 24-hour key window —
 * which requires the retry's body to be identical (see
 * buildIssueReportEmail: built only from stored report fields and config).
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly timeoutMs = RESEND_TIMEOUT_MS,
  ) {}

  async send(email: OutgoingEmail): Promise<SendResult> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': email.idempotencyKey,
        },
        body: JSON.stringify({ from: email.from, to: [email.to], subject: email.subject, text: email.text }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const name = (error as { name?: unknown })?.name;
      return { ok: false, retryable: true, code: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
    }
    if (response.status >= 200 && response.status < 300) {
      const providerMessageId = await readField(response, 'id', MESSAGE_ID);
      return providerMessageId ? { ok: true, providerMessageId } : { ok: true };
    }
    return { ok: false, ...classifyResendError(response.status, await readField(response, 'name', ERROR_NAME)) };
  }
}

/**
 * Development only (ISSUE_REPORT_EMAIL=log): exercises the whole outbox
 * without sending anything. Logs the report id line only, never content.
 */
export class LogEmailProvider implements EmailProvider {
  readonly name = 'log';

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(email: OutgoingEmail): Promise<SendResult> {
    this.log(`[issue-report-email] log provider: would send "${email.subject}" (${email.idempotencyKey}); nothing was sent.`);
    return { ok: true };
  }
}
