import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { getLegalLinks, getLegalUrl, LEGAL_LINK_KEYS, LEGAL_SITE_BASE_URL } from '@/constants/legalLinks';
import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * Privacy Policy, Terms of Service and account-deletion information, on the
 * public legal website. Settings opens them in the app's language, outside
 * the app, whether or not anyone is signed in.
 */

describe('legal page URLs', () => {
  it('uses the published legal website', () => {
    expect(LEGAL_SITE_BASE_URL).toBe('https://quranheals.github.io/legal/');
  });

  it('English: the confirmed English pages, in display order', () => {
    expect(getLegalLinks('en')).toEqual([
      { key: 'privacyPolicy', url: 'https://quranheals.github.io/legal/privacy/' },
      { key: 'termsOfUse', url: 'https://quranheals.github.io/legal/terms/' },
      { key: 'accountDeletionInfo', url: 'https://quranheals.github.io/legal/delete-account/' },
    ]);
  });

  it.each(['ar', 'ar-EG'] as const)('%s: the confirmed Arabic pages', (locale) => {
    expect(getLegalLinks(locale)).toEqual([
      { key: 'privacyPolicy', url: 'https://quranheals.github.io/legal/ar/privacy/' },
      { key: 'termsOfUse', url: 'https://quranheals.github.io/legal/ar/terms/' },
      { key: 'accountDeletionInfo', url: 'https://quranheals.github.io/legal/ar/delete-account/' },
    ]);
  });

  it('every URL is https on the legal site and ends in a slash (the canonical form, no redirect)', () => {
    for (const locale of APP_LOCALES) {
      for (const key of LEGAL_LINK_KEYS) {
        const url = getLegalUrl(key, locale);
        expect(url.startsWith(LEGAL_SITE_BASE_URL)).toBe(true);
        expect(url.endsWith('/')).toBe(true);
        expect(url).not.toMatch(/\s|\/\/.*\/\//);
      }
    }
  });

  // Ties the paths to the legal website's own files, when its repository is
  // checked out next to this one: a renamed or missing page fails here.
  const site = resolve(__dirname, '../../../quranhealslegal');
  it.skipIf(!existsSync(site))('every linked page exists in the legal website source, in English and Arabic', () => {
    for (const locale of APP_LOCALES) {
      for (const key of LEGAL_LINK_KEYS) {
        const page = getLegalUrl(key, locale).slice(LEGAL_SITE_BASE_URL.length);
        const file = resolve(site, page, 'index.html');
        expect(existsSync(file), file).toBe(true);
        const html = readFileSync(file, 'utf-8');
        expect(html).toMatch(locale === 'en' ? /<html lang="en" dir="ltr">/ : /<html lang="ar" dir="rtl">/);
      }
    }
  });
});

describe('Settings integration', () => {
  const source = readFileSync(resolve(__dirname, '../src/app/settings.tsx'), 'utf-8');

  it('builds the rows from the app language and opens each page outside the app, without crashing on failure', () => {
    expect(source).toMatch(/getLegalLinks\(locale\)\.map\(\(\{ key, url \}\) =>/);
    expect(source).toMatch(/label=\{messages\.settings\[key\]\}/);
    expect(source).toMatch(/Linking\.openURL\(url\)\.catch\(/);
    expect(source).toMatch(/accessibilityRole="link"/);
  });

  it('the Legal section is outside the Account section, so it never depends on signing in', () => {
    const legal = source.indexOf('title={messages.settings.legalSection}');
    const account = source.indexOf('<AccountSection');
    expect(legal).toBeGreaterThan(0);
    expect(account).toBeGreaterThan(legal);
    expect(source.slice(legal, account)).not.toMatch(/\bstatus\b|useAuth\(|isSignedIn/);
  });

  it('mirrors link rows for RTL like the other rows', () => {
    expect(source).toMatch(/function LinkRow[\s\S]*?isRtl && styles\.optionRowRtl/);
  });

  it('keeps the existing in-app account deletion in the Account section untouched', () => {
    expect(source).toMatch(/<AccountSection locale=\{locale\} messages=\{messages\} direction=\{direction\} isRtl=\{isRtl\} \/>/);
  });

  it('no build-time legal URL variables remain', () => {
    const config = readFileSync(resolve(__dirname, '../app.config.ts'), 'utf-8');
    expect(config).not.toMatch(/EXPO_PUBLIC_(PRIVACY_POLICY|TERMS|ACCOUNT_DELETION)_URL|assertLegalUrlsForBuild/);
  });
});

describe('localized labels', () => {
  it.each(['en', 'ar', 'ar-EG'] as const)('every legal label is present and non-empty in %s', (locale) => {
    const settings = MESSAGES[locale].settings;
    for (const key of ['legalSection', 'privacyPolicy', 'termsOfUse', 'accountDeletionInfo', 'opensInBrowser'] as const) {
      expect(settings[key].trim().length, key).toBeGreaterThan(0);
    }
  });

  it('the labels match the titles on the legal website', () => {
    expect(MESSAGES.en.settings).toMatchObject({ privacyPolicy: 'Privacy Policy', termsOfUse: 'Terms of Service', accountDeletionInfo: 'Account & Data Deletion' });
    expect(MESSAGES.ar.settings).toMatchObject({ privacyPolicy: 'سياسة الخصوصية', termsOfUse: 'شروط الخدمة', accountDeletionInfo: 'حذف الحساب والبيانات' });
  });

  it('both Arabic locales share the Arabic labels', () => {
    for (const key of ['legalSection', 'privacyPolicy', 'termsOfUse', 'accountDeletionInfo', 'opensInBrowser'] as const) {
      expect(MESSAGES['ar-EG'].settings[key]).toBe(MESSAGES.ar.settings[key]);
      expect(MESSAGES.ar.settings[key]).toMatch(/[؀-ۿ]/);
    }
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
