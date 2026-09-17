import { createApp } from '../../src/app';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { QuranRepository } from '../../src/services/QuranRepository';
import {
  InMemoryIssueReportRepository,
  InMemorySyncRepository,
  InMemoryUserRepository,
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
  overrides: { issueReportRepository?: R } = {},
) {
  const userRepository = new InMemoryUserRepository();
  const syncRepository = new InMemorySyncRepository();
  const issueReportRepository = (overrides.issueReportRepository ?? new InMemoryIssueReportRepository()) as R;
  const googleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();
  const appleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();

  const app = createApp({
    repository: new UnusedQuranRepository(),
    userRepository,
    syncRepository,
    issueReportRepository,
    googleVerifier: new StubGoogleVerifier(googleTokens),
    appleVerifier: new StubAppleVerifier(appleTokens),
  });

  return { app, userRepository, syncRepository, issueReportRepository, googleTokens, appleTokens };
}
