import { Router } from 'express';

import { createIssueController } from '../controllers/issueController';
import { asyncHandler } from '../middleware/asyncHandler';
import type { IssueReportRepository } from '../services/IssueReportRepository';

export function createIssueRoutes(repository: IssueReportRepository) {
  const router = Router();
  const controller = createIssueController(repository);

  // Deliberately no GET here — submission only. See Part I §41.
  router.post('/', asyncHandler(controller.createIssueReport));

  return router;
}
