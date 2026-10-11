/**
 * Layout planning for the shareable ayah image cards (ShareAyahSheet /
 * ShareAyahCard). Pure and platform-free so it is unit-testable.
 *
 * Every measurement here is in DESIGN UNITS: a card is always 1080 units
 * wide (and 1920 / 1350 / 1080 tall), which is exactly the exported image's
 * pixel size. ShareAyahCard renders the same design at any on-screen width
 * by multiplying every unit by `width / 1080`, so the small preview and the
 * full-size export share one layout.
 *
 * Quran text is never altered: an ayah that is too long for one card is
 * split only at the spaces between words, into consecutive slices of the
 * original string, so joining the slices with a space gives back the exact
 * text. A standalone pause mark (ۖ ۗ ۚ …, which Tanzil's Uthmani text keeps
 * as its own space-separated token) always stays with the word before it,
 * so no card can start with an orphaned mark.
 *
 * The planner estimates text widths; ShareAyahCard then measures the real
 * rendered height, and if anything would overflow the sheet re-plans with a
 * larger `estimateScale` (smaller text / more cards) — so nothing is ever
 * clipped or silently cut.
 */

export type ShareCardFormat = 'story' | 'post' | 'square';

export const SHARE_CARD_FORMATS: readonly ShareCardFormat[] = ['story', 'post', 'square'];

export const DEFAULT_SHARE_CARD_FORMAT: ShareCardFormat = 'story';

export type ShareCardFormatSpec = {
  /** Exported image size in pixels (= design units). */
  width: number;
  height: number;
  /** Shown next to the format's name, e.g. "9:16". */
  ratioLabel: string;
  paddingX: number;
  /** Story padding keeps content clear of the apps' own top/bottom overlays. */
  paddingTop: number;
  paddingBottom: number;
  maxArabicFontSize: number;
};

export const SHARE_CARD_FORMAT_SPECS: Record<ShareCardFormat, ShareCardFormatSpec> = {
  story: { width: 1080, height: 1920, ratioLabel: '9:16', paddingX: 100, paddingTop: 250, paddingBottom: 250, maxArabicFontSize: 80 },
  post: { width: 1080, height: 1350, ratioLabel: '4:5', paddingX: 96, paddingTop: 124, paddingBottom: 104, maxArabicFontSize: 70 },
  square: { width: 1080, height: 1080, ratioLabel: '1:1', paddingX: 88, paddingTop: 96, paddingBottom: 84, maxArabicFontSize: 64 },
};

export const SHARE_CARD_DESIGN_WIDTH = 1080;

/** Never smaller than this: ~16pt when the image is viewed full-width on a phone. */
export const MIN_ARABIC_FONT_SIZE = 44;
const ARABIC_FONT_STEP = 2;
/** Generous on purpose: Uthmani harakat stack above and below each letter. */
export const ARABIC_LINE_HEIGHT_RATIO = 1.75;

export const MIN_TRANSLATION_FONT_SIZE = 30;
const MAX_TRANSLATION_FONT_SIZE = 40;
/** A card holding only translation text (a long ayah's later cards) may use larger text. */
const MAX_TRANSLATION_ONLY_FONT_SIZE = 44;
export const TRANSLATION_LINE_HEIGHT_RATIO = 1.45;

/** Fixed blocks, shared with ShareAyahCard so the plan and the render agree. */
export const SHARE_CARD_METRICS = {
  frameInset: 36,
  frameRadius: 40,
  frameWidth: 2,
  pageIndicatorFontSize: 24,
  pageIndicatorHeight: 34,
  pageIndicatorGap: 28,
  dividerGap: 36,
  dividerWidth: 120,
  dividerThickness: 3,
  referenceGap: 44,
  referenceFontSize: 30,
  referenceLineHeight: 42,
  /** Leaf ornament under the reference: gap above, total height, hairline length each side. */
  ornamentGap: 30,
  ornamentHeight: 26,
  ornamentLineWidth: 130,
  ornamentLineThickness: 2,
  footerGap: 40,
  invitationFontSize: 26,
  invitationLineHeight: 38,
  /** Between the invitation and the wordmark. */
  invitationGap: 26,
  brandFontSize: 30,
  brandLineHeight: 40,
  attributionFontSize: 20,
  attributionLineHeight: 28,
  footerInnerGap: 10,
} as const;

