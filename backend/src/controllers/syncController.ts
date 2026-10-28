import type { Request, Response } from 'express';

import { verifyFreshProviderReauthentication, type ReauthenticationDeps } from '../auth/providerReauthentication';
import { AppError } from '../errors/AppError';
import type { AuthenticatedRequest } from '../middleware/requireAuth';
import { acceptClientInstant, acceptCreatedAt } from '../services/clientInstants';
import type { IncomingFavoriteRecord, IncomingReflectionRecord, SyncRepository } from '../services/SyncRepository';
import { pullReadingQuerySchema, pushReadingSchema } from '../validators/readingSyncValidators';
import {
  favoriteVerseKeyParamsSchema,
  putFavoritesSchema,
  putPreferencesSchema,
  putReflectionsSchema,
  putSyncKeySchema,
  replaceSyncKeySchema,
  resetReflectionSyncSchema,
} from '../validators/syncValidators';

function userId(req: Request): string {
  // Every route this reads from is mounted behind requireAuth, which is the
  // only place `auth.userId` is ever set — always from a verified session
  // token, never a request body/query field. See Part B §7.
  return (req as AuthenticatedRequest).auth.userId;
}

// Device-declared instants, as stored (services/clientInstants.ts): one
// server time per request, so every record in it is judged the same way.

function acceptFavoriteRecord(record: IncomingFavoriteRecord, now: number): IncomingFavoriteRecord {
  if (record.type === 'tombstone') return { ...record, deletedAt: acceptClientInstant(record.deletedAt, now) };
  const updatedAt = acceptClientInstant(record.updatedAt, now);
  return { ...record, updatedAt, createdAt: acceptCreatedAt(record.createdAt, updatedAt, now) };
}

function acceptReflectionRecord(record: IncomingReflectionRecord, now: number): IncomingReflectionRecord {
  if (record.type === 'tombstone') return { ...record, deletedAt: acceptClientInstant(record.deletedAt, now) };
  const updatedAt = acceptClientInstant(record.updatedAt, now);
  return { ...record, updatedAt, createdAt: acceptCreatedAt(record.createdAt, updatedAt, now) };
}

export function createSyncController(repository: SyncRepository, reauthentication: ReauthenticationDeps) {
  return {
    getFavorites: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listFavorites(userId(req)) });
    },

    /** Both active favorites and deletion tombstones — only ever called by tombstone-aware clients (see routes/syncRoutes.ts). */
    getFavoritesSync: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listFavoriteSyncRecords(userId(req)) });
    },

    putFavorites: async (req: Request, res: Response) => {
      const parsed = putFavoritesSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid favorites payload.', 400);

      if ('verseKeys' in parsed.data) {
        res.json({ success: true, data: await repository.addFavorites(userId(req), parsed.data.verseKeys) });
        return;
      }

      const now = Date.now();
      const favorites = parsed.data.favorites.map((record) => acceptFavoriteRecord(record, now));
      res.json({ success: true, data: { saved: await repository.putFavorites(userId(req), favorites) } });
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

      const { updatedAt, fieldUpdatedAt, ...preferences } = parsed.data;
      const now = Date.now();
      const acceptedFieldUpdatedAt = fieldUpdatedAt
        ? Object.fromEntries(Object.entries(fieldUpdatedAt).flatMap(([field, at]) => (at === undefined ? [] : [[field, acceptClientInstant(at, now)]])))
        : undefined;
      res.json({
        success: true,
        data: await repository.putPreferences(userId(req), preferences, acceptClientInstant(updatedAt, now), acceptedFieldUpdatedAt),
      });
    },

    getReflections: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listReflections(userId(req)) });
    },

    /** Encrypted versions preserved by exact-timestamp conflicts; decrypted only on the device. */
    getReflectionConflicts: async (req: Request, res: Response) => {
      res.json({ success: true, data: await repository.listReflectionConflicts(userId(req)) });
    },

    putReflections: async (req: Request, res: Response) => {
      const parsed = putReflectionsSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid reflections payload.', 400);

      // Ciphertext must be encrypted under the account's CURRENT master key
      // when that key has a fingerprint. Refuses stale ciphertext — e.g.
      // from another device still holding the key a forgotten-password
      // reset replaced — so it can never reappear. Deletion markers carry
      // no ciphertext and are unaffected. Keys created before fingerprints
      // existed are not checked.
      const currentKey = await repository.getSyncKey(userId(req));
      if (
        currentKey?.keyFingerprint &&
        parsed.data.reflections.some((record) => record.type === 'active' && record.keyFingerprint !== currentKey.keyFingerprint)
      ) {
        throw new AppError('The reflection sync key has changed. Unlock sync again and retry.', 409);
      }

      const now = Date.now();
      const reflections = parsed.data.reflections.map((record) => acceptReflectionRecord(record, now));
      res.json({ success: true, data: await repository.putReflections(userId(req), reflections) });
    },

    /** أورادي وختماتي: this account's records changed after `since` (docs/auth-and-sync/reading-sync.md). */
    getReading: async (req: Request, res: Response) => {
      const parsed = pullReadingQuerySchema.safeParse(req.query);
      if (!parsed.success) throw new AppError('Invalid reading sync query.', 400);
      res.json({ success: true, data: await repository.pullReading(userId(req), parsed.data.since, parsed.data.limit) });
    },

    /**
     * أورادي وختماتي: a batch of record changes, for the authenticated
     * account only. Account-based like favorites: no Sync Password, and
     * nothing to do with the reflections' key. Its content is never logged
     * (AppError messages here are fixed strings).
     */
    pushReading: async (req: Request, res: Response) => {
      const parsed = pushReadingSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Invalid reading sync payload.', 400);
      res.json({ success: true, data: await repository.pushReading(userId(req), parsed.data.changes) });
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

      const created = await repository.putSyncKey(userId(req), parsed.data);
      // A new key after a reset: anything uploaded under another key in the
      // meantime (another device still holding the old key) is removed, so
      // it can never be shown as this account's data.
      if (created.keyFingerprint) {
        await repository.deleteReflectionsNotEncryptedWith(userId(req), created.keyFingerprint);
      }
      res.json({ success: true, data: created });
    },

    /**
     * Forgotten sync password: the password cannot be recovered and the
     * server cannot decrypt anything, so the only recovery is to discard
     * the encrypted reflection sync state and start a new key. Scoped to
     * the authenticated user only; never touches favorites, preferences,
     * sessions, or the account. Idempotent.
     *
     * Requires BOTH the Quran Heals session (requireAuth) AND a fresh ID
     * token from the account's own Apple/Google identity, verified here
     * before anything is deleted — see auth/providerReauthentication.ts.
     */
    resetReflectionSync: async (req: Request, res: Response) => {
      const parsed = resetReflectionSyncSchema.safeParse(req.body);
      if (!parsed.success) throw new AppError('Identity verification is required.', 400);

      const currentUserId = userId(req);
      await verifyFreshProviderReauthentication(reauthentication, currentUserId, parsed.data, {
        notIssuedBefore: await repository.getSyncKeyCreatedAt(currentUserId),
      });

      await repository.resetReflectionSync(currentUserId);
      res.json({ success: true, data: null });
    },
  };
}
