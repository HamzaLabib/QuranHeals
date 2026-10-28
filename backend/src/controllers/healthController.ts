import type { Request, Response } from 'express';

import { env } from '../config/env';

export type DatabaseHealthCheck = () => Promise<boolean>;

/**
 * The deployed commit, so a release can be checked against the backend it
 * talks to (release audit B7). Render sets RENDER_GIT_COMMIT on every deploy
 * from Git; elsewhere it is "unknown". Only a 7–40 character hex hash is
 * reported (the repository is public, so it reveals nothing new).
 */
export function deployedRevision(environment: Record<string, string | undefined> = process.env): string {
  const commit = environment.RENDER_GIT_COMMIT?.trim() ?? '';
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 12).toLowerCase() : 'unknown';
}

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
        revision: deployedRevision(),
      },
    });
  };
}
