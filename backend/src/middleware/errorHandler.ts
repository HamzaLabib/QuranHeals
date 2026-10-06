import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { describeError, reportError } from '../monitoring/monitoring';

/** express.json()/urlencoded() failures: malformed or oversized bodies. They carry the raw body, so they're never logged or reported. */
function bodyParserStatus(error: unknown): number | null {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  return typeof type === 'string' && type.startsWith('entity.') && typeof status === 'number' && status >= 400 && status < 500 ? status : null;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  const context = { method: req.method, route: req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || undefined };

  if (error instanceof AppError) {
    // Expected 4xx are normal traffic; a 5xx AppError (e.g. Apple unreachable) is worth knowing about.
    if (error.statusCode >= 500) reportError(error, context);
    res.status(error.statusCode).json({
      success: false,
      message: error.expose ? error.message : 'Something went wrong.',
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Invalid request.',
    });
    return;
  }

  const clientStatus = bodyParserStatus(error);
  if (clientStatus !== null) {
    res.status(clientStatus).json({ success: false, message: 'Invalid request.' });
    return;
  }

  // Name + scrubbed message + stack only — never the whole error object,
  // which may carry request data.
  if (env.NODE_ENV !== 'test') {
    console.error('Unhandled request error:', describeError(error), error instanceof Error ? error.stack?.split('\n').slice(1, 6).join('\n') : '');
  }
  reportError(error, context);

  res.status(500).json({
    success: false,
    message: 'Something went wrong.',
  });
};
