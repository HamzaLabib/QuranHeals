import { Types } from 'mongoose';

import { AyahModel } from '../models/Ayah';
import { EmotionModel } from '../models/Emotion';
import type { AyahEntity, EmotionEntity } from '../types/domain';
import type { AyahDto, EmotionDto } from '../types/dto';
import type { QuranRepository } from './QuranRepository';

type MongoEntity<T> = T & {
  _id: Types.ObjectId;
};

function toEmotionDto(emotion: MongoEntity<EmotionEntity>): EmotionDto {
  return {
    id: emotion._id.toString(),
    key: emotion.key,
    name: emotion.name,
    arabicName: emotion.arabicName,
    description: emotion.description,
    icon: emotion.icon,
    order: emotion.order,
    active: emotion.active,
  };
}

function toAyahDto(ayah: MongoEntity<AyahEntity>): AyahDto {
  return {
    id: ayah._id.toString(),
    referenceKey: ayah.referenceKey,
    surahNumber: ayah.surahNumber,
    surahNameArabic: ayah.surahNameArabic,
    surahNameEnglish: ayah.surahNameEnglish,
    ayahNumber: ayah.ayahNumber,
    arabicText: ayah.arabicText,
    englishTranslation: ayah.englishTranslation,
    emotions: ayah.emotions,
    quranTextSource: ayah.quranTextSource,
    translationSource: ayah.translationSource,
  };
}

function toObjectIds(ids: string[]) {
  return ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
}

export class MongooseQuranRepository implements QuranRepository {
  async listActiveEmotions() {
    const emotions = await EmotionModel.find({ active: true }).sort({ order: 1 }).lean<
      MongoEntity<EmotionEntity>[]
    >();

    return emotions.map(toEmotionDto);
  }

  async findActiveEmotionByKey(key: string) {
    const emotion = await EmotionModel.findOne({ key, active: true }).lean<MongoEntity<EmotionEntity>>();

    return emotion ? toEmotionDto(emotion) : null;
  }

  async findRandomAyahByEmotion(emotionKey: string, excludedAyahIds: string[] = []) {
    const excludedObjectIds = toObjectIds(excludedAyahIds);

    const matchStage =
      excludedObjectIds.length > 0
        ? { emotions: emotionKey, _id: { $nin: excludedObjectIds } }
        : { emotions: emotionKey };

    const [ayah] = await AyahModel.aggregate<MongoEntity<AyahEntity>>([
      { $match: matchStage },
      { $sample: { size: 1 } },
    ]);

    if (ayah) {
      return toAyahDto(ayah);
    }

    if (excludedObjectIds.length === 0) {
      return null;
    }

    const [fallbackAyah] = await AyahModel.aggregate<MongoEntity<AyahEntity>>([
      { $match: { emotions: emotionKey } },
      { $sample: { size: 1 } },
    ]);

    return fallbackAyah ? toAyahDto(fallbackAyah) : null;
  }

  async findAyahById(id: string) {
    const ayah = await AyahModel.findById(id).lean<MongoEntity<AyahEntity>>();

    return ayah ? toAyahDto(ayah) : null;
  }
}

