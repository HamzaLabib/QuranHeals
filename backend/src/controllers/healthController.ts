import type { Request, Response } from 'express';

import { env } from '../config/env';

export function healthController(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      status: 'ok',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.round(process.uptime()),
    },
  });
}

