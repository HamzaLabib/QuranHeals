/**
 * Phase 5A working emotion taxonomy — REFERENCE DATA ONLY.
 *
 * This module is intentionally NOT imported by the seed pipeline, the API, or
 * any runtime code. It exists so that Phase 5A tooling, tests and documentation
 * share one machine-readable copy of the candidate taxonomy while the product
 * owner reviews it.
 *
 * Nothing here activates an emotion or creates a Quran mapping. The live app
 * still serves exactly the 12 emotions defined in `../seed/emotions.ts`.
 *
 * See `docs/phase-5a-emotion-taxonomy.md` for the analysis and rollout plan.
 */

/** Internal grouping. Not shown to users; used for admin/review/analytics. */
export type EmotionFamily =
  | 'distress'
  | 'fear_anxiety'
  | 'guidance_direction'
  | 'loneliness_rejection'
  | 'anger_hurt'
  | 'injustice_betrayal'
  | 'guilt_repentance'
  | 'hope_support'
  | 'peace_gratitude'
  | 'strength_resilience'
  | 'spiritual'
  | 'discovery';

/**
 * Product recommendation for each candidate after overlap analysis. The owner
 * makes the final call; `main` vs `alias`/`sub_state`/`merge_candidate` only
 * affects whether a candidate gets its own home-screen card.
 */
export type TaxonomyRecommendation =
  | 'main'
  | 'alias'
  | 'sub_state'
  | 'merge_candidate'
  | 'discovery_mode';

export type OverlapRisk = 'low' | 'medium' | 'high';

export type TaxonomyKind = 'emotion' | 'discovery';

export type EmotionTaxonomyEntry = {
  /** Stable, language-independent identifier. Never derived from display text. */
  key: string;
  kind: TaxonomyKind;
  english: string;
  arabic: string;
  family: EmotionFamily;
  /** Whether this key is already live in `../seed/emotions.ts`. */
  shipped: boolean;
  englishAliases: string[];
  arabicAliases: string[];
  overlapRisk: OverlapRisk;
  /** Keys this candidate meaningfully overlaps with. */
  overlapsWith: string[];
  recommendation: TaxonomyRecommendation;
  /** If demoted, the main key its aliases resolve to. */
  resolvesTo?: string;
  notes: string;
};

/**
 * Pattern for taxonomy keys. Broader than the live `emotionKeyPattern`
 * (`/^[a-z][a-z-]{1,40}$/` in the models/validators) because five candidate
 * keys use underscores. Widening the live pattern to `/^[a-z][a-z_-]{1,40}$/`
 * is a prerequisite for activating any underscore key — tracked in the docs.
 */
export const TAXONOMY_KEY_PATTERN = /^[a-z][a-z_]{1,40}$/;

/** The live pattern, duplicated here so tooling can check activatability. */
export const LIVE_EMOTION_KEY_PATTERN = /^[a-z][a-z-]{1,40}$/;

export const emotionFamilies: EmotionFamily[] = [
  'distress',
  'fear_anxiety',
  'guidance_direction',
  'loneliness_rejection',
  'anger_hurt',
  'injustice_betrayal',
  'guilt_repentance',
  'hope_support',
  'peace_gratitude',
  'strength_resilience',
  'spiritual',
  'discovery',
];

/**
 * 31 emotional/spiritual candidates. Order mirrors the Phase 5A brief; it is not
 * the proposed home-screen order (see `order` guidance in the docs).
 */
