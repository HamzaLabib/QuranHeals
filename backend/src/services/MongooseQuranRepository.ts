import { Types } from 'mongoose';

import { AyahModel } from '../models/Ayah';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { VerseModel } from '../models/Verse';
import { VerseTranslationModel } from '../models/VerseTranslation';
import { getVerifiedArabicByVerseKey, VERIFIED_QURAN_TEXT_SOURCE } from '../quran/quranSource';
import { isValidVerseKey, parseVerseKey } from '../quran/referenceKeys';
import { getSurahMetadata } from '../quran/surahMetadata';
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

// The legacy `Ayah` collection is still its own, fully self-contained record
// (own emotions array) — no Verse/verseKey coverage dependency has ever
// applied to it. `id` moves to the stable verseKey so legacy and foundation
// ayahs share the same public identity. Its own surahNameArabic/English
// fields are legacy enrichment only (Phase 6A.7) — never authoritative; the
// verified surah-names asset is the sole source of truth for names, exactly
// like the foundation path below.
function toAyahDto(ayah: MongoEntity<AyahEntity>): AyahDto {
  const surah = getSurahMetadata(ayah.surahNumber);

  return {
    id: ayah.referenceKey,
    verseKey: `${ayah.surahNumber}:${ayah.ayahNumber}`,
    referenceKey: ayah.referenceKey,
    surahNumber: ayah.surahNumber,
    surahNameArabic: surah.nameArabic,
    surahNameEnglish: surah.nameEnglish,
    ayahNumber: ayah.ayahNumber,
    arabicText: getVerifiedArabicByVerseKey(ayah.referenceKey),
    englishTranslation: ayah.englishTranslation,
    emotions: ayah.emotions,
    quranTextSource: ayah.quranTextSource,
    translationSource: ayah.translationSource,
  };
}

/**
 * Composes an ayah from `verseKey` + verified SQLite Arabic + a Mongo
 * translation. A Mongo `Verse` document is *optional* enrichment only
 * (historical `quranTextSource`) — its absence must never block resolution.
 * This is the fix for the abandoned "Mongo Verse coverage must expand before
 * activation" architecture: any approved
 * `EmotionVerseMapping.verseReferenceKey` resolves on its own. Surah names
 * always come from the verified surah-names asset (Phase 6A.7) — a Mongo
 * `Verse` document's own surahNameArabic/English fields, if present, are
 * legacy enrichment only and are never read here.
 */
function toFoundationAyahDto(
  verseKey: string,
  arabicText: string,
  verse: MongoEntity<VerseEntity> | null,
  translation: MongoEntity<VerseTranslationEntity>,
  mappings: MongoEntity<EmotionVerseMappingEntity>[],
): AyahDto {
  const { surahNumber, ayahNumber } = parseVerseKey(verseKey);
  const surah = getSurahMetadata(surahNumber);

  return {
    id: verseKey,
    verseKey,
    referenceKey: verseKey,
    surahNumber,
    surahNameArabic: surah.nameArabic,
    surahNameEnglish: surah.nameEnglish,
    ayahNumber,
    arabicText,
    englishTranslation: translation.text,
    emotions: mappings.map((mapping) => mapping.emotionKey),
    quranTextSource: verse?.quranTextSource ?? VERIFIED_QURAN_TEXT_SOURCE,
    translationSource: translation.source,
  };
}

export class MongooseQuranRepository implements QuranRepository {
  private async composeFoundationAyah(verseKey: string, requiredEmotionKey?: string) {
    let arabicText: string;

    try {
      arabicText = getVerifiedArabicByVerseKey(verseKey);
    } catch {
      return null;
    }

    const [verse, translation, mappings] = await Promise.all([
      VerseModel.findOne({ referenceKey: verseKey }).lean<MongoEntity<VerseEntity>>(),
      VerseTranslationModel.findOne({
        verseReferenceKey: verseKey,
        language: FOUNDATION_TRANSLATION_LANGUAGE,
        translator: FOUNDATION_TRANSLATOR,
      }).lean<MongoEntity<VerseTranslationEntity>>(),
      EmotionVerseMappingModel.find({
        verseReferenceKey: verseKey,
        status: { $in: userVisibleMappingStatuses },
      }).lean<MongoEntity<EmotionVerseMappingEntity>[]>(),
    ]);

    if (!translation) {
      return null;
    }

    if (
      requiredEmotionKey !== undefined &&
      !mappings.some((mapping) => mapping.emotionKey === requiredEmotionKey)
    ) {
      return null;
    }

    return toFoundationAyahDto(verseKey, arabicText, verse, translation, mappings);
  }

  private async findRandomFoundationAyahByEmotion(emotionKey: string, excludedVerseKeys: string[]) {
    const matchStage: Record<string, unknown> = {
      emotionKey,
      status: { $in: userVisibleMappingStatuses },
    };

    if (excludedVerseKeys.length > 0) {
      matchStage.verseReferenceKey = { $nin: excludedVerseKeys };
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

    if (excludedVerseKeys.length === 0) {
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

  async findRandomAyahByEmotion(emotionKey: string, excludedVerseKeys: string[] = []) {
    const foundationAyah = await this.findRandomFoundationAyahByEmotion(emotionKey, excludedVerseKeys);

    if (foundationAyah) {
      return foundationAyah;
    }

    const matchStage =
      excludedVerseKeys.length > 0
        ? { emotions: emotionKey, referenceKey: { $nin: excludedVerseKeys } }
        : { emotions: emotionKey };

    const [ayah] = await AyahModel.aggregate<MongoEntity<AyahEntity>>([
      { $match: matchStage },
      { $sample: { size: 1 } },
    ]);

    if (ayah) {
      return toAyahDto(ayah);
    }

    if (excludedVerseKeys.length === 0) {
      return null;
    }

    const [fallbackAyah] = await AyahModel.aggregate<MongoEntity<AyahEntity>>([
      { $match: { emotions: emotionKey } },
      { $sample: { size: 1 } },
    ]);

    return fallbackAyah ? toAyahDto(fallbackAyah) : null;
  }

  async findAyahById(verseKey: string) {
    if (!isValidVerseKey(verseKey)) {
      return null;
    }

    const foundationAyah = await this.composeFoundationAyah(verseKey);

    if (foundationAyah) {
      return foundationAyah;
    }

    const ayah = await AyahModel.findOne({ referenceKey: verseKey }).lean<MongoEntity<AyahEntity>>();

    return ayah ? toAyahDto(ayah) : null;
  }
}
