import { Router } from 'express';

import { createEmotionController } from '../controllers/emotionController';
import { asyncHandler } from '../middleware/asyncHandler';
import type { QuranRepository } from '../services/QuranRepository';

export function createEmotionRoutes(repository: QuranRepository) {
  const router = Router();
  const controller = createEmotionController(repository);

  router.get('/', asyncHandler(controller.listEmotions));

  return router;
}

