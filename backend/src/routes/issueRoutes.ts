import { Router } from 'express';

import { createIssueController } from '../controllers/issueController';
import { asyncHandler } from '../middleware/asyncHandler';
import type { IssueReportRepository } from '../services/IssueReportRepository';

export function createIssueRoutes(repository: IssueReportRepository, onReportSaved?: () => void) {
  const router = Router();
  const controller = createIssueController(repository, onReportSaved);

  // Deliberately no GET here — submission only. See Part I §41.
  router.post('/', asyncHandler(controller.createIssueReport));

  return router;
}
