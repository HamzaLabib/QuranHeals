import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { Router, type Request, type Response } from 'express';

/**
 * The tafsir reader's optional editions (mounted under /api/tafsir):
 *
 *   GET /v1/editions/:edition/:sha256.json     one edition's app file, exactly as tools/tafsir/build.mjs wrote it
 *
 * Files live in backend/data/tafsir/<edition>/<sha256>.json (git-ignored; written by tools/tafsir/build.mjs, and only
 * for an edition whose source and redistribution rights are verified — tools/tafsir/README.md). Each name is its
 * content's SHA-256, checked here before a file is first served, and again by the app against the pin it was built
 * with (mobile/src/tafsir/generated/tafsirRelease.ts), so a file is immutable and can be cached for good. Public, like
 * the rest of the Quran content. Nothing else is listed or served: no directory listing, no other names.
 */
export const TAFSIR_EDITIONS = ['muyassar', 'saadi', 'jalalayn', 'zilal'] as const;
const SHA256 = /^[0-9a-f]{64}$/;

export const resolveTafsirDataDir = () => resolve(__dirname, '../../data/tafsir');

export function createTafsirRoutes(dir: string | null): Router {
  const router = Router();
  // Verified files, read once (an edition is a few MB; the set is small and immutable).
  const verified = new Map<string, Promise<Buffer | null>>();

  const load = (edition: string, sha256: string) => {
    const key = `${edition}/${sha256}`;
    let file = verified.get(key);
    if (!file) {
      file = (async () => {
        if (!dir) return null;
        try {
          const bytes = await readFile(join(dir, edition, `${sha256}.json`));
          return createHash('sha256').update(bytes).digest('hex') === sha256 ? bytes : null;
        } catch {
          return null;
        }
      })();
      verified.set(key, file);
      // A missing file may be added later (a new build): forget the miss.
      void file.then((bytes) => {
        if (!bytes) verified.delete(key);
      });
    }
    return file;
  };

  router.get('/v1/editions/:edition/:file', async (req: Request, res: Response) => {
    const edition = String(req.params.edition);
    const match = /^([0-9a-f]{64})\.json$/.exec(String(req.params.file));
    const bytes = (TAFSIR_EDITIONS as readonly string[]).includes(edition) && match && SHA256.test(match[1]) ? await load(edition, match[1]) : null;
    if (!bytes) {
      res.status(404).json({ success: false, message: 'This tafsir is not available.' });
      return;
    }
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(bytes);
  });

  return router;
}
