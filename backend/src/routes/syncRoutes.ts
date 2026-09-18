import { Router } from 'express';

import { createSyncController } from '../controllers/syncController';
import { asyncHandler } from '../middleware/asyncHandler';
import { requireAuth } from '../middleware/requireAuth';
import type { SyncRepository } from '../services/SyncRepository';

export function createSyncRoutes(repository: SyncRepository) {
  const router = Router();
  const controller = createSyncController(repository);

  // Every route in this router requires a verified session — there is no
  // sync surface reachable as a guest. See Part B §7.
  router.use(requireAuth);

  router.get('/favorites', asyncHandler(controller.getFavorites));
  router.put('/favorites', asyncHandler(controller.putFavorites));
  router.delete('/favorites/:verseKey', asyncHandler(controller.deleteFavorite));

  router.get('/preferences', asyncHandler(controller.getPreferences));
  router.put('/preferences', asyncHandler(controller.putPreferences));

  router.get('/reflections', asyncHandler(controller.getReflections));
  router.put('/reflections', asyncHandler(controller.putReflections));

  router.get('/key', asyncHandler(controller.getSyncKey));
  router.put('/key', asyncHandler(controller.putSyncKey));
  router.patch('/key', asyncHandler(controller.replaceSyncKey));

  return router;
}