/** Reflection invitation, wordmark, and up to two attribution lines (Quran text, translation). */
export const SHARE_CARD_FOOTER_HEIGHT =
  SHARE_CARD_METRICS.invitationLineHeight + SHARE_CARD_METRICS.invitationGap
  + SHARE_CARD_METRICS.brandLineHeight + SHARE_CARD_METRICS.footerInnerGap + 2 * SHARE_CARD_METRICS.attributionLineHeight;

export function arabicLineHeight(fontSize: number): number {
  return Math.round(fontSize * ARABIC_LINE_HEIGHT_RATIO);
}

export function translationLineHeight(fontSize: number): number {
  return Math.round(fontSize * TRANSLATION_LINE_HEIGHT_RATIO);
}

/** Height available to the content block (page indicator, ayah, divider, translation, reference). */
export function shareCardContentHeight(format: ShareCardFormat): number {
  const spec = SHARE_CARD_FORMAT_SPECS[format];
  return spec.height - spec.paddingTop - spec.paddingBottom - SHARE_CARD_FOOTER_HEIGHT - SHARE_CARD_METRICS.footerGap;
}

export function shareCardContentWidth(format: ShareCardFormat): number {
  return SHARE_CARD_DESIGN_WIDTH - 2 * SHARE_CARD_FORMAT_SPECS[format].paddingX;
}

// ---------------------------------------------------------------------------
// Tokenizing — slices of the original string, never rebuilt text.

type Unit = {
  start: number;
  end: number;
  /** Estimated advance in em (multiply by the font size). */
  widthEm: number;
  /** Ends with a pause mark or sentence punctuation: a natural place to break between cards. */
  isPause: boolean;
};

// Quranic annotation signs used as standalone pause marks in Tanzil Uthmani.
const PAUSE_MARK_TOKEN = /^[ۖ-ۜ۞۩]+$/;
// Combining marks (harakat, superscript alef, small high/low signs) take no width of their own.
const ARABIC_COMBINING = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/;

const ARABIC_LETTER_EM = 0.52;
const ARABIC_TATWEEL_EM = 0.45;
const PAUSE_MARK_EM = 0.35;
const LATIN_CHAR_EM = 0.53;
const SPACE_EM = 0.3;

function arabicTokenWidthEm(token: string): number {
  if (PAUSE_MARK_TOKEN.test(token)) return PAUSE_MARK_EM;
  let width = 0;
  for (const char of token) {
    if (ARABIC_COMBINING.test(char)) continue;
    width += char === 'ـ' ? ARABIC_TATWEEL_EM : ARABIC_LETTER_EM;
  }
  return width;
}

function latinTokenWidthEm(token: string): number {
  return token.length * LATIN_CHAR_EM;
}

/** Space-separated tokens with their offsets in `text`. */
function tokenize(text: string): { start: number; end: number; token: string }[] {
  const tokens: { start: number; end: number; token: string }[] = [];
  const pattern = /\S+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length, token: match[0] });
  }
  return tokens;
}

/** Words, each with any following standalone pause marks attached — the only places a card may break. */
export function arabicUnits(text: string): Unit[] {
  const units: Unit[] = [];
  for (const { start, end, token } of tokenize(text)) {
    const width = arabicTokenWidthEm(token);
    const last = units[units.length - 1];
    if (PAUSE_MARK_TOKEN.test(token) && last) {
      last.end = end;
      last.widthEm += SPACE_EM + width;
      last.isPause = true;
      continue;
    }
    units.push({ start, end, widthEm: width, isPause: false });
  }
  return units;
}

function translationUnits(text: string): Unit[] {
  return tokenize(text).map(({ start, end, token }) => ({
    start,
    end,
    widthEm: latinTokenWidthEm(token),
    isPause: /[.;:!?,)]["'’”]?$/.test(token),
  }));
}

/** Lines needed for `units` at `fontSize`, greedily wrapping at `lineWidth`. */
function countLines(units: Unit[], fontSize: number, lineWidth: number, scale: number): number {
  if (units.length === 0) return 0;
  let lines = 1;
  let used = 0;
  for (const unit of units) {
    const width = unit.widthEm * fontSize * scale;
    const spaced = used === 0 ? width : used + SPACE_EM * fontSize * scale + width;
    if (spaced <= lineWidth || used === 0) {
      used = spaced;
    } else {
      lines += 1;
      used = width;
    }
  }
  return lines;
}

