/**
 * Canonical, single-source-of-truth catalog of the 29 emotion definitions —
 * stable keys, localized display names, localized descriptions, icon, and
 * display order. Consumed by `backend/src/seed/emotions.ts` (which
 * re-exports a flattened legacy view for existing seed/dev-Mongo code),
 * `activateApprovedEmotionMappings.ts` (localization write-plan source),
 * the API's localization fallback for legacy live documents, and the test
 * suite. Nothing else in this repository should hand-type these 29 keys,
 * names, or descriptions a second time.
 *
 * `key` is a PERMANENT identifier — used for emotion<->ayah mappings,
 * routes, favorites/history, Mongo relationships and API queries. It never
 * changes when a display name changes in any locale.
 */

/** The three app interface locales Quran Heals v1 supports. Adding a locale later never requires changing an emotion key or a Quran mapping. */
export type AppLocale = 'en' | 'ar' | 'ar-EG';

export const APP_LOCALES: readonly AppLocale[] = ['en', 'ar', 'ar-EG'];

export const DEFAULT_APP_LOCALE: AppLocale = 'en';

/**
 * A localized-text bag. The three current `AppLocale`s are required (so a
 * missing translation is a compile-time error at every catalog entry), while
 * the broader `Record<string, string>` intersection keeps the shape open
 * for future locales (`fr`, `es`, `tr`, `ur`, `id`, `fr-CA`, ...) without a
 * breaking type change — storage/API code should never assume exactly
 * three keys will ever exist.
 */
export type LocalizedText = Record<AppLocale, string> & Record<string, string>;

export type CanonicalEmotion = {
  key: string;
  names: LocalizedText;
  descriptions: LocalizedText;
  icon: string;
  order: number;
  active: boolean;
};

/**
 * Draft Modern Standard Arabic and Egyptian Arabic descriptions below are
 * natural translations of the existing English description (the semantic
 * source), written to stay concise, describe the emotional situation only,
 * and avoid Quran-verse interpretation, theological promises, or
 * medical/mental-health claims — same constraints as the English originals.
 * They are DATA-READY ONLY: not rendered anywhere in the app yet (see
 * `docs/localization/overview.md`), pending manual editorial review (the
 * full triplet-by-locale table is also printed by
 * `backend/tests/emotions/emotion-catalog.test.ts`'s companion report step
 * and this phase's final report for that review).
 */
