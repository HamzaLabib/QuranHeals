import { z } from 'zod';

import { isValidVerseKey } from '../quran/referenceKeys';

const emotionKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z_-]{1,40}$/);

// The public Quran identifier is the stable "surah:ayah" verseKey, never a
// Mongo ObjectId (see MongooseQuranRepository — resolution no longer depends
// on a Mongo Verse document existing).
const verseKeySchema = z
  .string()
  .trim()
  .refine((key) => isValidVerseKey(key), 'Invalid verse key.');

const excludedAyahsSchema = z
  .preprocess((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return [];
    }

    return value
      .split(',')
      .map((key) => key.trim())
      .filter(Boolean);
  }, z.array(verseKeySchema).max(20))
  .default([]);

export const randomAyahQuerySchema = z.object({
  emotion: emotionKeySchema,
  exclude: excludedAyahsSchema,
});

export const ayahIdParamsSchema = z.object({
  id: verseKeySchema,
});
