/**
 * The three content locales Quran Heals has text for (messages.ts, the
 * emotion catalog). Only English and Arabic are App Languages (the
 * interface, APP_LANGUAGES below); Egyptian Arabic is offered for emotion
 * content only (Emotions Language, emotionsLanguage.ts).
 *
 * The locales: Mirrors
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

/** The App Language (لغة التطبيق): the whole interface. Exactly English and Arabic. */
export type AppLanguage = 'en' | 'ar';
export const APP_LANGUAGES: readonly AppLanguage[] = ['en', 'ar'];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'en' || value === 'ar';
}

/** The App Language for a device whose language is not Arabic (and before the stored choice has loaded). */
export const DEFAULT_APP_LOCALE: AppLanguage = 'en';

/**
 * The App Language on a fresh install (nothing saved yet), from the device's
 * preferred languages, most preferred first: Modern Standard Arabic when the
 * first one is Arabic in any region (ar, ar-EG, ar-SA, ar-CA, …), English for
 * everything else (English, French, any language the app has no interface
 * for). Never Egyptian Arabic: that is an Emotions Language only. Only the
 * first preference counts, so a French speaker who also lists Arabic gets
 * English, as the device's own first choice suggests. Not saved: once the
 * user picks a language in Settings that choice is stored and wins for good.
 */
export function resolveInitialAppLanguage(deviceLanguageTags: readonly string[]): AppLanguage {
  const first = deviceLanguageTags.find((tag) => typeof tag === 'string' && tag.trim().length > 0);
  if (!first) return DEFAULT_APP_LOCALE;
  const language = first.trim().toLowerCase().split(/[-_]/)[0];
  return language === 'ar' ? 'ar' : 'en';
}

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
