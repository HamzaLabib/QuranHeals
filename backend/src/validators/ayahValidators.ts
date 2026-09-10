import { Types } from 'mongoose';
import { z } from 'zod';

const emotionKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z_-]{1,40}$/);

const excludedAyahsSchema = z
  .preprocess((value) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return [];
    }

    return value
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }, z.array(z.string().refine((id) => Types.ObjectId.isValid(id), 'Invalid excluded ayah id.')).max(20))
  .default([]);

export const randomAyahQuerySchema = z.object({
  emotion: emotionKeySchema,
  exclude: excludedAyahsSchema,
});

export const ayahIdParamsSchema = z.object({
  id: z.string().refine((id) => Types.ObjectId.isValid(id), 'Invalid ayah id.'),
});

