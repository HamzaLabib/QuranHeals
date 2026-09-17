import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Quran Arabic text size on the ayah screen. Deliberately a SEPARATE,
 * purely local/on-device concern from quranTranslationPreference.ts and
 * useAppLocale.tsx — this preference is never uploaded to MongoDB or
 * reconciled through preferencesSync.ts/syncOrchestrator.ts, unlike
 * locale/translationDisplayMode/translationId. It is a display setting, not
 * account data, so a signed-in user's other devices each keep their own
 * value.
 *
 * Two independent things combine into the size actually rendered:
 *  - `preferredSize`: the user's explicit choice via the A−/Auto/A+
 *    controls, persisted here.
 *  - a per-ayah automatic LENGTH ADJUSTMENT (see computeLengthAdjustment)
 *    that trims the preferred size down for longer ayahs so they still fit
 *    comfortably. "Auto" only resets `preferredSize` to the default — the
 *    length adjustment always applies on top of whatever `preferredSize` is.
 */

/** The only preferred main-screen sizes selectable via A−/A+ — a fixed step-2 ladder, never an arbitrary number. */
export const QURAN_FONT_SIZES: readonly number[] = [22, 24, 26, 28, 30, 32];

export const DEFAULT_QURAN_FONT_SIZE = 26;

export const QURAN_FONT_SIZE_STEP = 2;

export const MIN_QURAN_FONT_SIZE = 22;
export const MAX_QURAN_FONT_SIZE = 32;

/** Favorites/compact cards render smaller than the main screen — this is the flat offset subtracted from the main preferred size before compact's own clamp/length-adjustment. */
const COMPACT_SIZE_OFFSET = 5;
export const MIN_COMPACT_QURAN_FONT_SIZE = 18;
export const MAX_COMPACT_QURAN_FONT_SIZE = 27;

/** Quran-safe line-height ratio: generous enough that Uthmani harakat/tashkeel above and below each letter never clip against the line box. */
const LINE_HEIGHT_RATIO = 1.62;

const STORAGE_KEY = 'quran-heals:quran-font-size-preference:v1';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isValidQuranFontSize(value: unknown): value is number {
  return typeof value === 'number' && (QURAN_FONT_SIZES as readonly number[]).includes(value);
}

/** Validates an arbitrary stored payload — never throws, never returns a value outside the approved ladder. */
export function parseQuranFontSizePreference(raw: unknown): number {
  return isValidQuranFontSize(raw) ? raw : DEFAULT_QURAN_FONT_SIZE;
}

export async function loadQuranFontSizePreference(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_QURAN_FONT_SIZE;
    return parseQuranFontSizePreference(JSON.parse(raw));
  } catch {
    return DEFAULT_QURAN_FONT_SIZE;
  }
}

export async function saveQuranFontSizePreference(size: number): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(size));
  } catch {
    // Persistence failure is non-fatal: the in-memory selection still applies this session.
  }
}

/** Moves one step (+1/-1) along the fixed size ladder, clamped at both ends — used by the A−/A+ controls. */
export function stepQuranFontSize(current: number, direction: 1 | -1): number {
  return clamp(current + direction * QURAN_FONT_SIZE_STEP, MIN_QURAN_FONT_SIZE, MAX_QURAN_FONT_SIZE);
}

/**
 * Counts words by trimmed whitespace splitting, NOT raw character count —
 * Uthmani diacritics (tashkeel) attach to letters rather than forming
 * separate characters, but they still inflate a naive character count. An
 * empty/whitespace-only string has zero words.
 */
export function countArabicWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

/** 40 words or fewer: no reduction. 41-80: -2. More than 80: -4. */
export function computeLengthAdjustment(wordCount: number): number {
  if (wordCount <= 40) return 0;
  if (wordCount <= 80) return -2;
  return -4;
}

/** Final main-screen Arabic font size: preferred size + length adjustment, clamped to [MIN_QURAN_FONT_SIZE, MAX_QURAN_FONT_SIZE]. */
export function computeMainQuranFontSize(preferredSize: number, wordCount: number): number {
  const adjusted = preferredSize + computeLengthAdjustment(wordCount);
  return clamp(adjusted, MIN_QURAN_FONT_SIZE, MAX_QURAN_FONT_SIZE);
}

/**
 * Final compact/Favorites Arabic font size. The compact preferred size is
 * derived from the main preferred size (offset -5, clamped to the compact
 * range) BEFORE the length adjustment is applied, then the result is
 * clamped to the compact range again.
 */
export function computeCompactQuranFontSize(preferredSize: number, wordCount: number): number {
  const compactPreferred = clamp(preferredSize - COMPACT_SIZE_OFFSET, MIN_COMPACT_QURAN_FONT_SIZE, MAX_COMPACT_QURAN_FONT_SIZE);
  const adjusted = compactPreferred + computeLengthAdjustment(wordCount);
  return clamp(adjusted, MIN_COMPACT_QURAN_FONT_SIZE, MAX_COMPACT_QURAN_FONT_SIZE);
}

/** lineHeight = round(fontSize * 1.62) — never a tight ratio that could clip tashkeel. */
export function computeQuranLineHeight(fontSize: number): number {
  return Math.round(fontSize * LINE_HEIGHT_RATIO);
}
