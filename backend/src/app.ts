import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';

import { HttpAppleRevocationClient, type AppleRevocationClient } from './auth/appleRevocationClient';
import { AppleJwksVerifier, type AppleTokenVerifier } from './auth/appleTokenVerifier';
import { GoogleAuthLibraryVerifier, type GoogleTokenVerifier } from './auth/googleTokenVerifier';
import { pingDatabase } from './config/database';
import { env } from './config/env';
import type { DatabaseHealthCheck } from './controllers/healthController';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { createDiagnosticKey, describeForwardingChain, formatChainReport } from './middleware/clientIpDiagnostics';
import { createRateLimiters, type RateLimitName, type RateLimitPolicy } from './middleware/rateLimits';
import type { AccountRouterDeps } from './routes';
import { createApiRouter } from './routes';
import { MongooseAccountDeletionService } from './services/MongooseAccountDeletionService';
import { MongooseAppleCredentialRepository } from './services/MongooseAppleCredentialRepository';
import { MongooseIssueReportRepository } from './services/MongooseIssueReportRepository';
import { MongooseQuranRepository } from './services/MongooseQuranRepository';
import { MongooseSessionRepository } from './services/MongooseSessionRepository';
import { MongooseSyncRepository } from './services/MongooseSyncRepository';
import { MongooseUserRepository } from './services/MongooseUserRepository';
import type { AccountDeletionService } from './services/AccountDeletionService';
import type { AppleCredentialRepository } from './services/AppleCredentialRepository';
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
  /** Called after each saved issue report; server.ts passes the email notifier's nudge. */
  onIssueReportSaved?: () => void;
  accountDeletionService?: AccountDeletionService;
  appleCredentialRepository?: AppleCredentialRepository;
  appleRevocationClient?: AppleRevocationClient;
  googleVerifier?: GoogleTokenVerifier;
  appleVerifier?: AppleTokenVerifier;
  /** Defaults to a real MongoDB ping; tests inject their own. */
  databaseHealthCheck?: DatabaseHealthCheck;
  /** Tests only: override individual rate-limit policies (see middleware/rateLimits.ts). */
  rateLimits?: Partial<Record<RateLimitName, RateLimitPolicy>>;
  /** Tests only: override TRUST_PROXY_HOPS / ENDPOINT_RATE_LIMITS / CLIENT_IP_DIAGNOSTICS. */
  network?: { trustProxyHops?: number; endpointRateLimits?: boolean; clientIpDiagnostics?: boolean };
};

function getCorsOrigin() {
  if (env.CORS_ORIGIN === '*') {
    return true;
  }

  return env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const trustProxyHops = options.network?.trustProxyHops ?? env.TRUST_PROXY_HOPS;
  app.set('trust proxy', trustProxyHops);
  const repository = options.repository ?? new MongooseQuranRepository();
  const accountDeps: AccountRouterDeps = {
    userRepository: options.userRepository ?? new MongooseUserRepository(),
    sessionRepository: options.sessionRepository ?? new MongooseSessionRepository(),
    syncRepository: options.syncRepository ?? new MongooseSyncRepository(),
    issueReportRepository: options.issueReportRepository ?? new MongooseIssueReportRepository(),
    onIssueReportSaved: options.onIssueReportSaved,
    accountDeletionService: options.accountDeletionService ?? new MongooseAccountDeletionService(),
    appleCredentialRepository: options.appleCredentialRepository ?? new MongooseAppleCredentialRepository(),
    appleRevocationClient: options.appleRevocationClient ?? new HttpAppleRevocationClient(),
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
  if (options.network?.clientIpDiagnostics ?? env.CLIENT_IP_DIAGNOSTICS === 'true') {
    // Opt-in and header-gated: only requests that ask for it are logged, and
    // never with a real address — kinds and per-process keyed hashes only
    // (middleware/clientIpDiagnostics.ts). Finds the real proxy hop count.
    const diagnosticKey = createDiagnosticKey();
    app.get('/api/health', (req, _res, next) => {
      if (req.get('x-quran-heals-ip-check') === '1') {
        console.log(formatChainReport(describeForwardingChain({
          forwardedFor: req.get('x-forwarded-for') ?? '',
          socket: req.socket.remoteAddress ?? '',
          reqIp: req.ip ?? '',
          trustProxyHops,
          key: diagnosticKey,
        })));
      }
      next();
    });
  }

  const rateLimiters = createRateLimiters(options.rateLimits);
  app.use(rateLimiters.global);
  const endpointLimits = options.network?.endpointRateLimits ?? env.ENDPOINT_RATE_LIMITS === 'on';
  const passThrough: RequestHandler = (_req, _res, next) => next();
  if (endpointLimits) {
    // Stricter per-IP limits for unauthenticated endpoints that write or verify
    // provider tokens; the per-account limit is mounted inside the routers,
    // after requireAuth.
    app.post('/api/issues', rateLimiters.issueReports);
    app.post(['/api/auth/google', '/api/auth/apple'], rateLimiters.signIn);
    app.post(['/api/auth/refresh', '/api/auth/logout'], rateLimiters.sessionRefresh);
  }

  app.use('/api', createApiRouter(repository, accountDeps, options.databaseHealthCheck ?? pingDatabase, endpointLimits ? rateLimiters.accountReauth : passThrough));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

