import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Quran Arabic and the app interface language are separate concerns — see
 * docs/localization/quran-translation-architecture.md. This module only
 * covers the OTHER, independent axis: which verified Quran translation is
 * shown, and how. The Arabic Quran itself is never affected by anything
 * here; it always comes from `quran.sqlite` and is always shown.
 */

/** The only verified translation this app currently bundles. Matches translations.sqlite's translation_sources.id exactly. */
export const PICKTHALL_TRANSLATION_ID = 'en.pickthall.gutenberg16955';

export type TranslationDisplayMode = 'always' | 'on-demand' | 'off';

export type QuranTranslationPreference = {
  translationId: string;
  displayMode: TranslationDisplayMode;
};

/**
 * Preserves current app behavior: the ayah screen has always shown the
 * English Pickthall translation automatically alongside the Arabic — so the
 * default display mode is "always", not "on-demand" or "off". A future
 * verified translation would be added by extending `translationId`'s valid
 * values here (and the backend's translations.sqlite schema) — never by
 * changing this display-mode architecture.
 */
export const DEFAULT_QURAN_TRANSLATION_PREFERENCE: QuranTranslationPreference = {
  translationId: PICKTHALL_TRANSLATION_ID,
  displayMode: 'always',
};

const STORAGE_KEY = 'quran-heals:quran-translation-preference:v1';

const VALID_DISPLAY_MODES: readonly TranslationDisplayMode[] = ['always', 'on-demand', 'off'];

function isValidDisplayMode(value: unknown): value is TranslationDisplayMode {
  return typeof value === 'string' && (VALID_DISPLAY_MODES as readonly string[]).includes(value);
}

/** Validates and safely migrates/falls back an arbitrary stored payload — never throws, never returns a malformed preference. */
export function parseQuranTranslationPreference(raw: unknown): QuranTranslationPreference {
  if (raw && typeof raw === 'object') {
    const candidate = raw as Partial<QuranTranslationPreference>;
    const translationId = typeof candidate.translationId === 'string' && candidate.translationId.trim().length > 0
      ? candidate.translationId
      : DEFAULT_QURAN_TRANSLATION_PREFERENCE.translationId;
    const displayMode = isValidDisplayMode(candidate.displayMode)
      ? candidate.displayMode
      : DEFAULT_QURAN_TRANSLATION_PREFERENCE.displayMode;
    return { translationId, displayMode };
  }
  return DEFAULT_QURAN_TRANSLATION_PREFERENCE;
}

export async function loadQuranTranslationPreference(): Promise<QuranTranslationPreference> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_QURAN_TRANSLATION_PREFERENCE;
    return parseQuranTranslationPreference(JSON.parse(raw));
  } catch {
    return DEFAULT_QURAN_TRANSLATION_PREFERENCE;
  }
}

export async function saveQuranTranslationPreference(preference: QuranTranslationPreference): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Persistence failure is non-fatal: the in-memory selection still applies this session.
  }
}