/** Splits units into `count` consecutive groups of similar width, preferring breaks at pauses. */
function balancedGroups(units: Unit[], count: number): Unit[][] {
  if (count <= 1 || units.length <= 1) return [units];
  const parts = Math.min(count, units.length);
  const cumulative: number[] = [0];
  for (const unit of units) cumulative.push(cumulative[cumulative.length - 1] + unit.widthEm + SPACE_EM);
  const total = cumulative[cumulative.length - 1];
  const pauseBonus = (total / parts) * 0.12;

  const breaks: number[] = [];
  let previous = 0;
  for (let part = 1; part < parts; part += 1) {
    const target = (total * part) / parts;
    // Each remaining group needs at least one unit.
    const latest = units.length - (parts - part);
    let best = previous + 1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let index = previous + 1; index <= latest; index += 1) {
      const score = Math.abs(cumulative[index] - target) - (units[index - 1].isPause ? pauseBonus : 0);
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    breaks.push(best);
    previous = best;
  }

  const groups: Unit[][] = [];
  let start = 0;
  for (const index of [...breaks, units.length]) {
    groups.push(units.slice(start, index));
    start = index;
  }
  return groups;
}

function sliceOf(text: string, group: Unit[]): string {
  return text.slice(group[0].start, group[group.length - 1].end);
}

// ---------------------------------------------------------------------------
// Planning

export type ShareCardPage = {
  /** Stable within one plan, e.g. "ar-1", "tr-2", "all-1". */
  key: string;
  pageNumber: number;
  pageCount: number;
  /** A consecutive slice of the ayah's Arabic text, or null on a translation-only card. */
  arabic: string | null;
  translation: string | null;
  arabicFontSize: number;
  translationFontSize: number;
};

export type ShareCardPlanInput = {
  arabicText: string;
  /** Null/blank when the translation is hidden or unavailable. */
  translation: string | null;
  format: ShareCardFormat;
  /**
   * Multiplies every width estimate. 1 by default; ShareAyahSheet raises it
   * when a rendered card measures taller than planned.
   */
  estimateScale?: number;
};

type Sizing = { contentWidth: number; contentHeight: number; scale: number };

function blockHeight(
  sizing: Sizing,
  parts: { arabic: Unit[] | null; arabicSize: number; translation: Unit[] | null; translationSize: number; paged: boolean },
): number {
  const m = SHARE_CARD_METRICS;
  let height = m.referenceGap + m.referenceLineHeight + m.ornamentGap + m.ornamentHeight;
  if (parts.paged) height += m.pageIndicatorHeight + m.pageIndicatorGap;
  if (parts.arabic) {
    height += countLines(parts.arabic, parts.arabicSize, sizing.contentWidth, sizing.scale) * arabicLineHeight(parts.arabicSize);
  }
  if (parts.translation) {
    if (parts.arabic) height += 2 * m.dividerGap + m.dividerThickness;
    height += countLines(parts.translation, parts.translationSize, sizing.contentWidth, sizing.scale) * translationLineHeight(parts.translationSize);
  }
  return height;
}

function fits(sizing: Sizing, parts: Parameters<typeof blockHeight>[1]): boolean {
  return blockHeight(sizing, parts) <= sizing.contentHeight;
}

function arabicSizes(format: ShareCardFormat): number[] {
  const sizes: number[] = [];
  for (let size = SHARE_CARD_FORMAT_SPECS[format].maxArabicFontSize; size >= MIN_ARABIC_FONT_SIZE; size -= ARABIC_FONT_STEP) sizes.push(size);
  return sizes;
}

/** Translation size that pairs with an Arabic size on a combined card. */
export function pairedTranslationFontSize(arabicFontSize: number): number {
  return Math.min(MAX_TRANSLATION_FONT_SIZE, Math.max(MIN_TRANSLATION_FONT_SIZE, Math.round(arabicFontSize * 0.5)));
}

function translationOnlySizes(): number[] {
  const sizes: number[] = [];
  for (let size = MAX_TRANSLATION_ONLY_FONT_SIZE; size >= MIN_TRANSLATION_FONT_SIZE; size -= 2) sizes.push(size);
  return sizes;
}

/**
 * Fewest groups (then largest common font size) such that every group fits
 * on its own card. Always succeeds: in the limit every unit is its own group.
 */
