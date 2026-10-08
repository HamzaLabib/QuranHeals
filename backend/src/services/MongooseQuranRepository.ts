import { Types } from 'mongoose';

import type { AppEnvironment } from '../config/databaseTarget';
import { env } from '../config/env';
import { getCanonicalEmotion, resolveEmotionLocalization } from '../emotions/emotionCatalog';
import { EmotionVerseMappingModel } from '../models/EmotionVerseMapping';
import { EmotionModel } from '../models/Emotion';
import { VerseModel } from '../models/Verse';
import { getVerifiedArabicByVerseKey, VERIFIED_QURAN_TEXT_SOURCE } from '../quran/quranSource';
import { isValidVerseKey, parseVerseKey } from '../quran/referenceKeys';
import { getSurahMetadata } from '../quran/surahMetadata';
import { getVerifiedTranslationByVerseKey, VERIFIED_TRANSLATION_SOURCE } from '../quran/translationSource';
import type {
  EmotionEntity,
  EmotionMappingStatus,
  EmotionVerseMappingEntity,
  VerseEntity,
} from '../types/domain';
import type { AyahConnectionDto, AyahDto, EmotionDto } from '../types/dto';
import type { QuranRepository } from './QuranRepository';

type MongoEntity<T> = T & {
  _id: Types.ObjectId;
};

/**
 * Which mapping statuses may put an ayah in front of users. Production
 * serves editorially approved mappings only. Development/test additionally
 * show `development` and `reviewed` mappings so editors can preview work in
 * progress against quranheals_dev. `draft` and `rejected` are never served
 * anywhere (KEEP/REJECT/HOLD are review outcomes, not statuses — HOLD rows
 * are never inserted, REJECT becomes `rejected`).
 */
export function userVisibleMappingStatuses(nodeEnv: AppEnvironment): readonly EmotionMappingStatus[] {
  return nodeEnv === 'production' ? ['approved'] : ['development', 'reviewed', 'approved'];
}

function toEmotionDto(emotion: MongoEntity<EmotionEntity>): EmotionDto {
  const { names, descriptions } = resolveEmotionLocalization(emotion);
  const canonical = getCanonicalEmotion(emotion.key);
  // Presentation updates come from the catalog without rewriting live documents.
  // Preserve every other stored locale and all activation/mapping state.
  const displayNames = emotion.key === 'seeking_guidance' && canonical
    ? { ...names, 'ar-EG': canonical.names['ar-EG'] }
    : names;

  return {
    id: emotion._id.toString(),
    key: emotion.key,
    names: displayNames,
    descriptions,
    // Deprecated compatibility aliases — derived from the same resolved
    // localized data above, never a second independent source of truth.
    name: names.en,
    arabicName: names.ar,
    description: descriptions.en,
    icon: emotion.icon,
    order: canonical?.order ?? emotion.order,
    active: emotion.active,
  };
}

// The legacy `Ayah` collection (the original MVP seed, with its own
// `emotions` arrays) is no longer read here. Its emotion tags never went
// through editorial review, so selecting from it would let unapproved
// pairings bypass the mapping lifecycle; and every verse it holds resolves
// through the foundation path below by verseKey anyway (verified SQLite
// text), so lookups by id never needed it. The collection itself is kept
// untouched in the database — see docs/backend-operations.md.

/**
 * Composes an ayah from `verseKey` + verified SQLite Arabic + verified
 * SQLite translation. A Mongo `Verse` document is *optional* enrichment only
 * (historical `quranTextSource`) — its absence must never block resolution.
 * This is the fix for the abandoned "Mongo Verse coverage must expand before
 * activation" architecture: any approved
 * `EmotionVerseMapping.verseReferenceKey` resolves on its own. Surah names
 * always come from the verified surah-names asset (Phase 6A.7), and
 * translation text always comes from the verified translations.sqlite asset
 * (Phase 6A.8B) — a Mongo `Verse`/`VerseTranslation` document's own
 * surahNameArabic/English or translation text, if present, is never read
 * here.
 */
