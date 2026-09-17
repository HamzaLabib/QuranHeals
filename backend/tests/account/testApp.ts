import { createApp } from '../../src/app';
import type { IssueReportRepository } from '../../src/services/IssueReportRepository';
import type { QuranRepository } from '../../src/services/QuranRepository';
import {
  InMemoryAccountDeletionService,
  InMemoryIssueReportRepository,
  InMemorySessionRepository,
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
  const sessionRepository = new InMemorySessionRepository();
  const syncRepository = new InMemorySyncRepository();
<<<<<<< HEAD
  const issueReportRepository = new InMemoryIssueReportRepository();
  const accountDeletionService = new InMemoryAccountDeletionService(userRepository, syncRepository, sessionRepository);
=======
  const issueReportRepository = (overrides.issueReportRepository ?? new InMemoryIssueReportRepository()) as R;
>>>>>>> 80cb8753b23724fbe64b6695fbc79ff88f2a783f
  const googleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();
  const appleTokens = new Map<string, { providerSubject: string; email?: string; emailVerified?: boolean }>();

  const app = createApp({
    repository: new UnusedQuranRepository(),
    userRepository,
    sessionRepository,
    syncRepository,
    issueReportRepository,
    accountDeletionService,
    googleVerifier: new StubGoogleVerifier(googleTokens),
    appleVerifier: new StubAppleVerifier(appleTokens),
  });

  return {
    app,
    userRepository,
    sessionRepository,
    syncRepository,
    issueReportRepository,
    accountDeletionService,
    googleTokens,
    appleTokens,
  };
}
