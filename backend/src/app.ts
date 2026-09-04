import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { notFoundHandler } from './middleware/notFoundHandler';
import { createApiRouter } from './routes';
import { MongooseQuranRepository } from './services/MongooseQuranRepository';
import type { QuranRepository } from './services/QuranRepository';

type AppOptions = {
  repository?: QuranRepository;
};

function getCorsOrigin() {
  if (env.CORS_ORIGIN === '*') {
    return true;
  }

  return env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  const repository = options.repository ?? new MongooseQuranRepository();

  app.disable('x-powered-by');

  app.use(helmet());
  app.use(cors({ origin: getCorsOrigin() }));
  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: true, limit: '64kb' }));
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api', createApiRouter(repository));
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

