import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { AyahExperience } from '@/components/AyahExperience';
import type { LocalizedText } from '@/types/domain';

/** `namesJson` carries the full localized names map from the emotion-picker screen (which already fetched it) as a JSON string route param — parsed defensively since a stale/deep-linked navigation may not carry it at all. */
function parseNamesParam(raw: string | string[] | undefined): LocalizedText | undefined {
  const value = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined;
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as LocalizedText;
    }
  } catch {
    // Malformed param: fall through to the key-based fallback in resolveLocalizedEmotionName.
  }
  return undefined;
}

/**
 * The emotion↔ayah flow — approved emotion↔ayah mappings only. See
 * app/ayah/general.tsx for the completely separate "Need an ayah from the
 * Quran?" flow; both render the same AyahExperience with a different
 * `source.mode`.
 */
export default function EmotionAyahScreen() {
  const params = useLocalSearchParams<{ emotion?: string; namesJson?: string }>();
  const rawEmotion = params.emotion;
  const emotionKey =
    typeof rawEmotion === 'string'
      ? rawEmotion
      : Array.isArray(rawEmotion)
        ? rawEmotion[0]
        : '';
  const names = useMemo(() => parseNamesParam(params.namesJson), [params.namesJson]);

  return <AyahExperience source={{ mode: 'emotion', emotionKey, names }} />;
}