function splitToFit(
  units: Unit[],
  sizes: number[],
  fitsGroup: (group: Unit[], size: number, paged: boolean) => boolean,
): { groups: Unit[][]; size: number } {
  for (let count = 1; count <= units.length; count += 1) {
    const groups = balancedGroups(units, count);
    const paged = groups.length > 1;
    for (const size of sizes) {
      if (groups.every((group) => fitsGroup(group, size, paged))) return { groups, size };
    }
  }
  return { groups: units.map((unit) => [unit]), size: sizes[sizes.length - 1] };
}

export function planShareCards({ arabicText, translation, format, estimateScale = 1 }: ShareCardPlanInput): ShareCardPage[] {
  const sizing: Sizing = {
    contentWidth: shareCardContentWidth(format),
    contentHeight: shareCardContentHeight(format),
    scale: estimateScale,
  };
  const arabic = arabicUnits(arabicText);
  const translationText = translation && translation.trim().length > 0 ? translation : null;
  const translationParts = translationText ? translationUnits(translationText) : null;
  const sizes = arabicSizes(format);

  // 1. Everything on one card.
  for (const size of sizes) {
    const translationSize = pairedTranslationFontSize(size);
    if (fits(sizing, { arabic, arabicSize: size, translation: translationParts, translationSize, paged: false })) {
      return [{
        key: 'all-1',
        pageNumber: 1,
        pageCount: 1,
        arabic: arabicText,
        translation: translationText,
        arabicFontSize: size,
        translationFontSize: translationSize,
      }];
    }
  }

  // 2. Arabic cards first (in order), then the translation's own cards. A
  //    translation is never cut to sit beside part of the Arabic, which
  //    could suggest a word-for-word correspondence that isn't there.
  const paged = translationParts !== null;
  const arabicSplit = splitToFit(arabic, sizes, (group, size, isPaged) =>
    fits(sizing, { arabic: group, arabicSize: size, translation: null, translationSize: 0, paged: isPaged || paged }));
  const translationSplit = translationParts && translationText
    ? splitToFit(translationParts, translationOnlySizes(), (group, size) =>
      fits(sizing, { arabic: null, arabicSize: 0, translation: group, translationSize: size, paged: true }))
    : null;

  const pageCount = arabicSplit.groups.length + (translationSplit?.groups.length ?? 0);
  const pages: ShareCardPage[] = arabicSplit.groups.map((group, index) => ({
    key: `ar-${index + 1}`,
    pageNumber: index + 1,
    pageCount,
    arabic: sliceOf(arabicText, group),
    translation: null,
    arabicFontSize: arabicSplit.size,
    translationFontSize: 0,
  }));
  if (translationSplit && translationText) {
    translationSplit.groups.forEach((group, index) => {
      pages.push({
        key: `tr-${index + 1}`,
        pageNumber: pages.length + 1,
        pageCount,
        arabic: null,
        translation: sliceOf(translationText, group),
        arabicFontSize: 0,
        translationFontSize: translationSplit.size,
      });
    });
  }
  return pages;
}

/** Above this, ShareAyahSheet stops re-planning (in practice it settles after 0-2 steps). */
export const MAX_ESTIMATE_LEVEL = 12;

export function estimateScaleForLevel(level: number): number {
  return Math.pow(1.1, Math.max(0, Math.min(level, MAX_ESTIMATE_LEVEL)));
}

/**
 * The translator credit shown on cards that carry translation text, taken
 * from the ayah's own `translationSource` (e.g. "Marmaduke Pickthall — The
 * Meaning of the Glorious Koran — …" → "Marmaduke Pickthall").
 */
export function translationAttribution(translationSource: string | undefined | null): string | null {
  const source = translationSource?.trim();
  if (!source) return null;
  const name = source.split(' — ')[0].trim();
  return name.length > 0 ? name : null;
}

/** Tanzil's terms require the source to be clearly indicated with a link to tanzil.net. */
export const QURAN_TEXT_CARD_ATTRIBUTION = 'Quran text: Tanzil Project · tanzil.net';

export const SHARE_CARD_BRAND = 'Quran Heals';

/**
 * Printed on every card, in both languages (a shared image reaches readers
 * of either). It points to the app's existing Add Reflection action; the
 * image itself is never a button or a link.
 */
export const REFLECTION_INVITATION = { en: 'Write your reflection', ar: 'اكتب خاطرتك' } as const;
