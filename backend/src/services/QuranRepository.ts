import type { AyahDto, EmotionDto } from '../types/dto';

export interface QuranRepository {
  listActiveEmotions(): Promise<EmotionDto[]>;
  findActiveEmotionByKey(key: string): Promise<EmotionDto | null>;
  /** `excludedVerseKeys` and the returned ayah's `id` are stable "surah:ayah" verseKeys, never Mongo ObjectIds. */
  findRandomAyahByEmotion(emotionKey: string, excludedVerseKeys?: string[]): Promise<AyahDto | null>;
  /** `verseKey`, not a Mongo ObjectId — see above. */
  findAyahById(verseKey: string): Promise<AyahDto | null>;
}

