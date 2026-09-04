import type { AyahDto, EmotionDto } from '../types/dto';

export interface QuranRepository {
  listActiveEmotions(): Promise<EmotionDto[]>;
  findActiveEmotionByKey(key: string): Promise<EmotionDto | null>;
  findRandomAyahByEmotion(emotionKey: string, excludedAyahIds?: string[]): Promise<AyahDto | null>;
  findAyahById(id: string): Promise<AyahDto | null>;
}

