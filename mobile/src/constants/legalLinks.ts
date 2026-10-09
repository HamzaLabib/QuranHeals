import type { AppLocale } from '@/localization/locales';

/**
 * Public legal website (GitHub Pages, repository quranheals/legal): Privacy
 * Policy, Terms of Service and account-deletion information, in English,
 * Canadian French and Arabic. Settings opens the page in the app's current
 * language, outside the app.
 *
 * Every page path below was confirmed live (HTTP 200) on 2026-10-09; the
 * trailing slashes match the site's canonical URLs (without one, GitHub
 * Pages answers with a redirect). If the site moves, change
 * LEGAL_SITE_BASE_URL here and in the site's own hreflang links.
 */
export const LEGAL_SITE_BASE_URL = 'https://quranheals.github.io/legal/';

export type LegalLinkKey = 'privacyPolicy' | 'termsOfUse' | 'accountDeletionInfo';

/** Display order of the Legal & Privacy rows. */
export const LEGAL_LINK_KEYS: readonly LegalLinkKey[] = ['privacyPolicy', 'termsOfUse', 'accountDeletionInfo'];

const PAGE_PATHS: Record<LegalLinkKey, string> = {
  privacyPolicy: 'privacy/',
  termsOfUse: 'terms/',
  accountDeletionInfo: 'delete-account/',
};

// The site's language folders. There is no French app UI, so the French pages
// (fr/) are reached through the site's own language switcher.
const LANGUAGE_PATHS: Record<AppLocale, string> = {
  en: '',
  ar: 'ar/',
  'ar-EG': 'ar/',
};

export function getLegalUrl(key: LegalLinkKey, locale: AppLocale): string {
  return `${LEGAL_SITE_BASE_URL}${LANGUAGE_PATHS[locale]}${PAGE_PATHS[key]}`;
}

/** In display order, for the given app language. */
export function getLegalLinks(locale: AppLocale): { key: LegalLinkKey; url: string }[] {
  return LEGAL_LINK_KEYS.map((key) => ({ key, url: getLegalUrl(key, locale) }));
}
