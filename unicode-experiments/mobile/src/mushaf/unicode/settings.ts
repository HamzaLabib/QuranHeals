import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Unicode Mushaf prototype's own two settings (development builds only), kept on this device and never synced:
 * no account, preference sync or backend reads them (preference sync uses explicit keys only).
 *  - Renderer: QCF V1 (the production reader, the default) or the Unicode prototype.
 *  - Tajweed Colors · ألوان التجويد: OFF by default.
 * Neither touches the production Settings screen. Once approved, Tajweed Colors would move to Settings → Quran.
 */
export const UNICODE_RENDERER_STORAGE_KEY = 'quran-heals:dev-unicode-mushaf:renderer:v1';
export const UNICODE_TAJWEED_STORAGE_KEY = 'quran-heals:dev-unicode-mushaf:tajweed:v1';
export const UNICODE_FONT_STORAGE_KEY = 'quran-heals:dev-unicode-mushaf:font:v1';

export const DEFAULT_TAJWEED_COLORS = false;

/** `font`: which rendering (data.ts UnicodeFontId); candidate C2, QH Old Madina fitted naturally, by default. */
export type UnicodeFontChoice = 'hafs' | 'hafsPlus' | 'madina' | 'madinaCalligraphic' | 'madinaNatural' | 'amiri';
export type UnicodePrototypeSettings = { unicode: boolean; tajweed: boolean; font: UnicodeFontChoice };
const FONT_CHOICES: readonly UnicodeFontChoice[] = ['hafs', 'hafsPlus', 'madina', 'madinaCalligraphic', 'madinaNatural', 'amiri'];
export const DEFAULT_PROTOTYPE_SETTINGS: UnicodePrototypeSettings = { unicode: false, tajweed: DEFAULT_TAJWEED_COLORS, font: 'madinaNatural' };

/** Only the exact stored words count; anything else is the default (QCF V1, Tajweed OFF, candidate C2). */
export function parsePrototypeSettings(renderer: string | null, tajweed: string | null, font: string | null = null): UnicodePrototypeSettings {
  return { unicode: renderer === 'unicode', tajweed: tajweed === 'on', font: FONT_CHOICES.includes(font as UnicodeFontChoice) ? (font as UnicodeFontChoice) : DEFAULT_PROTOTYPE_SETTINGS.font };
}

/** Never throws: an unreadable store means the defaults. */
export async function loadPrototypeSettings(): Promise<UnicodePrototypeSettings> {
  try {
    const [renderer, tajweed, font] = await Promise.all([UNICODE_RENDERER_STORAGE_KEY, UNICODE_TAJWEED_STORAGE_KEY, UNICODE_FONT_STORAGE_KEY].map((key) => AsyncStorage.getItem(key)));
    return parsePrototypeSettings(renderer, tajweed, font);
  } catch {
    return DEFAULT_PROTOTYPE_SETTINGS;
  }
}

export async function savePrototypeSettings(settings: UnicodePrototypeSettings): Promise<void> {
  try {
    await Promise.all([
      AsyncStorage.setItem(UNICODE_RENDERER_STORAGE_KEY, settings.unicode ? 'unicode' : 'qcf-v1'),
      AsyncStorage.setItem(UNICODE_TAJWEED_STORAGE_KEY, settings.tajweed ? 'on' : 'off'),
      AsyncStorage.setItem(UNICODE_FONT_STORAGE_KEY, settings.font),
    ]);
  } catch {
    // Non-fatal: the choice still applies this session.
  }
}

/** The labels, in both languages the setting must show. */
export const TAJWEED_COLORS_LABEL = { en: 'Tajweed Colors', ar: 'ألوان التجويد', on: { en: 'On', ar: 'تشغيل' }, off: { en: 'Off', ar: 'إيقاف' } } as const;
