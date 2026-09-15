import type { AppLocale } from '@/localization/locales';
import type { Emotion, LocalizedText } from '@/types/domain';

/**
 * Fallback formatter for when no authoritative emotion name is available at
 * all (e.g. a stale/deep-linked route param that bypassed the emotion
 * list). Canonical emotion keys (backend/src/emotions/emotionCatalog.ts)
 * use both hyphens and underscores as word separators — this splits on
 * either and title-cases each part. This is a readable approximation of
 * the emotion's name, never a substitute for the API's own localized
 * `names` map: prefer that whenever it's available (see
 * resolveLocalizedEmotionName below), since only the catalog knows the
 * curated display text (e.g. "I Feel Like Crying" for `want_to_cry`, not
 * "Want To Cry").
 */
export function formatEmotionKeyAsLabel(key: string): string {
  return key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Locale-aware emotion display name, with a deliberate fallback order:
 *   1. the requested locale's own name;
 *   2. English (`en`), if the requested locale's entry is missing (should
 *      not happen for any of the 29 canonical emotions, but a stale/partial
 *      `names` map from an older cached response must still degrade
 *      gracefully rather than showing nothing);
 *   3. a readable formatting of the stable key itself, if no localized
 *      name is available at all (e.g. a deep link with no emotion metadata).
 * Never mutates or derives from the stable key for anything other than
 * this last-resort display fallback — routing/API/storage always use the
 * raw key untouched.
 */
export function resolveLocalizedEmotionName(
  names: LocalizedText | undefined,
  locale: AppLocale,
  key: string | undefined,
): string {
  const localized = names?.[locale];
  if (localized && localized.trim().length > 0) {
    return localized;
  }
  const english = names?.en;
  if (english && english.trim().length > 0) {
    return english;
  }
  if (!key) {
    return 'Emotion';
  }
  return formatEmotionKeyAsLabel(key);
}

/** Convenience wrapper over resolveLocalizedEmotionName for a full Emotion object (e.g. on the emotion-picker grid). */
export function resolveEmotionDisplayName(emotion: Pick<Emotion, 'key' | 'names'>, locale: AppLocale): string {
  return resolveLocalizedEmotionName(emotion.names, locale, emotion.key);
}

/**
 * @deprecated Prefer resolveLocalizedEmotionName (locale-aware, reads the
 * full `names` map). Retained only because it is still a reasonable
 * fallback formatter given a single already-resolved name string (e.g. a
 * route param that did not carry the full localized map).
 */
export function resolveEmotionLabel(emotionKey: string | undefined, apiName: string | undefined): string {
  if (apiName && apiName.trim().length > 0) {
    return apiName;
  }
  if (!emotionKey) {
    return 'Emotion';
  }
  return formatEmotionKeyAsLabel(emotionKey);
}
