import { createApp } from '../../src/app';
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

export function buildAccountTestApp() {
  const userRepository = new InMemoryUserRepository();
  const syncRepository = new InMemorySyncRepository();
  const issueReportRepository = new InMemoryIssueReportRepository();
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
