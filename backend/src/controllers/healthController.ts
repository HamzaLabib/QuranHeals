import type { Request, Response } from 'express';

import { env } from '../config/env';

export type DatabaseHealthCheck = () => Promise<boolean>;

/**
 * Uptime-monitor endpoint: 200 only when the app is up AND MongoDB answers
 * a ping; 503 otherwise. Reports status words only — never the database
 * name, host, URI or any error detail.
 */
export function createHealthController(checkDatabase: DatabaseHealthCheck) {
  return async function healthController(_req: Request, res: Response) {
    const databaseConnected = await checkDatabase().catch(() => false);
    res.status(databaseConnected ? 200 : 503).json({
      success: databaseConnected,
      data: {
        status: databaseConnected ? 'ok' : 'degraded',
        database: databaseConnected ? 'connected' : 'unavailable',
        environment: env.NODE_ENV,
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  };
}