export const EMOTION_CATALOG: CanonicalEmotion[] = [
  {
    key: 'sad',
    names: { en: 'Sad', ar: 'حزين', 'ar-EG': 'زعلان' },
    descriptions: {
      en: 'When your heart feels heavy.',
      ar: 'عندما يشعر قلبك بالثقل.',
      'ar-EG': 'لما تحس إن قلبك تقيل.',
    },
    icon: 'cloud-rain',
    order: 1,
    active: true,
  },
  {
    key: 'anxious',
    names: { en: 'Anxious', ar: 'قَلِق', 'ar-EG': 'قلقان' },
    descriptions: {
      en: 'When thoughts feel restless.',
      ar: 'عندما تكون أفكارك مضطربة.',
      'ar-EG': 'لما تحس إن أفكارك مش مستقرة.',
    },
    icon: 'activity',
    order: 2,
    active: true,
  },
  {
    key: 'lonely',
    names: { en: 'Lonely', ar: 'وحيد', 'ar-EG': 'حاسس إني لوحدي' },
    descriptions: {
      en: 'When you feel unseen or alone.',
      ar: 'عندما تشعر بأنك غير مرئي أو وحيد.',
      'ar-EG': 'لما تحس إنك لوحدك أو حد مش شايفك.',
    },
    icon: 'moon',
    order: 7,
    active: true,
  },
  {
    key: 'angry',
    names: { en: 'Angry', ar: 'غاضب', 'ar-EG': 'غضبان' },
    descriptions: {
      en: 'When emotion rises quickly.',
      ar: 'عندما يثور شعورك بسرعة.',
      'ar-EG': 'لما جوه حسك يفور بسرعة.',
    },
    icon: 'flame',
    order: 6,
    active: true,
  },
  {
    key: 'lost',
    names: { en: 'Lost', ar: 'تائه', 'ar-EG': 'تايه' },
    descriptions: {
      en: 'When the next step feels unclear.',
      ar: 'عندما تكون الخطوة القادمة غير واضحة.',
      'ar-EG': 'لما تحس إنك مش عارف تتحرك فين.',
    },
    icon: 'compass',
    order: 11,
    active: true,
  },
  {
    key: 'afraid',
    names: { en: 'Afraid', ar: 'خائف', 'ar-EG': 'خايف' },
    descriptions: {
      en: 'When fear is close.',
      ar: 'عندما يكون الخوف قريبًا منك.',
      'ar-EG': 'لما تحس إن الخوف قريب منك.',
    },
    icon: 'shield-alert',
    order: 5,
    active: true,
  },
  {
    key: 'stressed',
    names: { en: 'Stressed', ar: 'متوتر', 'ar-EG': 'متوتر' },
    descriptions: {
      en: 'When pressure feels too much.',
      ar: 'عندما يصبح الضغط كثيرًا جدًا.',
      'ar-EG': 'لما تحس إن الضغط زاد عن حده.',
    },
    icon: 'gauge',
    order: 3,
    active: true,
  },
  {
    key: 'hopeless',
    names: { en: 'Hopeless', ar: 'فاقد الأمل', 'ar-EG': 'فاقد الأمل' },
    descriptions: {
      en: 'When mercy feels far away.',
      ar: 'عندما تشعر بأن الرحمة بعيدة.',
      'ar-EG': 'لما تحس إن رحمة ربنا بعيدة عنك.',
    },
    icon: 'sunrise',
    order: 13,
    active: true,
  },
  {
    key: 'tired',
    names: { en: 'Tired', ar: 'متعب', 'ar-EG': 'تعبان' },
    descriptions: {
      en: 'When your strength feels thin.',
      ar: 'عندما تشعر بأن قوتك تتلاشى.',
      'ar-EG': 'لما تحس إن قوتك خلصت.',
    },
    icon: 'battery-low',
    order: 10,
    active: true,
  },
  {
    key: 'confused',
    names: { en: 'Confused', ar: 'حائر', 'ar-EG': 'محتار' },
    descriptions: {
      en: 'When your heart seeks direction.',
      ar: 'عندما يبحث قلبك عن اتجاه.',
      'ar-EG': 'لما قلبك يكون بيدور على اتجاه.',
    },
    icon: 'help-circle',
    order: 12,
    active: true,
  },
  {
    key: 'grateful',
    names: { en: 'Grateful', ar: 'ممتن', 'ar-EG': 'ممتن' },
    descriptions: {
      en: 'When you want to name the blessing.',
      ar: 'عندما تريد أن تذكر النعمة باسمها.',
      'ar-EG': 'لما تحب تفتكر النعمة اللي فيك.',
    },
    icon: 'heart',
    order: 27,
    active: true,
  },
  {
    key: 'peaceful',
    names: { en: 'At Peace', ar: 'مطمئن', 'ar-EG': 'مطمّن' },
    descriptions: {
      en: 'When your heart feels settled.',
      ar: 'عندما يشعر قلبك بالسكينة.',
      'ar-EG': 'لما تحس إن قلبك مرتاح ومطمّن.',
    },
    icon: 'leaf',
    order: 26,
    active: true,
  },
  // Phase 5B taxonomy — approved MAIN emotions, added INACTIVE. These are
  // not user-visible and receive no Quran mappings until controlled
  // activation. Each becomes `active: true` only once it has at least one
  // approved mapping. `frustrated` and `regretful` are deliberately absent:
  // they resolve through aliases to `angry` and `guilty`. `quran_message` is
  // a separate discovery mode, not an emotion, so it is not cataloged here.
  {
    key: 'want_to_cry',
    names: { en: 'I Feel Like Crying', ar: 'أريد أن أبكي', 'ar-EG': 'عايز أعيط' },
    descriptions: {
      en: 'When the tears are close to the surface.',
      ar: 'عندما تكون الدموع قريبة من السطح.',
      'ar-EG': 'لما تحس إن دموعك قربت تنزل.',
    },
    icon: 'droplet',
    order: 9,
    active: false,
  },
  {
    key: 'heartbroken',
    names: { en: 'Heartbroken', ar: 'مكسور الخاطر', 'ar-EG': 'مكسور الخاطر' },
    descriptions: {
      en: 'When a loss has broken something inside.',
      ar: 'عندما يكسر فقدان شيئًا بداخلك.',
      'ar-EG': 'لما فقدان حاجة يكسر جوّاك.',
    },
    icon: 'heart-crack',
    order: 8,
    active: false,
  },
  {
    key: 'overwhelmed',
    names: { en: 'Overwhelmed', ar: 'الأمور فوق طاقتي', 'ar-EG': 'مخنوق' },
    descriptions: {
      en: 'When everything at once is too much to carry.',
      ar: 'عندما يصبح كل شيء في وقت واحد أكثر مما تستطيع حمله.',
      'ar-EG': 'لما كل حاجة تيجي مرة واحدة وتحس إنها فوق طاقتك.',
    },
    icon: 'waves',
    order: 4,
    active: false,
  },
  {
    key: 'rejected',
    names: { en: 'Rejected', ar: 'أشعر أنني مرفوض', 'ar-EG': 'حاسس بالرفض' },
    descriptions: {
      en: 'When you feel pushed away or unwanted.',
      ar: 'عندما تشعر بأنك مُبعَد أو غير مرغوب فيك.',
      'ar-EG': 'لما تحس إنهم بعدوك أو مش عايزينك.',
    },
    icon: 'user-x',
    order: 15,
    active: false,
  },
  {
    key: 'betrayed',
    names: { en: 'Betrayed', ar: 'مخذول', 'ar-EG': 'مخذول' },
    descriptions: {
      en: 'When someone you trusted let you down.',
      ar: 'عندما يخذلك شخص كنت تثق به.',
      'ar-EG': 'لما حد كنت واثق فيه يخذلك.',
    },
    icon: 'user-minus',
    order: 16,
    active: false,
  },
  {
    key: 'wronged',
    names: { en: 'Wronged', ar: 'مظلوم', 'ar-EG': 'مظلوم' },
    descriptions: {
      en: 'When you have been treated unjustly.',
      ar: 'عندما تُعامَل بظلم.',
      'ar-EG': 'لما حد يظلمك.',
    },
    icon: 'scale',
    order: 17,
    active: false,
  },
  {
    key: 'forgiveness_struggle',
    names: { en: 'Struggling to Forgive', ar: 'لا أستطيع المسامحة', 'ar-EG': 'مش قادر أسامح' },
    descriptions: {
      en: 'When you cannot yet let go of a hurt.',
      ar: 'عندما لا تستطيع بعد التخلي عن جرح.',
      'ar-EG': 'لما لسه مش قادر تسيب جرح حصلك.',
    },
    icon: 'unlink',
    order: 18,
    active: false,
  },
  {
    key: 'guilty',
    names: { en: 'Guilty', ar: 'أشعر بالذنب', 'ar-EG': 'حاسس بالذنب' },
    descriptions: {
      en: 'When your conscience weighs on you.',
      ar: 'عندما يثقل ضميرك عليك.',
      'ar-EG': 'لما ضميرك يكون تقيل عليك.',
    },
    icon: 'alert-circle',
    order: 19,
    active: false,
  },
  {
    key: 'repentant',
    names: { en: 'I Want to Repent', ar: 'أريد أن أتوب', 'ar-EG': 'عايز أتوب' },
    descriptions: {
      en: 'When you want to turn back to Allah.',
      ar: 'عندما تريد أن تعود إلى الله.',
      'ar-EG': 'لما تحب ترجع لربنا.',
    },
    icon: 'rotate-ccw',
    order: 20,
    active: false,
  },
  {
    key: 'weak',
    names: { en: 'Feeling Weak', ar: 'أشعر بالضعف', 'ar-EG': 'حاسس إني ضعيف' },
    descriptions: {
      en: 'When you feel you have no strength left.',
      ar: 'عندما تشعر بأنه لم تعد لديك قوة.',
      'ar-EG': 'لما تحس إنك مبقاش عندك قوة خالص.',
    },
    icon: 'battery-warning',
    order: 14,
    active: false,
  },
  {
    key: 'reassurance',
    names: { en: 'I Need Reassurance', ar: 'أحتاج إلى الطمأنينة', 'ar-EG': 'محتاج أطمّن' },
    descriptions: {
      en: 'When you need your heart to be settled.',
      ar: 'عندما تحتاج إلى طمأنينة قلبك.',
      'ar-EG': 'لما محتاج حد يطمّن قلبك.',
    },
    icon: 'hand-heart',
    order: 22,
    active: false,
  },
  {
    key: 'patience',
    names: { en: 'I Need Patience', ar: 'أحتاج إلى الصبر', 'ar-EG': 'محتاج صبر' },
    descriptions: {
      en: 'When you are asking for the strength to endure.',
      ar: 'عندما تطلب القوة على الاحتمال.',
      'ar-EG': 'لما تكون محتاج قوة عشان تستحمل.',
    },
    icon: 'hourglass',
    order: 23,
    active: false,
  },
  {
    key: 'strength',
    names: { en: 'I Need Strength', ar: 'أحتاج إلى القوة', 'ar-EG': 'محتاج قوة' },
    descriptions: {
      en: 'When you need to be carried through.',
      ar: 'عندما تحتاج إلى من يعينك على تجاوز الأمر.',
      'ar-EG': 'لما محتاج حد يعديك الظرف ده.',
    },
    icon: 'anchor',
    order: 24,
    active: false,
  },
  {
    key: 'hopeful',
    names: { en: 'Hopeful', ar: 'لدي أمل', 'ar-EG': 'عندي أمل' },
    descriptions: {
      en: 'When you can feel the good that is coming.',
      ar: 'عندما تشعر بأن الخير قادم.',
      'ar-EG': 'لما تحس إن فيه خير جاي.',
    },
    icon: 'sun',
    order: 25,
    active: false,
  },
  {
    key: 'content',
    names: { en: 'Content', ar: 'راضٍ', 'ar-EG': 'راضي' },
    descriptions: {
      en: 'When your heart accepts what Allah has given.',
      ar: 'عندما يرضى قلبك بما أعطاك الله.',
      'ar-EG': 'لما قلبك يرضى بإللي ربنا داهولك.',
    },
    icon: 'smile',
    order: 28,
    active: false,
  },
  {
    key: 'seeking_guidance',
    names: { en: 'Seeking Guidance', ar: 'أطلب الهداية', 'ar-EG': 'محتاج ربنا يرشدني' },
    descriptions: {
      en: 'When you need to be shown the way.',
      ar: 'عندما تحتاج إلى من يدلك على الطريق.',
      'ar-EG': 'لما محتاج حد يوريك الطريق.',
    },
    icon: 'map',
    order: 29,
    active: false,
  },
  {
    key: 'closer_to_allah',
    names: { en: 'I Want to Feel Closer to Allah', ar: 'أريد أن أتقرب إلى الله', 'ar-EG': 'عايز أقرب من ربنا' },
    descriptions: {
      en: 'When you want to draw nearer to your Lord.',
      ar: 'عندما تريد أن تقترب أكثر من ربك.',
      'ar-EG': 'لما تحب تبقى أقرب لربنا.',
    },
    icon: 'sparkles',
    order: 30,
    active: false,
  },
  // Added as its own review round (not part of Phase 5B) — see
  // backend/data/emotion-candidates/batches/batch-6-faith-shaken/.
  // Display order is independent of activation history. `active: false` is the safe
  // seed default, not a live-database status assertion. MongoDB activation
  // is performed by activateFaithShaken.ts only after all KEEP mappings
  // are ready; the API reads the live Emotion.active field.
  {
    key: 'faith_shaken',
    names: { en: 'My Faith Feels Shaken', ar: 'إيماني مهزوز', 'ar-EG': 'إيماني مهزوز' },
    descriptions: {
      en: 'When your heart needs renewed faith and certainty.',
      ar: 'عندما يحتاج قلبك إلى إيمان ويقين متجددين.',
      'ar-EG': 'لما قلبك يكون محتاج إيمان ويقين من جديد.',
    },
    icon: 'star',
    order: 21,
    active: false,
  },
];

