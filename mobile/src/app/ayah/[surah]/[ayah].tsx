import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { AyahExperience } from '@/components/AyahExperience';
import { parseAyahLinkParams } from '@/utils/ayahLink';

/**
 * A shared ayah link, `https://<link host>/ayah/<surah>/<ayah>` (or the
 * app's own `quranheals://ayah/<surah>/<ayah>`), opened by iOS Universal
 * Links / Android App Links or the link page's "Open in Quran Heals"
 * button. Expo Router maps the URL's path straight to this route, on a cold
 * start or with the app already open.
 *
 * Not a separate screen: the same AyahExperience as every other flow, with
 * its usual Share | Add Reflection | Favorite actions. Nothing opens
 * automatically and no sign-in is needed. The reference is validated
 * against the real ayah counts before anything loads; any query string a
 * social app appends (fbclid, …) is ignored.
 */
export default function LinkedAyahScreen() {
  const params = useLocalSearchParams<{ surah?: string; ayah?: string }>();
  const verseKey = parseAyahLinkParams(params.surah, params.ayah);
  const source = useMemo(() => ({ mode: 'verse' as const, verseKey }), [verseKey]);

  return <AyahExperience source={source} />;
}
