import { createApp } from '../../src/app';
import type { RateLimitName, RateLimitPolicy } from '../../src/middleware/rateLimits';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { QuranRepository } from '../../src/services/QuranRepository';
import {
  InMemoryAccountDeletionService,
  InMemoryAppleCredentialRepository,
  InMemoryIssueReportRepository,
  InMemorySessionRepository,
  InMemorySyncRepository,
  InMemoryUserRepository,
  StubAppleRevocationClient,
  StubAppleVerifier,
  StubGoogleVerifier,
} from './fakes';

/** Auth/sync/issue tests never exercise Quran lookups — every method is unreachable from those routes. */
class UnusedQuranRepository implements QuranRepository {
  async listActiveEmotions() {
    return [];
  }
  async findActiveEmotionByKey() {
    return null;
  }
  async findRandomAyahByEmotion() {
    return null;
  }
  async findAyahById() {
    return null;
  }
}

export function buildAccountTestApp<R extends IssueReportRepository = InMemoryIssueReportRepository>(
  overrides: { issueReportRepository?: R; onIssueReportSaved?: () => void; rateLimits?: Partial<Record<RateLimitName, RateLimitPolicy>>; network?: { trustProxyHops?: number; endpointRateLimits?: boolean; clientIpDiagnostics?: boolean } } = {},
) {
  const userRepository = new InMemoryUserRepository();
  const sessionRepository = new InMemorySessionRepository();
  const syncRepository = new InMemorySyncRepository();
  const issueReportRepository =
    (overrides.issueReportRepository ?? new InMemoryIssueReportRepository()) as R;
  const appleCredentialRepository = new InMemoryAppleCredentialRepository();

  const accountDeletionService = new InMemoryAccountDeletionService(
    userRepository,
    syncRepository,
    sessionRepository,
    appleCredentialRepository,
  );
  const googleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();
  const appleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();
  const appleRevocationClient = new StubAppleRevocationClient();

  const app = createApp({
    repository: new UnusedQuranRepository(),
    userRepository,
    sessionRepository,
    syncRepository,
    issueReportRepository,
    onIssueReportSaved: overrides.onIssueReportSaved,
    accountDeletionService,
    appleCredentialRepository,
    appleRevocationClient,
    googleVerifier: new StubGoogleVerifier(googleTokens),
    appleVerifier: new StubAppleVerifier(appleTokens),
    // In-memory repositories, so the database is "up" for /api/health.
    databaseHealthCheck: async () => true,
    rateLimits: overrides.rateLimits,
    // Endpoint limits default to off in production config; the account suites
    // exercise the app with them on unless a test says otherwise.
    network: { endpointRateLimits: true, ...overrides.network },
  });

  return {
    app,
    userRepository,
    sessionRepository,
    syncRepository,
    issueReportRepository,
    accountDeletionService,
    appleCredentialRepository,
    appleRevocationClient,
    googleTokens,
    appleTokens,
  };
}