export const emotionTaxonomyCandidates: EmotionTaxonomyEntry[] = [
  {
    key: 'sad',
    kind: 'emotion',
    english: 'Sad',
    arabic: 'حزين',
    family: 'distress',
    shipped: true,
    englishAliases: ['down', 'really sad', 'feeling low', 'heavy hearted', 'unhappy'],
    arabicAliases: ['زعلان', 'حزين أوي', 'نفسيتي وحشة', 'مكتئب', 'مضايق'],
    overlapRisk: 'medium',
    overlapsWith: ['want_to_cry', 'heartbroken', 'hopeless'],
    recommendation: 'main',
    notes: 'Broad entry point for grief/low mood. Anchor of the distress family.',
  },
  {
    key: 'want_to_cry',
    kind: 'emotion',
    english: 'I Want to Cry',
    arabic: 'عايز أعيط',
    family: 'distress',
    shipped: false,
    englishAliases: ['about to cry', 'holding back tears', 'need to let it out', 'on the verge of tears'],
    arabicAliases: ['نفسي أعيط', 'هموت من العياط', 'مش قادر أمسك نفسي', 'دموعي في عيني', 'حاسس إني هنهار'],
    overlapRisk: 'high',
    overlapsWith: ['sad', 'heartbroken', 'overwhelmed'],
    recommendation: 'main',
    notes:
      'Distinct, urgent user intent with very common colloquial Arabic. Quran response pool overlaps `sad`; can share `sad` mappings rather than a separate pool.',
  },
  {
    key: 'heartbroken',
    kind: 'emotion',
    english: 'Heartbroken',
    arabic: 'مكسور الخاطر',
    family: 'distress',
    shipped: false,
    englishAliases: ['broken', 'crushed', 'my heart hurts', 'devastated'],
    arabicAliases: ['قلبي مكسور', 'مجروح', 'منكسر', 'خاطري مكسور'],
    overlapRisk: 'medium',
    overlapsWith: ['sad', 'want_to_cry', 'betrayed', 'rejected'],
    recommendation: 'main',
    notes: 'Relational loss / deep hurt. Different enough from generic `sad` to keep.',
  },
  {
    key: 'overwhelmed',
    kind: 'emotion',
    english: 'Overwhelmed',
    arabic: 'مخنوق',
    family: 'distress',
    shipped: false,
    englishAliases: ['too much', 'drowning', "can't cope", 'suffocating', 'buried'],
    arabicAliases: ['مخنوق', 'مش قادر أستحمل', 'الدنيا ضاقت بيا', 'حاسس إني هنفجر', 'متلغبط'],
    overlapRisk: 'medium',
    overlapsWith: ['stressed', 'anxious', 'tired'],
    recommendation: 'main',
    notes:
      'Owner-confirmed distinct intent: emotional overload / "cannot cope" / mentally suffocated (مخنوق), not the same as pressure-driven `stressed` (متوتر). Keeps its own card. Shares mapping pools with `stressed` where a verse fits both; does not need a separate pool.',
  },
  {
    key: 'anxious',
    kind: 'emotion',
    english: 'Anxious',
    arabic: 'قلقان',
    family: 'fear_anxiety',
    shipped: true,
    englishAliases: ['worried', 'on edge', 'nervous', 'uneasy', "can't relax"],
    arabicAliases: ['قلقان', 'مش مرتاح', 'مكهرب', 'متنرفز من غير سبب', 'جوايا وسواس'],
    overlapRisk: 'medium',
    overlapsWith: ['afraid', 'stressed', 'overwhelmed'],
    recommendation: 'main',
    notes: 'Diffuse worry about the future. Anchor of the fear/anxiety family.',
  },
  {
    key: 'afraid',
    kind: 'emotion',
    english: 'Afraid',
    arabic: 'خايف',
    family: 'fear_anxiety',
    shipped: true,
    englishAliases: ['scared', 'frightened', 'terrified', 'in fear'],
    arabicAliases: ['خايف', 'مرعوب', 'خضة', 'قلبي واجفة'],
    overlapRisk: 'medium',
    overlapsWith: ['anxious', 'stressed'],
    recommendation: 'main',
    notes: 'Fear of a specific, identifiable threat. Distinct from diffuse `anxious`.',
  },
  {
    key: 'stressed',
    kind: 'emotion',
    english: 'Stressed',
    arabic: 'متوتر',
    family: 'fear_anxiety',
    shipped: true,
    englishAliases: ['under pressure', 'stretched thin', 'tense', 'burned out', 'overloaded'],
    arabicAliases: ['متوتر', 'تحت ضغط', 'مضغوط', 'أعصابي مشدودة', 'الضغط عليا كبير'],
    overlapRisk: 'high',
    overlapsWith: ['overwhelmed', 'anxious', 'tired'],
    recommendation: 'main',
    notes:
      'Shipped. Pressure/tension state (متوتر). Sits next to `overwhelmed` (مخنوق, "cannot cope"), which the owner keeps as its own card; the two may share mapping pools.',
  },
  {
    key: 'confused',
    kind: 'emotion',
    english: 'Confused',
    arabic: 'محتار',
    family: 'guidance_direction',
    shipped: true,
    englishAliases: ["can't think straight", 'mixed up', 'unsure', 'torn'],
    arabicAliases: ['محتار', 'مش عارف أفكر', 'دماغي مش راكزة', 'مشوش'],
    overlapRisk: 'high',
    overlapsWith: ['lost', 'seeking_guidance'],
    recommendation: 'main',
    notes:
      'Shipped. Overlaps `lost` (state) and `seeking_guidance` (need); kept because it is already live and users reach for it.',
  },
  {
    key: 'lost',
    kind: 'emotion',
    english: 'Lost',
    arabic: 'تايه',
    family: 'guidance_direction',
    shipped: true,
    englishAliases: ['no direction', "don't know what to do", 'adrift', 'stuck'],
    arabicAliases: ['تايه', 'مش لاقي طريقي', 'ضايع', 'مش عارف رايح فين'],
    overlapRisk: 'high',
    overlapsWith: ['confused', 'seeking_guidance'],
    recommendation: 'main',
    notes: 'Shipped. Life-direction uncertainty rather than momentary confusion.',
  },
  {
    key: 'lonely',
    kind: 'emotion',
    english: 'Lonely',
    arabic: 'وحيد',
    family: 'loneliness_rejection',
    shipped: true,
    englishAliases: ['alone', 'isolated', 'no one understands', 'on my own'],
    arabicAliases: ['وحيد', 'حاسس إني لوحدي', 'مفيش حد جنبي', 'محدش سائل فيا'],
    overlapRisk: 'medium',
    overlapsWith: ['rejected', 'sad'],
    recommendation: 'main',
    notes: 'Shipped. Anchor of the loneliness/rejection family.',
  },
  {
    key: 'rejected',
    kind: 'emotion',
    english: 'Rejected',
    arabic: 'حاسس إني مرفوض',
    family: 'loneliness_rejection',
    shipped: false,
    englishAliases: ['pushed away', 'not wanted', 'left out', 'excluded', 'unwanted'],
    arabicAliases: ['مرفوض', 'محدش عايزني', 'اترميت', 'اتنبذت', 'حد قفل الباب في وشي'],
    overlapRisk: 'medium',
    overlapsWith: ['lonely', 'heartbroken', 'betrayed'],
    recommendation: 'main',
    notes: 'Being pushed away by others — distinct from simply being alone.',
  },
  {
    key: 'angry',
    kind: 'emotion',
    english: 'Angry',
    arabic: 'غضبان',
    family: 'anger_hurt',
    shipped: true,
    englishAliases: ['furious', 'mad', 'seething', 'losing my temper'],
    arabicAliases: ['غضبان', 'متعصب', 'دمي بيغلي', 'هتنجن من الغضب'],
    overlapRisk: 'medium',
    overlapsWith: ['frustrated', 'wronged'],
    recommendation: 'main',
    notes:
      'Shipped. Hot anger. Anchor of the anger/hurt family. Recommended to absorb `frustrated` as a sub-state (pending owner sign-off).',
  },
  {
    key: 'frustrated',
    kind: 'emotion',
    english: 'Frustrated',
    arabic: 'محبط',
    family: 'anger_hurt',
    shipped: false,
    englishAliases: ['fed up', 'irritated', 'annoyed', "nothing is working", 'hitting a wall'],
    arabicAliases: ['محبط', 'متضايق', 'زهقان', 'مش طايق', 'كل حاجة بتبوظ'],
    overlapRisk: 'high',
    overlapsWith: ['angry', 'hopeless', 'tired'],
    recommendation: 'merge_candidate',
    resolvesTo: 'angry',
    notes:
      'Recommended demotion (pending owner sign-off) to reach ~30 visible after keeping `overwhelmed` and `content` as main. محبط/متضايق shares its Quran response with shipped `angry` (restraining anger, forgiving people, "with hardship comes ease"). Blocked-goals nuance is preserved via aliases on `angry`.',
  },
  {
    key: 'betrayed',
    kind: 'emotion',
    english: 'Betrayed',
    arabic: 'مخذول',
    family: 'injustice_betrayal',
    shipped: false,
    englishAliases: ['let down', 'stabbed in the back', "someone i trusted hurt me", 'deceived'],
    arabicAliases: ['مخذول', 'متخان', 'اتخدعت', 'اللي كنت واثق فيه خذلني', 'اتطعنت من الضهر'],
    overlapRisk: 'medium',
    overlapsWith: ['wronged', 'heartbroken', 'forgiveness_struggle'],
    recommendation: 'main',
    notes: 'Trust broken by a specific person. Anchor of the injustice/betrayal family.',
  },
  {
    key: 'wronged',
    kind: 'emotion',
    english: 'Wronged',
    arabic: 'مظلوم',
    family: 'injustice_betrayal',
    shipped: false,
    englishAliases: ['treated unfairly', 'done wrong', 'injustice', 'no one stood up for me'],
    arabicAliases: ['مظلوم', 'اتظلمت', 'محدش واقف جنبي في حقي', 'الحق ضاع'],
    overlapRisk: 'medium',
    overlapsWith: ['betrayed', 'angry', 'forgiveness_struggle'],
    recommendation: 'main',
    notes: 'Injustice from any source (not only a trusted person). Strong distinct Quran theme.',
  },
  {
    key: 'forgiveness_struggle',
    kind: 'emotion',
    english: "I Can't Forgive",
    arabic: 'مش قادر أسامح',
    family: 'injustice_betrayal',
    shipped: false,
    englishAliases: ['holding a grudge', "can't let it go", 'want revenge', 'resentful', 'bitter'],
    arabicAliases: ['مش قادر أسامح', 'شايل منه', 'عندي غل', 'بكرهه', 'عايز أنتقم'],
    overlapRisk: 'medium',
    overlapsWith: ['betrayed', 'wronged', 'angry'],
    recommendation: 'main',
    notes:
      'Action-intent (the struggle to let go) rather than a raw feeling. Keep as its own card; it needs a distinct Quran response.',
  },
  {
    key: 'guilty',
    kind: 'emotion',
    english: 'Guilty',
    arabic: 'حاسس بالذنب',
    family: 'guilt_repentance',
    shipped: false,
    englishAliases: ['ashamed', 'i messed up', 'i did wrong', 'conscience is heavy'],
    arabicAliases: ['حاسس بالذنب', 'مكسوف من نفسي', 'ضميري مأنبني', 'غلطت وحاسس بوجع'],
    overlapRisk: 'high',
    overlapsWith: ['regretful', 'repentant'],
    recommendation: 'main',
    notes:
      'Anchor of the guilt/repentance family. Recommended to absorb `regretful` as a sub-state (pending owner sign-off).',
  },
  {
    key: 'regretful',
    kind: 'emotion',
    english: 'Regretful',
    arabic: 'ندمان',
    family: 'guilt_repentance',
    shipped: false,
    englishAliases: ['i regret it', 'wish i could take it back', 'remorseful', 'sorry for what i did'],
    arabicAliases: ['ندمان', 'نفسي أرجع الزمن', 'يا ريتني ما عملتها', 'بعض على صوابعي'],
    overlapRisk: 'high',
    overlapsWith: ['guilty', 'repentant'],
    recommendation: 'merge_candidate',
    resolvesTo: 'guilty',
    notes:
      'Recommended demotion (pending owner sign-off). In practice indistinguishable from `guilty` (ندمان/بالذنب) for verse selection; `repentant` already carries the forward-looking tawbah intent. Fold in as a sub-state of `guilty`.',
  },
  {
    key: 'repentant',
    kind: 'emotion',
    english: 'I Want to Repent',
    arabic: 'عايز أتوب',
    family: 'guilt_repentance',
    shipped: false,
    englishAliases: ['want to come back to Allah', 'ready to change', 'turn back', 'make tawbah'],
    arabicAliases: ['عايز أتوب', 'ندمان وعايز أرجع لربنا', 'نفسي أبدأ صفحة جديدة', 'عايز أرجع'],
    overlapRisk: 'medium',
    overlapsWith: ['guilty', 'regretful', 'closer_to_allah'],
    recommendation: 'main',
    notes:
      'Forward-looking spiritual intent (tawbah), not just the feeling of guilt. Distinct Quran response — keep separate.',
  },
  {
    key: 'hopeless',
    kind: 'emotion',
    english: 'Hopeless',
    arabic: 'فاقد الأمل',
    family: 'hope_support',
    shipped: true,
    englishAliases: ['no hope', 'giving up', "what's the point", 'in despair', 'defeated'],
    arabicAliases: ['فاقد الأمل', 'مليش نفس', 'خلاص مفيش فايدة', 'يأست', 'زهقت من كل حاجة'],
    overlapRisk: 'medium',
    overlapsWith: ['sad', 'frustrated', 'weak'],
    recommendation: 'main',
    notes: 'Shipped. Despair pole of the hope/support family. Opposite of `hopeful` — both stay.',
  },
  {
    key: 'tired',
    kind: 'emotion',
    english: 'Tired',
    arabic: 'تعبان',
    family: 'distress',
    shipped: true,
    englishAliases: ['exhausted', 'worn out', 'drained', 'no energy left', 'weary'],
    arabicAliases: ['تعبان', 'مرهق', 'مفيش في جسمي طاقة', 'زهقان ونفسي أرتاح', 'قواي خلصت'],
    overlapRisk: 'medium',
    overlapsWith: ['weak', 'overwhelmed', 'hopeless'],
    recommendation: 'main',
    notes: 'Shipped. Fatigue/depletion. Kept distinct from `weak` (capability) and `stressed` (pressure).',
  },
  {
    key: 'weak',
    kind: 'emotion',
    english: 'Feeling Weak',
    arabic: 'حاسس إني ضعيف',
    family: 'strength_resilience',
    shipped: false,
    englishAliases: ['powerless', 'helpless', 'not strong enough', 'fragile'],
    arabicAliases: ['حاسس إني ضعيف', 'مش قد الموقف', 'مليش حيلة', 'محدش سندي'],
    overlapRisk: 'medium',
    overlapsWith: ['tired', 'hopeless', 'strength'],
    recommendation: 'main',
    notes:
      'State of feeling incapable. Pairs with `strength` (the request) but is a different flow — expressing vs asking.',
  },
  {
    key: 'reassurance',
    kind: 'emotion',
    english: 'I Need Reassurance',
    arabic: 'محتاج أطمّن',
    family: 'hope_support',
    shipped: false,
    englishAliases: ['need comfort', 'tell me it will be okay', 'need to feel safe', 'calm my heart'],
    arabicAliases: ['محتاج أطمّن', 'قلبي مش مطمن', 'عايز حد يقولي هتعدي', 'محتاج سكينة'],
    overlapRisk: 'medium',
    overlapsWith: ['anxious', 'peaceful', 'hopeful'],
    recommendation: 'main',
    notes: 'Explicit request for comfort/tuma’ninah. Different intent from stating a feeling — keep as a card.',
  },
  {
    key: 'patience',
    kind: 'emotion',
    english: 'I Need Patience',
    arabic: 'محتاج صبر',
    family: 'strength_resilience',
    shipped: false,
    englishAliases: ['help me be patient', 'running out of patience', 'need to endure', 'sabr'],
    arabicAliases: ['محتاج صبر', 'صبري خلص', 'مش قادر أستحمل أكتر', 'عايز أثبت'],
    overlapRisk: 'low',
    overlapsWith: ['strength', 'tired'],
    recommendation: 'main',
    notes: 'Very strong, well-defined Quran theme (sabr). Clear standalone card.',
  },
  {
    key: 'strength',
    kind: 'emotion',
    english: 'I Need Strength',
    arabic: 'محتاج قوة',
    family: 'strength_resilience',
    shipped: false,
    englishAliases: ['help me be strong', 'need courage', 'give me resolve', 'need to keep going'],
    arabicAliases: ['محتاج قوة', 'عايز أقوى', 'نفسي ألاقي سند', 'محتاج عزيمة'],
    overlapRisk: 'medium',
    overlapsWith: ['weak', 'patience'],
    recommendation: 'main',
    notes: 'Request for tazkiyah/strength. Pairs with `weak`; both retained.',
  },
  {
    key: 'hopeful',
    kind: 'emotion',
    english: 'Hopeful',
    arabic: 'عندي أمل',
    family: 'hope_support',
    shipped: false,
    englishAliases: ['feeling hopeful', 'optimistic', 'looking forward', 'things are looking up'],
    arabicAliases: ['عندي أمل', 'متفائل', 'حاسس إن الخير جاي', 'ربنا مش هيسيبني'],
    overlapRisk: 'medium',
    overlapsWith: ['grateful', 'peaceful', 'reassurance'],
    recommendation: 'main',
    notes: 'Positive pole of the hope family. Kept as the deliberate opposite of `hopeless`.',
  },
  {
    key: 'peaceful',
    kind: 'emotion',
    english: 'Peaceful',
    arabic: 'مطمئن',
    family: 'peace_gratitude',
    shipped: true,
    englishAliases: ['calm', 'at peace', 'settled', 'serene', 'my heart is quiet'],
    arabicAliases: ['مطمئن', 'مرتاح', 'قلبي هادي', 'حاسس بسكينة', 'راضي ومرتاح'],
    overlapRisk: 'high',
    overlapsWith: ['content', 'grateful', 'reassurance'],
    recommendation: 'main',
    notes:
      'Shipped. Anchor of the peace/gratitude family — a settled, calm heart (سكينة/طمأنينة). Sits next to `content` (رضا/قناعة), which the owner keeps as its own card.',
  },
  {
    key: 'grateful',
    kind: 'emotion',
    english: 'Grateful',
    arabic: 'ممتن',
    family: 'peace_gratitude',
    shipped: true,
    englishAliases: ['thankful', 'blessed', 'want to say alhamdulillah', 'appreciative'],
    arabicAliases: ['ممتن', 'شاكر', 'الحمد لله', 'حاسس بنعمة ربنا', 'مقدر اللي عندي'],
    overlapRisk: 'low',
    overlapsWith: ['peaceful', 'content', 'hopeful'],
    recommendation: 'main',
    notes: 'Shipped. Shukr — a distinct, positive entry point.',
  },
  {
    key: 'content',
    kind: 'emotion',
    english: 'Content',
    arabic: 'راضي',
    family: 'peace_gratitude',
    shipped: false,
    englishAliases: ['satisfied', 'at ease with what i have', 'accepting', 'qana‘ah'],
    arabicAliases: ['راضي', 'قانع', 'راضي بقسمتي', 'مبسوط باللي عندي'],
    overlapRisk: 'medium',
    overlapsWith: ['peaceful', 'grateful'],
    recommendation: 'main',
    notes:
      'Owner-confirmed distinct spiritual state: رضا / قناعة — acceptance and contentment with what Allah decreed — not the same as a settled/calm heart (`peaceful` / مطمئن). Keeps its own directly accessible card.',
  },
  {
    key: 'seeking_guidance',
    kind: 'emotion',
    english: 'Seeking Guidance',
    arabic: 'محتاج هداية',
    family: 'guidance_direction',
    shipped: false,
    englishAliases: ['need guidance', 'show me the way', 'help me decide', 'need hidayah', 'istikhara'],
    arabicAliases: ['محتاج هداية', 'ربنا يهديني', 'مش عارف أختار', 'محتاج إشارة', 'عايز أستخير'],
    overlapRisk: 'medium',
    overlapsWith: ['lost', 'confused'],
    recommendation: 'main',
    notes:
      'The explicit request for hidayah. Different intent from `lost`/`confused` (states). Keep as a card.',
  },
  {
    key: 'closer_to_allah',
    kind: 'emotion',
    english: 'I Want to Be Closer to Allah',
    arabic: 'عايز أقرب من ربنا',
    family: 'spiritual',
    shipped: false,
    englishAliases: ['want to feel connected', 'strengthen my iman', 'grow spiritually', 'feel distant from Allah'],
    arabicAliases: ['عايز أقرب من ربنا', 'حاسس إني بعيد عن ربنا', 'إيماني ضعيف وعايز أقويه', 'نفسي أحس بربنا'],
    overlapRisk: 'medium',
    overlapsWith: ['repentant', 'seeking_guidance'],
    recommendation: 'main',
    notes: 'Spiritual-growth intent. Anchor of the `spiritual` family.',
  },
];

