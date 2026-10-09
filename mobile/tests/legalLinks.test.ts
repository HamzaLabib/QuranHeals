import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertLegalUrlsForBuild, checkLegalPageUrl, LEGAL_URL_ENVS } from '../app.config';
import { getLegalLinks, sanitizeLegalUrl } from '@/constants/legalLinks';
import { MESSAGES } from '@/localization/messages';

/**
 * D3: Privacy Policy, Terms of Use and account-deletion information. The
 * reviewed pages are hosted outside the app; Settings links to them only when
 * a valid URL is configured for the build, so no build ever shows a link that
 * leads nowhere, and production builds cannot ship without them.
 */

const VALID = {
  privacyPolicy: 'https://quranheals.example.org/privacy',
  termsOfUse: 'https://quranheals.example.org/terms',
  accountDeletionInfo: 'https://quranheals.example.org/delete-account',
};

describe('runtime legal links', () => {
  it('returns configured links in display order', () => {
    expect(getLegalLinks(VALID)).toEqual([
      { key: 'privacyPolicy', url: VALID.privacyPolicy },
      { key: 'termsOfUse', url: VALID.termsOfUse },
      { key: 'accountDeletionInfo', url: VALID.accountDeletionInfo },
    ]);
  });

  it('leaves out unset links, so no placeholder row appears', () => {
    expect(getLegalLinks({})).toEqual([]);
    expect(getLegalLinks({ privacyPolicy: VALID.privacyPolicy, termsOfUse: '  ' })).toEqual([{ key: 'privacyPolicy', url: VALID.privacyPolicy }]);
  });

  it.each([
    'http://quranheals.example.org/privacy',
    'https://localhost/privacy',
    'https://user:pass@quranheals.example.org/privacy',
    'javascript:alert(1)',
    'quranheals.example.org/privacy',
    'https://quranheals.example.org/pri vacy',
    'TODO',
  ])('rejects %s', (url) => {
    expect(sanitizeLegalUrl(url)).toBeNull();
  });

  it('trims surrounding whitespace from a valid URL', () => {
    expect(sanitizeLegalUrl(`  ${VALID.privacyPolicy}\n`)).toBe(VALID.privacyPolicy);
  });
});

describe('EAS build guard', () => {
  const env = (profile: string, values: Partial<Record<(typeof LEGAL_URL_ENVS)[number], string>> = {}) => ({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile, ...values });
  const all = {
    EXPO_PUBLIC_PRIVACY_POLICY_URL: VALID.privacyPolicy,
    EXPO_PUBLIC_TERMS_URL: VALID.termsOfUse,
    EXPO_PUBLIC_ACCOUNT_DELETION_URL: VALID.accountDeletionInfo,
  };

  it('requires all three URLs for the production profile', () => {
    expect(() => assertLegalUrlsForBuild(env('production'))).toThrow(/EXPO_PUBLIC_PRIVACY_POLICY_URL is not set/);
    expect(() => assertLegalUrlsForBuild(env('production', { ...all, EXPO_PUBLIC_TERMS_URL: '' }))).toThrow(/EXPO_PUBLIC_TERMS_URL is not set/);
    expect(() => assertLegalUrlsForBuild(env('production', all))).not.toThrow();
  });

  it('lets preview and development builds leave them unset (the rows are hidden)', () => {
    expect(() => assertLegalUrlsForBuild(env('preview'))).not.toThrow();
    expect(() => assertLegalUrlsForBuild(env('development'))).not.toThrow();
  });

  it('fails any build whose configured URL is unsafe', () => {
    expect(() => assertLegalUrlsForBuild(env('preview', { EXPO_PUBLIC_PRIVACY_POLICY_URL: 'http://quranheals.example.org/privacy' }))).toThrow(/https/);
    expect(() => assertLegalUrlsForBuild(env('preview', { EXPO_PUBLIC_TERMS_URL: 'https://192.168.1.10/terms' }))).toThrow(/public web address/);
  });

  it('never runs outside the EAS build worker', () => {
    expect(() => assertLegalUrlsForBuild({ EAS_BUILD_PROFILE: 'production' })).not.toThrow();
  });

  it('accepts a public https page', () => {
    expect(checkLegalPageUrl('X', VALID.accountDeletionInfo)).toEqual({ ok: true, url: VALID.accountDeletionInfo });
  });
});

