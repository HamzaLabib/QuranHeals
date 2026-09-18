import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { AppleJwksVerifier, type AppleTokenVerifier } from './auth/appleTokenVerifier';
import { GoogleAuthLibraryVerifier, type GoogleTokenVerifier } from './auth/googleTokenVerifier';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import type { AccountRouterDeps } from './routes';
import { createApiRouter } from './routes';
import { MongooseAccountDeletionService } from './services/MongooseAccountDeletionService';
import { MongooseIssueReportRepository } from './services/MongooseIssueReportRepository';
import { MongooseQuranRepository } from './services/MongooseQuranRepository';
import { MongooseSessionRepository } from './services/MongooseSessionRepository';
import { MongooseSyncRepository } from './services/MongooseSyncRepository';
import { MongooseUserRepository } from './services/MongooseUserRepository';
import type { AccountDeletionService } from './services/AccountDeletionService';
import type { IssueReportRepository } from './services/IssueReportRepository';
import type { QuranRepository } from './services/QuranRepository';
import type { SessionRepository } from './services/SessionRepository';
import type { SyncRepository } from './services/SyncRepository';
import type { UserRepository } from './services/UserRepository';

type AppOptions = {
  repository?: QuranRepository;
  userRepository?: UserRepository;
  sessionRepository?: SessionRepository;
  syncRepository?: SyncRepository;
  issueReportRepository?: IssueReportRepository;
  accountDeletionService?: AccountDeletionService;
  googleVerifier?: GoogleTokenVerifier;
  appleVerifier?: AppleTokenVerifier;
};

function getCorsOrigin() {
  if (env.CORS_ORIGIN === '*') {
    return true;
  }

  return env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.set('trust proxy', 1);
  const repository = options.repository ?? new MongooseQuranRepository();
  const accountDeps: AccountRouterDeps = {
    userRepository: options.userRepository ?? new MongooseUserRepository(),
    sessionRepository: options.sessionRepository ?? new MongooseSessionRepository(),
    syncRepository: options.syncRepository ?? new MongooseSyncRepository(),
    issueReportRepository: options.issueReportRepository ?? new MongooseIssueReportRepository(),
    accountDeletionService: options.accountDeletionService ?? new MongooseAccountDeletionService(),
    googleVerifier: options.googleVerifier ?? new GoogleAuthLibraryVerifier(),
    appleVerifier: options.appleVerifier ?? new AppleJwksVerifier(),
  };

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: getCorsOrigin() }));
  // Raised from the original 64kb to fit a batch of encrypted reflection
  // uploads (Part D): a 2,000-character reflection, encrypted then
  // base64-encoded, runs several KB; putReflectionsSchema additionally caps
  // the batch size itself. Still a small, firm bound against abuse.
  app.use(express.json({ limit: '512kb' }));
  app.use(express.urlencoded({ extended: true, limit: '512kb' }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api', createApiRouter(repository, accountDeps));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

