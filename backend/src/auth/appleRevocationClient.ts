import { AppError } from '../errors/AppError';
import { requireAppleRevocationConfig } from '../config/env';
import { generateAppleClientSecret } from './appleClientSecret';

export type AppleRequestOptions = { timeoutMs?: number };

export interface AppleRevocationClient {
  /** Exchanges a short-lived, single-use Sign in with Apple authorization code for a refresh token. */
  exchangeAuthorizationCode(authorizationCode: string, options?: AppleRequestOptions): Promise<{ refreshToken: string }>;
  /** Revokes a previously-obtained Apple refresh token. Resolves (never throws) if Apple reports the token is already invalid/revoked — that outcome already satisfies the goal. */
  revokeRefreshToken(refreshToken: string): Promise<void>;
}

const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_REVOKE_URL = 'https://appleid.apple.com/auth/revoke';

/**
 * Upper bound for each Apple request, including reading the response body.
 * A timeout is handled like any other Apple failure (generic 502, nothing
 * deleted), so account deletion stays intact and safely retryable.
 */
export const APPLE_REQUEST_TIMEOUT_MS = 10_000;

// One generic message for every Apple-side failure (network, timeout,
// invalid/expired code, invalid client secret, a genuine revoke failure) —
// never Apple's raw response. See Part B4 §8/§10.
const REVOCATION_FAILED_MESSAGE = 'Account deletion could not be completed. Please try again.';

type AppleTokenErrorResponse = { error?: string };
type AppleTokenSuccessResponse = { refresh_token?: string };

/**
 * Real server-to-server calls to Apple for account-deletion revocation —
 * never used for ordinary sign-in (that only ever verifies an identity
 * token, see appleTokenVerifier.ts). Never logs a raw authorization code,
 * refresh token, or Apple response body.
 */
export class HttpAppleRevocationClient implements AppleRevocationClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? APPLE_REQUEST_TIMEOUT_MS;
  }

  async exchangeAuthorizationCode(authorizationCode: string, options: AppleRequestOptions = {}): Promise<{ refreshToken: string }> {
    const { clientId } = requireAppleRevocationConfig();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: generateAppleClientSecret(),
      code: authorizationCode,
      grant_type: 'authorization_code',
    });

    let response: Response;
    try {
      response = await this.fetchImpl(APPLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
      });
    } catch {
      throw new AppError(REVOCATION_FAILED_MESSAGE, 502);
    }

    const payload = (await response.json().catch(() => null)) as AppleTokenSuccessResponse | null;
    if (!response.ok || !payload?.refresh_token) {
      throw new AppError(REVOCATION_FAILED_MESSAGE, 502);
    }

    return { refreshToken: payload.refresh_token };
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const { clientId } = requireAppleRevocationConfig();
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: generateAppleClientSecret(),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });

    let response: Response;
    try {
      response = await this.fetchImpl(APPLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new AppError(REVOCATION_FAILED_MESSAGE, 502);
    }

    if (response.ok) return;

    const payload = (await response.json().catch(() => null)) as AppleTokenErrorResponse | null;
    // Already invalid/revoked — the goal ("this token no longer authorizes
    // the app") is already true, so this is treated as success, not a
    // failure to retry. Any other error is genuine.
    if (payload?.error === 'invalid_token') return;

    throw new AppError(REVOCATION_FAILED_MESSAGE, 502);
  }
}