/** Discovery mode — deliberately NOT an emotion. */
export const discoveryModes: EmotionTaxonomyEntry[] = [
  {
    key: 'quran_message',
    kind: 'discovery',
    english: 'A Message from the Quran',
    arabic: 'رسالة من القرآن',
    family: 'discovery',
    shipped: false,
    englishAliases: ['surprise me', 'anything for me today', 'general reflection', 'just show me an ayah'],
    arabicAliases: ['رسالة من القرآن', 'اختارلي آية', 'أي حاجة تنفعني النهارده', 'آية عشوائية مفيدة'],
    overlapRisk: 'low',
    overlapsWith: [],
    recommendation: 'discovery_mode',
    notes:
      'Not an emotional state. A separate entry point that returns a curated general-reflection ayah from its own reviewed pool. See docs section "Quran Message Mode".',
  },
];

/** All 32 working candidates (31 emotional/spiritual + 1 discovery). */
export const phase5aTaxonomy: EmotionTaxonomyEntry[] = [
  ...emotionTaxonomyCandidates,
  ...discoveryModes,
];

/** Keys the Phase 5A tooling accepts as "known" emotion/discovery keys. */
export const taxonomyKeys: string[] = phase5aTaxonomy.map((entry) => entry.key);

/** Candidates recommended to keep their own home-screen card. */
export const recommendedVisibleKeys: string[] = phase5aTaxonomy
  .filter((entry) => entry.recommendation === 'main' || entry.recommendation === 'discovery_mode')
  .map((entry) => entry.key);

/** Candidates recommended for demotion, with the key they resolve to. */
export const recommendedDemotions: { key: string; resolvesTo: string; reason: string }[] =
  phase5aTaxonomy
    .filter((entry) => entry.recommendation !== 'main' && entry.recommendation !== 'discovery_mode')
    .map((entry) => ({
      key: entry.key,
      resolvesTo: entry.resolvesTo ?? '',
      reason: entry.notes,
    }));
