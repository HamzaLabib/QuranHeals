/**
 * Public Privacy Policy, Terms of Use and account-deletion pages (D3).
 * Configured per build through EAS environment variables; the drafts live in
 * docs/legal/ and must be reviewed and hosted before these are set (see
 * docs/legal/README.md). A link that is unset or not a plain https:// URL is
 * left out, so Settings never opens a page that leads nowhere (its row is
 * shown disabled instead).
 * app.config.ts additionally fails an EAS build whose configured URL is
 * invalid, and requires all three for the production profile.
 */
export type LegalLinkKey = 'privacyPolicy' | 'termsOfUse' | 'accountDeletionInfo';

/** Display order of the Legal & Privacy rows. */
export const LEGAL_LINK_KEYS: readonly LegalLinkKey[] = ['privacyPolicy', 'termsOfUse', 'accountDeletionInfo'];

// Plain https URL with a dotted host; no credentials, no whitespace. Kept to a
// regex because React Native's URL implementation is incomplete.
const PUBLIC_HTTPS_URL = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d+)?([/?#][^\s]*)?$/;

export function sanitizeLegalUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value && PUBLIC_HTTPS_URL.test(value) ? value : null;
}

/** In display order. `env` exists for tests; the default reads the build-time values. */
export function getLegalLinks(
  env: Partial<Record<LegalLinkKey, string | undefined>> = {
    // Must be literal process.env.EXPO_PUBLIC_* reads so Expo inlines them at build time.
    privacyPolicy: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
    termsOfUse: process.env.EXPO_PUBLIC_TERMS_URL,
    accountDeletionInfo: process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL,
  },
): { key: LegalLinkKey; url: string }[] {
  return LEGAL_LINK_KEYS.flatMap((key) => {
    const url = sanitizeLegalUrl(env[key]);
    return url ? [{ key, url }] : [];
  });
}
