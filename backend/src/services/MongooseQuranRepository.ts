import { Types } from 'mongoose';

import { AyahModel } from '../models/Ayah';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { VerseModel } from '../models/Verse';
import { VerseTranslationModel } from '../models/VerseTranslation';
import {
  FOUNDATION_TRANSLATION_LANGUAGE,
  FOUNDATION_TRANSLATOR,
} from '../seed/foundation';
import type {
  AyahEntity,
  EmotionEntity,
  EmotionMappingStatus,
  EmotionVerseMappingEntity,
  VerseEntity,
  VerseTranslationEntity,
} from '../types/domain';
import type { AyahDto, EmotionDto } from '../types/dto';
import type { QuranRepository } from './QuranRepository';

type MongoEntity<T> = T & {
  _id: Types.ObjectId;
};

const userVisibleMappingStatuses: EmotionMappingStatus[] = ['development', 'reviewed', 'approved'];

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
    verseKey: `${ayah.surahNumber}:${ayah.ayahNumber}`,
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

function toFoundationAyahDto(
  verse: MongoEntity<VerseEntity>,
  translation: MongoEntity<VerseTranslationEntity>,
  mappings: MongoEntity<EmotionVerseMappingEntity>[],
): AyahDto {
  return {
    id: verse._id.toString(),
    verseKey: `${verse.surahNumber}:${verse.ayahNumber}`,
    referenceKey: verse.referenceKey,
    surahNumber: verse.surahNumber,
    surahNameArabic: verse.surahNameArabic,
    surahNameEnglish: verse.surahNameEnglish,
    ayahNumber: verse.ayahNumber,
    arabicText: verse.arabicText,
    englishTranslation: translation.text,
    emotions: mappings.map((mapping) => mapping.emotionKey),
    quranTextSource: verse.quranTextSource,
    translationSource: translation.source,
  };
}

function toObjectIds(ids: string[]) {
  return ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
}

export class MongooseQuranRepository implements QuranRepository {
  private async composeFoundationAyah(referenceKey: string, requiredEmotionKey?: string) {
    const [verse, translation, mappings] = await Promise.all([
      VerseModel.findOne({ referenceKey }).lean<MongoEntity<VerseEntity>>(),
      VerseTranslationModel.findOne({
        verseReferenceKey: referenceKey,
        language: FOUNDATION_TRANSLATION_LANGUAGE,
        translator: FOUNDATION_TRANSLATOR,
      }).lean<MongoEntity<VerseTranslationEntity>>(),
      EmotionVerseMappingModel.find({
        verseReferenceKey: referenceKey,
        status: { $in: userVisibleMappingStatuses },
      }).lean<MongoEntity<EmotionVerseMappingEntity>[]>(),
    ]);

    if (!verse || !translation) {
      return null;
    }

    if (
      requiredEmotionKey !== undefined &&
      !mappings.some((mapping) => mapping.emotionKey === requiredEmotionKey)
    ) {
      return null;
    }

    return toFoundationAyahDto(verse, translation, mappings);
  }

  private async findExcludedFoundationReferenceKeys(excludedObjectIds: Types.ObjectId[]) {
    if (excludedObjectIds.length === 0) {
      return [];
    }

    const excludedVerses = await VerseModel.find({ _id: { $in: excludedObjectIds } })
      .select({ referenceKey: 1 })
      .lean<MongoEntity<Pick<VerseEntity, 'referenceKey'>>[]>();

    return excludedVerses.map((verse) => verse.referenceKey);
  }

  private async findRandomFoundationAyahByEmotion(
    emotionKey: string,
    excludedObjectIds: Types.ObjectId[],
  ) {
    const excludedReferenceKeys =
      await this.findExcludedFoundationReferenceKeys(excludedObjectIds);
    const matchStage: Record<string, unknown> = {
      emotionKey,
      status: { $in: userVisibleMappingStatuses },
    };

    if (excludedReferenceKeys.length > 0) {
      matchStage.verseReferenceKey = { $nin: excludedReferenceKeys };
    }

    const [mapping] = await EmotionVerseMappingModel.aggregate<
      MongoEntity<EmotionVerseMappingEntity>
    >([{ $match: matchStage }, { $sample: { size: 1 } }]);

    if (mapping) {
      const ayah = await this.composeFoundationAyah(mapping.verseReferenceKey, emotionKey);

      if (ayah) {
        return ayah;
      }
    }

    if (excludedObjectIds.length === 0) {
      return null;
    }

    const [fallbackMapping] = await EmotionVerseMappingModel.aggregate<
      MongoEntity<EmotionVerseMappingEntity>
    >([
      {
        $match: {
          emotionKey,
          status: { $in: userVisibleMappingStatuses },
        },
      },
      { $sample: { size: 1 } },
    ]);

    return fallbackMapping
      ? this.composeFoundationAyah(fallbackMapping.verseReferenceKey, emotionKey)
      : null;
  }

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
    const foundationAyah = await this.findRandomFoundationAyahByEmotion(
      emotionKey,
      excludedObjectIds,
    );

    if (foundationAyah) {
      return foundationAyah;
    }

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
    const verse = await VerseModel.findById(id).lean<MongoEntity<VerseEntity>>();

    if (verse) {
      return this.composeFoundationAyah(verse.referenceKey);
    }

    const ayah = await AyahModel.findById(id).lean<MongoEntity<AyahEntity>>();

    return ayah ? toAyahDto(ayah) : null;
  }
}
