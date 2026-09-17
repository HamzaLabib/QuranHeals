import { z } from 'zod';

import { isValidVerseKey } from '../quran/referenceKeys';

const verseKeySchema = z.string().trim().refine((key) => isValidVerseKey(key), 'Invalid verse key.');
const isoDateSchema = z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp.');
const translationDisplayModeSchema = z.enum(['always', 'on-demand', 'off']);

export const putFavoritesSchema = z.object({
  verseKeys: z.array(verseKeySchema).min(1).max(2000),
});

export const favoriteVerseKeyParamsSchema = z.object({
  verseKey: verseKeySchema,
});

export const putPreferencesSchema = z.object({
  locale: z.enum(['en', 'ar', 'ar-EG']).optional(),
  translationDisplayMode: translationDisplayModeSchema.optional(),
  translationId: z.string().trim().min(1).max(80).optional(),
  updatedAt: isoDateSchema,
});

// Generous but bounded: a 2,000-character reflection (worst case ~4,000
// UTF-8 bytes for Arabic text) plus XChaCha20-Poly1305's 16-byte tag, then
// base64-encoded, comes out to roughly 5,400 characters; 8,000 leaves
// headroom for format overhead without allowing an unbounded payload.
//
// `type` is optional here and normalized to `'active'` by `.transform()` —
// every mobile client/test predating deletion tombstones sends an active
// record with no `type` field at all, and that must keep validating exactly
// as before (backward compatibility, Part D §29).
const activeReflectionRecordSchema = z
  .object({
    type: z.literal('active').optional(),
    verseKey: verseKeySchema,
    ciphertext: z.string().trim().min(1).max(8000),
    nonce: z.string().trim().min(1).max(128),
    encryptionVersion: z.number().int().min(1).max(100),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  })
  .transform((value) => ({ ...value, type: 'active' as const }));

/**
 * A durable local-deletion marker (see
 * docs/auth-and-sync/reflection-privacy.md). Deliberately declares no
 * ciphertext/nonce/encryptionVersion/createdAt field — zod's default
 * (non-strict) object parsing strips any such field a caller might still
 * send, so a tombstone can never carry reflection content to the backend.
 */
const tombstoneRecordSchema = z.object({
  type: z.literal('tombstone'),
  verseKey: verseKeySchema,
  deletedAt: isoDateSchema,
});

// A union (not discriminatedUnion) specifically so `type` can be optional on
// the active side — zod tries each member and keeps the first that matches;
// a tombstone payload can only ever match tombstoneRecordSchema (it lacks
// the required active fields), and an active payload can only ever match
// activeReflectionRecordSchema (it lacks `type: 'tombstone'`), so there is
// no ambiguity between the two.
const reflectionSyncRecordSchema = z.union([tombstoneRecordSchema, activeReflectionRecordSchema]);

// Capped to fit comfortably under the app-wide 512kb JSON body limit
// (app.ts) even at the schema's own max ciphertext size per record; the
// mobile client batches larger uploads (e.g. first-sign-in migration) into
// multiple PUT calls of this size. See mobile/src/sync/reflectionsSync.ts.
export const putReflectionsSchema = z.object({
  reflections: z.array(reflectionSyncRecordSchema).min(1).max(40),
});

export const putSyncKeySchema = z.object({
  wrappedKey: z.string().trim().min(1).max(512),
  nonce: z.string().trim().min(1).max(128),
  salt: z.string().trim().min(1).max(128),
  kdfIterations: z.number().int().min(1000).max(10_000_000),
  encryptionVersion: z.number().int().min(1).max(100),
});
