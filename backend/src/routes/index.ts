import { Router } from 'express';

import { healthController } from '../controllers/healthController';
import type { QuranRepository } from '../services/QuranRepository';
import { createAyahRoutes } from './ayahRoutes';
import { createEmotionRoutes } from './emotionRoutes';

export function createApiRouter(repository: QuranRepository) {
  const router = Router();

  router.get('/health', healthController);
  router.use('/emotions', createEmotionRoutes(repository));
  router.use('/ayahs', createAyahRoutes(repository));

  return router;
}

