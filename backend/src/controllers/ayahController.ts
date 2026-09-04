import type { Request, Response } from 'express';

import { AppError } from '../errors/AppError';
import type { QuranRepository } from '../services/QuranRepository';
import { ayahIdParamsSchema, randomAyahQuerySchema } from '../validators/ayahValidators';

export function createAyahController(repository: QuranRepository) {
  return {
    getRandomAyah: async (req: Request, res: Response) => {
      const parsedQuery = randomAyahQuerySchema.safeParse(req.query);

      if (!parsedQuery.success) {
        throw new AppError('Invalid emotion.', 400);
      }

      const { emotion, exclude } = parsedQuery.data;
      const activeEmotion = await repository.findActiveEmotionByKey(emotion);

      if (!activeEmotion) {
        throw new AppError('Invalid emotion.', 400);
      }

      const ayah = await repository.findRandomAyahByEmotion(emotion, exclude);

      if (!ayah) {
        throw new AppError('No ayahs found for this emotion yet.', 404);
      }

      res.json({
        success: true,
        data: ayah,
      });
    },

    getAyahById: async (req: Request, res: Response) => {
      const parsedParams = ayahIdParamsSchema.safeParse(req.params);

      if (!parsedParams.success) {
        throw new AppError('Invalid ayah id.', 400);
      }

      const ayah = await repository.findAyahById(parsedParams.data.id);

      if (!ayah) {
        throw new AppError('Ayah not found.', 404);
      }

      res.json({
        success: true,
        data: ayah,
      });
    },
  };
}

