import type { Request, Response } from 'express';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { RATE_LIMITED_MESSAGE } from '../middleware/rateLimits';
import type { IssueReportRepository } from '../services/IssueReportRepository';
import { createIssueReportSchema } from '../validators/issueValidators';

/**
 * `onReportSaved` runs only after the report is stored (today: wakes the
 * email notifier). It can't fail the request: the response is the same
 * whether or not notifications are enabled or the email provider is up.
 */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `dailyCap`: at most this many reports stored in any 24 hours, from everyone together (env ISSUE_REPORTS_DAILY_CAP;
 * 0 = off). The per-IP limit can't stop many addresses at once; this keeps the database from filling up. Refused
 * reports get the same 429 as a rate limit, and nothing is stored.
 */
export function createIssueController(
  repository: IssueReportRepository,
  onReportSaved?: () => void,
  options: { dailyCap?: number; now?: () => Date } = {},
) {
  const dailyCap = options.dailyCap ?? env.ISSUE_REPORTS_DAILY_CAP;
  const now = options.now ?? (() => new Date());
  return {
    // Deliberately never reads req.auth — an issue report is accepted the
    // same way whether or not the caller is signed in (Part I §34/§37), and
    // never automatically attaches account/profile data. See Part I §38.
    createIssueReport: async (req: Request, res: Response) => {
      const parsed = createIssueReportSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('Invalid issue report.', 400);
      }

      if (dailyCap > 0 && repository.countSince && (await repository.countSince(new Date(now().getTime() - DAY_MS))) >= dailyCap) {
        throw new AppError(RATE_LIMITED_MESSAGE, 429);
      }

      await repository.create(parsed.data);
      try {
        onReportSaved?.();
      } catch {
        // Delivery is retried from the outbox; never affects the response.
      }
      res.status(201).json({ success: true, data: null });
    },
  };
}
