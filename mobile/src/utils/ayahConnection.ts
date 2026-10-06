import type { AppLocale } from '@/localization/locales';
import type { Ayah, AyahConnection, EmotionAyah } from '@/types/domain';

/**
 * The "How this ayah connects" text to show, or null to show nothing.
 *
 * - Only for the emotion the page is showing: a connection tagged with a
 *   different emotionKey (or loaded without one) is never displayed.
 * - Only the active locale's own text: `en` for English, `ar` for both
 *   Arabic and Egyptian Arabic. No cross-language fallback, so a missing
 *   translation hides the section instead of showing the other language.
 * - Blank text counts as missing, so there is never an empty accordion.
 */
export function resolveConnectionText(
  connection: AyahConnection | undefined,
  emotionKey: string | undefined,
  locale: AppLocale,
): string | null {
  if (!connection || !emotionKey || connection.emotionKey !== emotionKey) return null;
  const text = (locale === 'en' ? connection.en : connection.ar)?.trim();
  return text ? text : null;
}

/** Splits mapping-specific connection text off an emotion ayah, so favorites/history only ever store the verse itself. */
export function splitAyahConnection(ayah: EmotionAyah): { ayah: Ayah; connection: AyahConnection | undefined } {
  const { connection, ...verseOnly } = ayah;
  return { ayah: verseOnly, connection };
}
