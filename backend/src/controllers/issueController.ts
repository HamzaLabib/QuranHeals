import type { Request, Response } from 'express';

import { AppError } from '../errors/AppError';
import type { IssueReportRepository } from '../services/IssueReportRepository';
import { createIssueReportSchema } from '../validators/issueValidators';

export function createIssueController(repository: IssueReportRepository) {
  return {
    // Deliberately never reads req.auth — an issue report is accepted the
    // same way whether or not the caller is signed in (Part I §34/§37), and
    // never automatically attaches account/profile data. See Part I §38.
    createIssueReport: async (req: Request, res: Response) => {
      const parsed = createIssueReportSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid issue report.', 400);
      }

      await repository.create(parsed.data);
      res.status(201).json({ success: true, data: null });
    },
  };
}
