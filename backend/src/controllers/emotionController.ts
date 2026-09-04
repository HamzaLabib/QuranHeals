import type { Request, Response } from 'express';

import type { QuranRepository } from '../services/QuranRepository';

export function createEmotionController(repository: QuranRepository) {
  return {
    listEmotions: async (_req: Request, res: Response) => {
      const emotions = await repository.listActiveEmotions();

      res.json({
        success: true,
        data: emotions,
      });
    },
  };
}

