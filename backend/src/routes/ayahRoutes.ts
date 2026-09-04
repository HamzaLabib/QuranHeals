import { Router } from 'express';

import { createAyahController } from '../controllers/ayahController';
import { asyncHandler } from '../middleware/asyncHandler';
import type { QuranRepository } from '../services/QuranRepository';

export function createAyahRoutes(repository: QuranRepository) {
  const router = Router();
  const controller = createAyahController(repository);

  router.get('/random', asyncHandler(controller.getRandomAyah));
  router.get('/:id', asyncHandler(controller.getAyahById));

  return router;
}

