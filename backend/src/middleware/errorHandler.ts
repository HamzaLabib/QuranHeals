import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';
import { safeStackFrames } from '../monitoring/errorSanitizer';
import { describeError, reportError } from '../monitoring/monitoring';

/**
 * body-parser's client errors that aren't `entity.*`: refused encodings (inflate is off) or charsets, too many form
 * fields, and raw-body's aborted or wrongly sized requests. Only 4xx statuses count (bodyParserStatus).
 */
const BODY_PARSER_TYPES = new Set(['encoding.unsupported', 'charset.unsupported', 'parameters.too.many', 'querystring.parse.rangeError', 'request.aborted', 'request.size.invalid']);

/** express.json()/urlencoded() failures: malformed, oversized or refused bodies. They may carry the raw body, so they're never logged or reported. */
function bodyParserStatus(error: unknown): number | null {
  const { type, status } = (error ?? {}) as { type?: unknown; status?: unknown };
  const isBodyParserType = typeof type === 'string' && (type.startsWith('entity.') || BODY_PARSER_TYPES.has(type));
  return isBodyParserType && typeof status === 'number' && status >= 400 && status < 500 ? status : null;
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
    console.error('Unhandled request error:', describeError(error), safeStackFrames(error));
  }
  reportError(error, context);

  res.status(500).json({
    success: false,
    message: 'Something went wrong.',
  });
};