/**
 * "How this ayah connects": the text of the REQUESTED emotion's mapping for
 * this verse only (never another emotion's, never per verse), and only when
 * that mapping is APPROVED — development/reviewed mappings are user-visible
 * as ayahs but never surface connection text, even if a document somehow
 * carries some. Blank strings are dropped; undefined when there is no
 * emotion, no approved mapping, or no text.
 */
export function selectMappingConnection(
  mappings: Pick<EmotionVerseMappingEntity, 'emotionKey' | 'status' | 'connection'>[],
  emotionKey: string | undefined,
): AyahConnectionDto | undefined {
  if (emotionKey === undefined) return undefined;
  const mapping = mappings.find((candidate) => candidate.emotionKey === emotionKey);
  if (mapping?.status !== 'approved') return undefined;
  const connection = mapping.connection;
  const en = connection?.en?.trim();
  const ar = connection?.ar?.trim();
  if (!en && !ar) return undefined;
  return { emotionKey, ...(en ? { en } : {}), ...(ar ? { ar } : {}) };
}

function toFoundationAyahDto(
  verseKey: string,
  arabicText: string,
  translationText: string,
  verse: MongoEntity<VerseEntity> | null,
  mappings: MongoEntity<EmotionVerseMappingEntity>[],
  connection?: AyahConnectionDto,
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
    englishTranslation: translationText,
    emotions: mappings.map((mapping) => mapping.emotionKey),
    quranTextSource: verse?.quranTextSource ?? VERIFIED_QURAN_TEXT_SOURCE,
    translationSource: VERIFIED_TRANSLATION_SOURCE,
    ...(connection ? { connection } : {}),
  };
}

export class MongooseQuranRepository implements QuranRepository {
  private readonly visibleStatuses: EmotionMappingStatus[];

  /** `nodeEnv` defaults to this process's NODE_ENV; tests pass it explicitly. */
  constructor(options: { nodeEnv?: AppEnvironment } = {}) {
    this.visibleStatuses = [...userVisibleMappingStatuses(options.nodeEnv ?? env.NODE_ENV)];
  }

  private async composeFoundationAyah(verseKey: string, requiredEmotionKey?: string) {
    let arabicText: string;
    let translationText: string;

    try {
      arabicText = getVerifiedArabicByVerseKey(verseKey);
      translationText = getVerifiedTranslationByVerseKey(verseKey);
    } catch {
      return null;
    }

    const [verse, mappings] = await Promise.all([
      VerseModel.findOne({ referenceKey: verseKey }).lean<MongoEntity<VerseEntity>>(),
      EmotionVerseMappingModel.find({
        verseReferenceKey: verseKey,
        status: { $in: this.visibleStatuses },
      }).lean<MongoEntity<EmotionVerseMappingEntity>[]>(),
    ]);

    if (
      requiredEmotionKey !== undefined &&
      !mappings.some((mapping) => mapping.emotionKey === requiredEmotionKey)
    ) {
      return null;
    }

    return toFoundationAyahDto(verseKey, arabicText, translationText, verse, mappings, selectMappingConnection(mappings, requiredEmotionKey));
  }

  private async findRandomFoundationAyahByEmotion(emotionKey: string, excludedVerseKeys: string[]) {
    const matchStage: Record<string, unknown> = {
      emotionKey,
      status: { $in: this.visibleStatuses },
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
          status: { $in: this.visibleStatuses },
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

    return emotions.map(toEmotionDto).sort((a, b) => a.order - b.order);
  }

  async findActiveEmotionByKey(key: string) {
    const emotion = await EmotionModel.findOne({ key, active: true }).lean<MongoEntity<EmotionEntity>>();

    return emotion ? toEmotionDto(emotion) : null;
  }

  /** Only from the emotion's user-visible mappings; null (→ 404) when there are none — never the legacy collection. */
  async findRandomAyahByEmotion(emotionKey: string, excludedVerseKeys: string[] = []) {
    return this.findRandomFoundationAyahByEmotion(emotionKey, excludedVerseKeys);
  }

  async findAyahById(verseKey: string) {
    if (!isValidVerseKey(verseKey)) {
      return null;
    }

    return this.composeFoundationAyah(verseKey);
  }
}
