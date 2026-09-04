import type { AyahEntity, EmotionEntity } from '../types/domain';

export type SeedEmotion = Omit<EmotionEntity, 'createdAt' | 'updatedAt'>;
export type SeedAyah = Omit<AyahEntity, 'createdAt' | 'updatedAt'>;

