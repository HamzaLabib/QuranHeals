import { Router } from 'express';

import type { AppleRevocationClient } from '../auth/appleRevocationClient';
import type { AppleTokenVerifier } from '../auth/appleTokenVerifier';
import type { GoogleTokenVerifier } from '../auth/googleTokenVerifier';
import { createHealthController, type DatabaseHealthCheck } from '../controllers/healthController';
import { createRequireAuth } from '../middleware/requireAuth';
import type { AccountDeletionService } from '../services/AccountDeletionService';
import type { AppleCredentialRepository } from '../services/AppleCredentialRepository';
import type { IssueReportRepository } from '../services/IssueReportRepository';
import type { QuranRepository } from '../services/QuranRepository';
import type { SessionRepository } from '../services/SessionRepository';
import type { SyncRepository } from '../services/SyncRepository';
import type { UserRepository } from '../services/UserRepository';
import { createAccountRoutes } from './accountRoutes';
import { createAuthRoutes } from './authRoutes';
import { createAyahRoutes } from './ayahRoutes';
import { createEmotionRoutes } from './emotionRoutes';
import { createIssueRoutes } from './issueRoutes';
import { createSyncRoutes } from './syncRoutes';

export type AccountRouterDeps = {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  syncRepository: SyncRepository;
  issueReportRepository: IssueReportRepository;
  accountDeletionService: AccountDeletionService;
  appleCredentialRepository: AppleCredentialRepository;
  appleRevocationClient: AppleRevocationClient;
  googleVerifier: GoogleTokenVerifier;
  appleVerifier: AppleTokenVerifier;
};

export function createApiRouter(repository: QuranRepository, accountDeps: AccountRouterDeps, checkDatabase: DatabaseHealthCheck) {
  const router = Router();

  // Built once per app and shared by every protected route group below, so
  // there is exactly one DB-authoritative session/user check to reason
  // about (see middleware/requireAuth.ts) — never a second, divergent
  // implementation.
  const requireAuth = createRequireAuth({
    sessionRepository: accountDeps.sessionRepository,
    userRepository: accountDeps.userRepository,
  });

  router.get('/health', createHealthController(checkDatabase));
  router.use('/emotions', createEmotionRoutes(repository));
  router.use('/ayahs', createAyahRoutes(repository));

  router.use(
    '/auth',
    createAuthRoutes({
      userRepository: accountDeps.userRepository,
      sessionRepository: accountDeps.sessionRepository,
      googleVerifier: accountDeps.googleVerifier,
      appleVerifier: accountDeps.appleVerifier,
      appleRevocationClient: accountDeps.appleRevocationClient,
      appleCredentialRepository: accountDeps.appleCredentialRepository,
      requireAuth,
    }),
  );
  router.use(
    '/sync',
    createSyncRoutes(
      accountDeps.syncRepository,
      {
        userRepository: accountDeps.userRepository,
        googleVerifier: accountDeps.googleVerifier,
        appleVerifier: accountDeps.appleVerifier,
      },
      requireAuth,
    ),
  );
  router.use('/issues', createIssueRoutes(accountDeps.issueReportRepository));
  router.use(
    '/account',
    createAccountRoutes({
      accountDeletionService: accountDeps.accountDeletionService,
      userRepository: accountDeps.userRepository,
      appleCredentialRepository: accountDeps.appleCredentialRepository,
      appleRevocationClient: accountDeps.appleRevocationClient,
      googleVerifier: accountDeps.googleVerifier,
      appleVerifier: accountDeps.appleVerifier,
      requireAuth,
    }),
  );

  return router;
}

