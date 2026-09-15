/**
 * The three app interface locales Quran Heals v1 supports. Mirrors
 * backend/src/emotions/emotionCatalog.ts's `AppLocale` exactly (kept as an
 * independent copy rather than a cross-package import, since mobile and
 * backend are separate npm packages with separate module resolution).
 *
 * Adding a future locale (`fr`, `es`, `tr`, `ur`, `id`, `fr-CA`, ...) means
 * adding one entry to `APP_LOCALES`/`APP_LOCALE_DISPLAY_NAMES` and one
 * dictionary in `messages.ts` — never a change to emotion keys, Quran
 * mappings, or routing.
 */
export type AppLocale = 'en' | 'ar' | 'ar-EG';

export const APP_LOCALES: readonly AppLocale[] = ['en', 'ar', 'ar-EG'];

/** Preserves current app behavior: the app has always started in English. */
export const DEFAULT_APP_LOCALE: AppLocale = 'en';

export const RTL_LOCALES: readonly AppLocale[] = ['ar', 'ar-EG'];

export function isRtlLocale(locale: AppLocale): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

export type TextDirection = 'ltr' | 'rtl';

export function getTextDirection(locale: AppLocale): TextDirection {
  return isRtlLocale(locale) ? 'rtl' : 'ltr';
}

/** Component-level alignment/direction helpers — never requires an app restart, unlike RN's global `I18nManager.forceRTL`. */
export function getDirectionStyle(locale: AppLocale): { writingDirection: TextDirection; textAlign: 'left' | 'right' } {
  const rtl = isRtlLocale(locale);
  return { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' };
}

/** Each locale's own name for itself — used only in the language picker (Settings), never machine-translated. */
export const APP_LOCALE_DISPLAY_NAMES: Record<AppLocale, string> = {
  en: 'English',
  ar: 'العربية',
  'ar-EG': 'العربية المصرية',
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (APP_LOCALES as readonly string[]).includes(value);
}
