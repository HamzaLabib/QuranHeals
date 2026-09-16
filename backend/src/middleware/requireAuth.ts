import type { NextFunction, Request, Response } from 'express';

import { verifySessionToken } from '../auth/session';
import { AppError } from '../errors/AppError';

export type AuthenticatedRequest = Request & { auth: { userId: string } };

const BEARER_PREFIX = 'Bearer ';

/**
 * The only place a request's userId is ever established for an authenticated
 * route. Always derived from a verified session token in the Authorization
 * header — a request body's own `userId` field (if any) is never read for
 * this purpose. See Part B §7: "Never trust { userId: '123' } simply
 * because the mobile client sent it."
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');

  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new AppError('Sign in required.', 401);
  }

  const token = header.slice(BEARER_PREFIX.length).trim();
  const { userId } = verifySessionToken(token);

  (req as AuthenticatedRequest).auth = { userId };
  next();
}
