import { Router } from 'express';

import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { healthController } from '../controllers/healthController';
import type { IssueReportRepository } from '../services/IssueReportRepository';
import type { QuranRepository } from '../services/QuranRepository';
import type { SyncRepository } from '../services/SyncRepository';
import type { UserRepository } from '../services/UserRepository';
import { createAuthRoutes } from './authRoutes';
import { createAyahRoutes } from './ayahRoutes';
import { createEmotionRoutes } from './emotionRoutes';
import { createIssueRoutes } from './issueRoutes';
import { createSyncRoutes } from './syncRoutes';

export type AccountRouterDeps = {
  userRepository: UserRepository;
  syncRepository: SyncRepository;
  issueReportRepository: IssueReportRepository;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

export function createApiRouter(repository: QuranRepository, accountDeps: AccountRouterDeps) {
  const router = Router();

  router.get('/health', healthController);
  router.use('/emotions', createEmotionRoutes(repository));
  router.use('/ayahs', createAyahRoutes(repository));

  router.use(
    '/auth',
    createAuthRoutes({
      userRepository: accountDeps.userRepository,
      googleVerifier: accountDeps.googleVerifier,
      appleVerifier: accountDeps.appleVerifier,
    }),
  );
  router.use('/sync', createSyncRoutes(accountDeps.syncRepository));
  router.use('/issues', createIssueRoutes(accountDeps.issueReportRepository));

  return router;
}

