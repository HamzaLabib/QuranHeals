/**
 * Web (and the Node test environment): the browser's preferred languages.
 * Native builds use deviceLocale.native.ts (expo-localization). Outside a real
 * browser (tests) there is no device: nothing is reported, so the app keeps its
 * English default unless a test supplies a device language.
 */
export function getDeviceLanguageTags(): string[] {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof navigator === 'undefined') return [];
  const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language];
  return languages.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
}

export function deviceUses24HourClock(): boolean | null {
  return null;
}
