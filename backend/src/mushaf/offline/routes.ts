import { Router, type Request, type Response } from 'express';

import type { MushafSyncStore } from './store';

/**
 * The app's side of the relay (mounted under /api/mushaf):
 *
 *   GET /qpc-v1/offline/manifest                  current version, its chunks (SHA-256, bytes), attribution
 *   GET /qpc-v1/offline/versions/:version/chunks/:index   one chunk, gzip-compressed JSON
 *
 * Public, like the rest of the Quran content: offline reading never depends
 * on a signed-in session. Chunks are immutable and content-addressed, so the
 * device may keep them; the manifest is never cached, so a device always
 * sees the latest version when it checks. A chunk is served only while its
 * version is the current one or one of the two before it (downloads in
 * progress), never after it is withdrawn.
 */
export function createMushafOfflineRoutes(store: MushafSyncStore | null): Router {
  const router = Router();
  const unavailable = (res: Response) => res.status(503).json({ success: false, message: 'The offline Mushaf is not available right now.' });

  router.get('/qpc-v1/offline/manifest', async (_req: Request, res: Response) => {
    const manifest = store ? await store.currentManifest().catch(() => null) : null;
    res.set('Cache-Control', 'no-store');
    if (!manifest) {
      unavailable(res);
      return;
    }
    res.json({ success: true, data: manifest });
  });

  router.get('/qpc-v1/offline/versions/:version/chunks/:index', async (req: Request, res: Response) => {
    const version = String(req.params.version);
    const index = /^\d{1,2}$/.test(String(req.params.index)) ? Number(req.params.index) : Number.NaN;
    const state = store ? await store.readState().catch(() => null) : null;
    const chunk = store && state && !state.deleted ? await store.readChunk(version, index) : null;
    if (!chunk) {
      res.status(404).json({ success: false, message: 'This part of the offline Mushaf is not available.' });
      return;
    }
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': String(chunk.length),
      // Immutable per version; private: for the app on this device only.
      'Cache-Control': 'private, max-age=31536000, immutable',
    });
    res.end(chunk);
  });

  return router;
}
