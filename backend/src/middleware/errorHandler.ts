import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';

import { env } from '../config/env';
import { AppError } from '../errors/AppError';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
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

  if (env.NODE_ENV !== 'test') {
    console.error(error);
  }

  res.status(500).json({
    success: false,
    message: 'Something went wrong.',
  });
};