export const EMOTION_CATALOG_BY_KEY: ReadonlyMap<string, CanonicalEmotion> = new Map(
  EMOTION_CATALOG.map((emotion) => [emotion.key, emotion]),
);

export function getCanonicalEmotion(key: string): CanonicalEmotion | undefined {
  return EMOTION_CATALOG_BY_KEY.get(key);
}

/** True only when every currently-required AppLocale has a non-empty string entry. */
export function hasAllRequiredLocales(text: LocalizedText | undefined | null): text is LocalizedText {
  if (!text) return false;
  return APP_LOCALES.every((locale) => typeof text[locale] === 'string' && text[locale].trim().length > 0);
}

/** Shape a live Mongo Emotion document needs to have for localization resolution — matches `EmotionEntity`'s relevant fields without importing it here (avoids a cycle with types/domain.ts). */
export type LiveEmotionLocalizationInput = {
  key: string;
  names?: LocalizedText;
  descriptions?: LocalizedText;
  name?: string;
  arabicName?: string;
  description?: string;
};

/**
 * Resolves the authoritative localized names/descriptions for a live
 * Emotion document, in priority order:
 *   1. the document's own `names`/`descriptions`, when both are fully
 *      populated (every required locale present) — canonical localized
 *      data always takes precedence over anything else, per design;
 *   2. the canonical catalog entry for the document's `key`, when one
 *      exists — this is the path every one of today's pre-localization
 *      live documents takes (all 12 currently active emotions have a
 *      catalog entry but no `names`/`descriptions` map yet);
 *   3. a safe, honest, same-document-only fallback built from the
 *      document's own legacy flat fields — reached only for a key with
 *      neither localized data nor a catalog entry (not expected for any of
 *      the 29 canonical keys; verified by
 *      `backend/tests/emotions/emotion-catalog.test.ts`). Never borrows
 *      another emotion's text. The `ar-EG` slot reuses the document's own
 *      `arabicName` (Modern Standard Arabic) rather than inventing Egyptian
 *      phrasing that was never reviewed.
 */
export function resolveEmotionLocalization(
  doc: LiveEmotionLocalizationInput,
): { names: LocalizedText; descriptions: LocalizedText } {
  if (hasAllRequiredLocales(doc.names) && hasAllRequiredLocales(doc.descriptions)) {
    return { names: doc.names, descriptions: doc.descriptions };
  }

  const canonical = getCanonicalEmotion(doc.key);
  if (canonical) {
    return { names: canonical.names, descriptions: canonical.descriptions };
  }

  const en = doc.name?.trim() || doc.key;
  const ar = doc.arabicName?.trim() || en;
  const description = doc.description?.trim() || '';

  return {
    names: { en, ar, 'ar-EG': ar },
    descriptions: { en: description, ar: description, 'ar-EG': description },
  };
}