describe('Settings integration', () => {
  const source = readFileSync(resolve(__dirname, '../src/app/settings.tsx'), 'utf-8');

  it('always lists all three rows, opening only URLs that passed getLegalLinks validation', () => {
    expect(source).toMatch(/const LEGAL_LINKS = getLegalLinks\(\);/);
    expect(source).toMatch(/LEGAL_LINK_KEYS\.map\(\(key\) =>/);
    expect(source).toMatch(/const url = LEGAL_URLS\[key\];/);
    // A row without a configured URL gets no onPress, so it is disabled and opens nothing.
    expect(source).toMatch(/onPress=\{\s*url\s*\?[\s\S]*?: undefined\s*\}/);
  });

  it('labels rows from localized messages and opens the configured URL outside the app, without crashing on failure', () => {
    expect(source).toMatch(/messages\.settings\.legalSection/);
    expect(source).toMatch(/label=\{messages\.settings\[key\]\}/);
    expect(source).toMatch(/Linking\.openURL\(url\)\.catch\(/);
    expect(source).toMatch(/accessibilityRole="link"/);
  });

  it('mirrors link rows for RTL like the other rows', () => {
    expect(source).toMatch(/function LinkRow[\s\S]*?isRtl && styles\.optionRowRtl/);
  });

  it('keeps the existing in-app account deletion in the Account section untouched', () => {
    expect(source).toMatch(/<AccountSection locale=\{locale\} messages=\{messages\} direction=\{direction\} isRtl=\{isRtl\} \/>/);
  });
});

describe('localized labels', () => {
  it.each(['en', 'ar', 'ar-EG'] as const)('every legal label is present and non-empty in %s', (locale) => {
    const settings = MESSAGES[locale].settings;
    for (const key of ['legalSection', 'privacyPolicy', 'termsOfUse', 'accountDeletionInfo', 'opensInBrowser', 'legalUnavailable'] as const) {
      expect(settings[key].trim().length, key).toBeGreaterThan(0);
    }
  });

  it('the Arabic labels are Arabic and shared by both Arabic locales', () => {
    expect(MESSAGES.ar.settings.privacyPolicy).toBe('سياسة الخصوصية');
    expect(MESSAGES['ar-EG'].settings.privacyPolicy).toBe(MESSAGES.ar.settings.privacyPolicy);
    expect(MESSAGES.ar.settings.termsOfUse).toMatch(/[؀-ۿ]/);
  });
});

describe('legal drafts', () => {
  const doc = (name: string) => readFileSync(resolve(__dirname, '../../docs/legal', name), 'utf-8');
  const drafts = ['privacy-policy.en.md', 'privacy-policy.ar.md', 'terms-of-use.en.md', 'terms-of-use.ar.md', 'account-deletion.en.md', 'account-deletion.ar.md'];

  it.each(drafts)('%s is clearly marked as an unapproved draft', (name) => {
    expect(doc(name).split('\n')[0]).toMatch(/DRAFT|مسودة/);
  });

  it('the privacy policy never claims all data is end-to-end encrypted, and says what is not', () => {
    const policy = doc('privacy-policy.en.md');
    expect(policy).not.toMatch(/all (of )?your (data|information) is (end-to-end )?encrypted/i);
    expect(policy).toMatch(/Not everything is end-to-end encrypted/);
    expect(policy).toMatch(/End-to-end encryption covers \*\*reflection text only\*\*/);
  });

  it('the deletion instructions match the in-app path and confirmation word', () => {
    const en = MESSAGES.en;
    expect(doc('account-deletion.en.md')).toContain(`Settings → ${en.account.sectionTitle} → ${en.account.dangerZoneTitle} → ${en.account.deleteAccountAction}`);
    expect(doc('account-deletion.en.md')).toContain(`**${en.deleteAccount.confirmationWord}**`);
    const ar = MESSAGES.ar;
    expect(doc('account-deletion.ar.md')).toContain(`الإعدادات ← ${ar.account.sectionTitle} ← ${ar.account.dangerZoneTitle} ← ${ar.account.deleteAccountAction}`);
    expect(doc('account-deletion.ar.md')).toContain(`**${ar.deleteAccount.confirmationWord}**`);
  });
});
