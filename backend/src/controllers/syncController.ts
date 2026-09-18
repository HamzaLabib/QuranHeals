import type { Request, Response } from 'express';

import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import type { SyncRepository } from '../services/SyncRepository';
import {
  favoriteVerseKeyParamsSchema,
  putFavoritesSchema,
  putPreferencesSchema,
  putReflectionsSchema,
  putSyncKeySchema,
  replaceSyncKeySchema,
} from '../validators/syncValidators';

function userId(req: Request): string {
  // Every route this reads from is mounted behind requireAuth, which is the
  // only place `auth.userId` is ever set — always from a verified session
  // token, never a request body/query field. See Part B §7.
  return (req as AuthenticatedRequest).auth.userId;
}

export function createSyncController(repository: SyncRepository) {
  return {
    getFavorites: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listFavorites(userId(req)) });
    },

    putFavorites: async (req: Request, res: Response) => {
      const parsed = putFavoritesSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid favorites payload.', 400);

      res.json({ success: true, data: await repository.addFavorites(userId(req), parsed.data.verseKeys) });
    },

    deleteFavorite: async (req: Request, res: Response) => {
      const parsed = favoriteVerseKeyParamsSchema.safeParse(req.params);
      if (!parsed.success) throw new AppError('Invalid verse key.', 400);

      await repository.removeFavorite(userId(req), parsed.data.verseKey);
      res.json({ success: true, data: null });
    },

    getPreferences: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.getPreferences(userId(req)) });
    },

    putPreferences: async (req: Request, res: Response) => {
      const parsed = putPreferencesSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid preferences payload.', 400);

      const { updatedAt, ...preferences } = parsed.data;
      res.json({ success: true, data: await repository.putPreferences(userId(req), preferences, updatedAt) });
    },

    getReflections: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listReflections(userId(req)) });
    },

    putReflections: async (req: Request, res: Response) => {
      const parsed = putReflectionsSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid reflections payload.', 400);

      res.json({ success: true, data: await repository.putReflections(userId(req), parsed.data.reflections) });
    },

    getSyncKey: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.getSyncKey(userId(req)) });
    },

    replaceSyncKey: async (req: Request, res: Response) => {
      const parsed = replaceSyncKeySchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid sync key replacement.', 400);
      const saved = await repository.replaceSyncKey(userId(req), parsed.data.expected, parsed.data.replacement);
      if (!saved) throw new AppError('The sync key has changed. Reload and try again.', 409);
      res.json({ success: true, data: saved });
    },

    putSyncKey: async (req: Request, res: Response) => {
      const parsed = putSyncKeySchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid sync key payload.', 400);

      const existing = await repository.getSyncKey(userId(req));
      if (existing) {
        // A device only ever creates the sync key once; a second device
        // that already has one should download and unwrap it, never
        // silently replace it (that would orphan every device that unwrapped
        // the old key). See docs/reflection-privacy.md.
        throw new AppError('A sync key already exists for this account.', 409);
      }

      res.json({ success: true, data: await repository.putSyncKey(userId(req), parsed.data) });
    },
  };
}
