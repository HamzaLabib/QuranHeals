import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_LOCALES, APP_LOCALE_DISPLAY_NAMES, DEFAULT_APP_LOCALE, getDirectionStyle, isAppLocale, isRtlLocale } from '@/localization/locales';
import { MESSAGES, getMessages } from '@/localization/messages';

const asyncStorageState = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => asyncStorageState.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      asyncStorageState.set(key, value);
    }),
  },
}));

describe('AppLocale values and RTL/LTR direction', () => {
  it('supports exactly the three approved app locales, defaulting to English', () => {
    expect(APP_LOCALES).toEqual(['en', 'ar', 'ar-EG']);
    expect(DEFAULT_APP_LOCALE).toBe('en');
  });

  it('classifies ar and ar-EG as RTL, and en as LTR', () => {
    expect(isRtlLocale('en')).toBe(false);
    expect(isRtlLocale('ar')).toBe(true);
    expect(isRtlLocale('ar-EG')).toBe(true);
  });

  it('produces a matching writingDirection/textAlign pair per locale, without requiring a global RTL app restart', () => {
    expect(getDirectionStyle('en')).toEqual({ writingDirection: 'ltr', textAlign: 'left' });
    expect(getDirectionStyle('ar')).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(getDirectionStyle('ar-EG')).toEqual({ writingDirection: 'rtl', textAlign: 'right' });
  });

  it('validates candidate locale values safely, rejecting anything outside the approved set', () => {
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('ar')).toBe(true);
    expect(isAppLocale('ar-EG')).toBe(true);
    expect(isAppLocale('fr')).toBe(false);
    expect(isAppLocale('AR')).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(isAppLocale(null)).toBe(false);
    expect(isAppLocale(42)).toBe(false);
  });

  it('exposes each locale`s own self-name for the settings picker, never machine-translated', () => {
    expect(APP_LOCALE_DISPLAY_NAMES).toEqual({
      en: 'English',
      ar: 'العربية',
      'ar-EG': 'العربية المصرية',
    });
  });
});

describe('Interface message dictionary (messages.ts)', () => {
  const sectionKeySets = (locale: keyof typeof MESSAGES) => {
    const messages = MESSAGES[locale];
    const result: Record<string, string[]> = {};
    for (const [section, value] of Object.entries(messages)) {
      if (value && typeof value === 'object') {
        result[section] = Object.keys(value).sort();
      }
    }
    return result;
  };

  it('defines every message key for all three locales — no locale is missing a string the others have', () => {
    const en = sectionKeySets('en');
    const ar = sectionKeySets('ar');
    const arEG = sectionKeySets('ar-EG');
    expect(ar).toEqual(en);
    expect(arEG).toEqual(en);
  });

  it('every message string in every locale is non-empty', () => {
    for (const locale of APP_LOCALES) {
      const messages = MESSAGES[locale];
      for (const [section, value] of Object.entries(messages)) {
        if (typeof value === 'string') {
          expect(value.trim().length, `${locale}.${section} is empty`).toBeGreaterThan(0);
          continue;
        }
        for (const [key, str] of Object.entries(value as Record<string, string>)) {
          expect(str.trim().length, `${locale}.${section}.${key} is empty`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('getMessages returns the matching dictionary for each locale, and safely falls back to English for an unknown one', () => {
    expect(getMessages('en')).toBe(MESSAGES.en);
    expect(getMessages('ar')).toBe(MESSAGES.ar);
    expect(getMessages('ar-EG')).toBe(MESSAGES['ar-EG']);
    // @ts-expect-error deliberately passing an unsupported locale to prove the safe fallback
    expect(getMessages('fr')).toBe(MESSAGES.en);
  });

  it('the on-demand "Show translation" / "Hide translation" toggle uses the exact approved wording per locale', () => {
    expect(MESSAGES.en.translation.showTranslation).toBe('Show translation');
    expect(MESSAGES.en.translation.hideTranslation).toBe('Hide translation');
    expect(MESSAGES.ar.translation.showTranslation).toBe('إظهار الترجمة');
    expect(MESSAGES.ar.translation.hideTranslation).toBe('إخفاء الترجمة');
    // ar-EG: showTranslation keeps the project's existing natural-Egyptian
    // phrasing (same meaning, distinct verb from ar); hideTranslation now
    // matches ar exactly, per the approved wording.
    expect(MESSAGES['ar-EG'].translation.showTranslation).toBe('عرض الترجمة');
    expect(MESSAGES['ar-EG'].translation.hideTranslation).toBe('إخفاء الترجمة');
  });

  it('the home heading uses the exact approved wording per locale', () => {
    expect(MESSAGES.en.home.title).toBe('How are you feeling?');
    expect(MESSAGES.ar.home.title).toBe('بماذا تشعر الآن؟');
    expect(MESSAGES['ar-EG'].home.title).toBe('إيه إحساسك دلوقتي؟');
  });

  it('the Egyptian Arabic home subtitle uses the exact approved wording', () => {
    expect(MESSAGES['ar-EG'].home.subtitle).toBe('رسالة من القرآن لكل إحساس بتحسه');
  });

  it('general Arabic UI copy (eyebrow, disclaimer, kicker) uses Standard Arabic in both ar and ar-EG, unlike the Egyptian home heading/subtitle', () => {
    expect(MESSAGES.ar.home.eyebrow).toBe('تأمّل مع آية');
    expect(MESSAGES['ar-EG'].home.eyebrow).toBe('تأمّل مع آية');

    expect(MESSAGES.ar.home.disclaimer).toBe(
      'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
    );
    expect(MESSAGES['ar-EG'].home.disclaimer).toBe(
      'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
    );

    expect(MESSAGES.ar.ayah.kicker).toBe('آية مختارة لهذه اللحظة');
    expect(MESSAGES['ar-EG'].ayah.kicker).toBe('آية مختارة لهذه اللحظة');
  });

  it('ar-EG general UI copy (another ayah, remove, favorites notice, translation settings) uses Standard Arabic, not Egyptian colloquial wording', () => {
    expect(MESSAGES['ar-EG'].ayah.anotherAyah).toBe('آية أخرى');
    expect(MESSAGES['ar-EG'].ayah.loadAnotherAyah).toBe('تحميل آية أخرى');

    expect(MESSAGES['ar-EG'].favorites.remove).toBe('إزالة');
    expect(MESSAGES['ar-EG'].favorites.removeSaved).toBe('إزالة الآية المحفوظة');
    expect(MESSAGES['ar-EG'].favoriteButton.removeLabel).toBe('إزالة الآية من المفضّلة');

    expect(MESSAGES['ar-EG'].favorites.subtitle).toBe('المفضّلة محفوظة على هذا الجهاز.');

    expect(MESSAGES['ar-EG'].settings.quranTranslationSection).toBe('ترجمة القرآن');
    expect(MESSAGES['ar-EG'].settings.translationDisplayAlways).toBe('دائمًا');
    expect(MESSAGES['ar-EG'].settings.translationDisplayAlwaysHint).toBe(
      'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
    );
    expect(MESSAGES['ar-EG'].settings.translationDisplayOnDemand).toBe('عند الطلب');
    expect(MESSAGES['ar-EG'].settings.translationDisplayOnDemandHint).toBe(
      'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
    );
    expect(MESSAGES['ar-EG'].settings.translationDisplayOff).toBe('إيقاف');
    expect(MESSAGES['ar-EG'].settings.translationDisplayOffHint).toBe('النص العربي فقط. لن تظهر الترجمة.');
    expect(MESSAGES['ar-EG'].settings.quranArabicNote).toBe(
      'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
    );
  });

  it('auth/account/reflection/sync-passphrase/issue-report/sync-status copy uses the exact approved wording for en and ar', () => {
    expect(MESSAGES.en.auth.syncPrompt).toBe('Sign in to sync across devices');
    expect(MESSAGES.ar.auth.syncPrompt).toBe('سجّل الدخول لتجد محتواك المحفوظ على أجهزتك الأخرى');
    expect(MESSAGES.en.auth.signInFailed).toBe(
      "We couldn't sign you in. You can try again or continue without an account.",
    );
    expect(MESSAGES.ar.auth.signInFailed).toBe('تعذّر تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة دون حساب.');

    expect(MESSAGES.en.account).toMatchObject({
      sectionTitle: 'Account',
      notSignedIn: 'Not signed in',
      signInWithApple: 'Sign in with Apple',
      signInWithGoogle: 'Sign in with Google',
      signedIn: 'Signed in',
      signOut: 'Sign out',
    });
    expect(MESSAGES.ar.account).toMatchObject({
      sectionTitle: 'الحساب',
      notSignedIn: 'لم يتم تسجيل الدخول',
      signInWithApple: 'تسجيل الدخول باستخدام Apple',
      signInWithGoogle: 'تسجيل الدخول باستخدام Google',
      signedIn: 'تم تسجيل الدخول',
      signOut: 'تسجيل الخروج',
    });

    expect(MESSAGES.en.reflection).toMatchObject({
      action: 'Reflection',
      title: 'Reflections on this ayah',
      prompt: 'What feeling did this ayah leave you with?',
      placeholder: 'Write how this ayah touched your heart...',
      guestNote: 'Your reflections are saved on this device. Sign in to access them across your devices.',
      syncedNote: 'Your reflection is privately synced across your signed-in devices.',
      save: 'Save',
      cancel: 'Cancel',
    });
    expect(MESSAGES.ar.reflection).toMatchObject({
      action: 'خواطر',
      title: 'خواطر حول هذه الآية',
      prompt: 'ما الشعور الذي تركته هذه الآية في نفسك؟',
      placeholder: 'اكتب ما تركته هذه الآية في قلبك...',
      guestNote: 'تُحفظ خواطرك على هذا الجهاز. سجّل الدخول للوصول إليها عبر أجهزتك.',
      syncedNote: 'تتم مزامنة خواطرك بشكل خاص بين أجهزتك التي سجّلت الدخول عليها.',
      save: 'حفظ',
      cancel: 'إلغاء',
    });

    expect(MESSAGES.en.issueReport).toMatchObject({
      action: 'Report an issue',
      description: 'Tell us what seems wrong. Your report helps us improve Quran Heals.',
      categoryAyahNotRelevant: "Ayah doesn't feel relevant",
      categoryQuranTextDisplay: 'Quran text display issue',
      categoryTranslationIssue: 'Translation issue',
      categoryAppTechnicalIssue: 'App or technical issue',
      categoryOther: 'Other',
      emailLabel: 'Email for follow-up (optional)',
      successMessage: 'Thank you. Your report has been received.',
      failureMessage: "We couldn't send your report. Please try again.",
    });
    expect(MESSAGES.ar.issueReport).toMatchObject({
      action: 'الإبلاغ عن مشكلة',
      description: 'أخبرنا بالمشكلة التي لاحظتها. يساعدنا بلاغك على تحسين Quran Heals.',
      categoryAyahNotRelevant: 'الآية لا تبدو مرتبطة بالشعور',
      categoryQuranTextDisplay: 'مشكلة في عرض نص القرآن',
      categoryTranslationIssue: 'مشكلة في الترجمة',
      categoryAppTechnicalIssue: 'مشكلة تقنية في التطبيق',
      categoryOther: 'أخرى',
      emailLabel: 'البريد الإلكتروني للمتابعة (اختياري)',
      successMessage: 'شكرًا لك. تم استلام بلاغك.',
      failureMessage: 'تعذّر إرسال البلاغ. يُرجى المحاولة مرة أخرى.',
    });

    expect(MESSAGES.en.syncStatus).toEqual({
      savedOnDevice: 'Saved on device',
      syncing: 'Syncing',
      synced: 'Synced',
      syncFailed: 'Sync failed',
    });
    expect(MESSAGES.ar.syncStatus).toEqual({
      savedOnDevice: 'محفوظ على الجهاز',
      syncing: 'جارٍ المزامنة',
      synced: 'تمت المزامنة',
      syncFailed: 'تعذّرت المزامنة',
    });
  });

  it('uses the requested password wording and unrecoverability warning', () => {
    expect(MESSAGES.en.syncPassphrase).toMatchObject({
      createTitle: 'Set Password', unlockTitle: 'Enter Password',
      createDescription: 'Create a Password to protect and encrypt your private reflections when they sync across your devices. Quran Heals cannot recover your Password if you forget it, so choose something you can remember.',
      unlockDescription: 'Enter your Password to unlock your encrypted synced data on this device.',
      createPlaceholder: 'Password', unlockPlaceholder: 'Password', confirmPassword: 'Confirm Password',
      show: 'Show', hide: 'Hide', continueLabel: 'Continue',
      lengthHint: 'Use 8–32 characters.', allowedHint: 'Letters, numbers, and symbols are allowed.',
      mismatch: 'Passwords don’t match.', tooShort: 'Password must be at least 8 characters.', tooLong: 'Password cannot exceed 32 characters.',
      changeTitle: 'Change Password', currentPassword: 'Current Password', newPassword: 'New Password', confirmNewPassword: 'Confirm New Password',
      mustDiffer: 'New Password must be different from your current Password.', incorrectError: 'Current Password is incorrect.',
    });
    expect(MESSAGES.ar.syncPassphrase).toMatchObject({
      createTitle: 'إنشاء كلمة المرور', unlockTitle: 'أدخل كلمة المرور',
      createDescription: 'أنشئ كلمة مرور لحماية وتشفير خواطرك الخاصة عند مزامنتها بين أجهزتك. لا يمكن لتطبيق Quran Heals استعادة كلمة المرور إذا نسيتها، لذا اختر كلمة مرور يمكنك تذكرها.',
      unlockDescription: 'أدخل كلمة المرور لفتح بياناتك المشفّرة على هذا الجهاز.',
      createPlaceholder: 'كلمة المرور', confirmPassword: 'تأكيد كلمة المرور',
      show: 'إظهار', hide: 'إخفاء', continueLabel: 'متابعة',
      lengthHint: 'استخدم من 8 إلى 32 حرفًا.', allowedHint: 'يمكنك استخدام الحروف والأرقام والرموز.',
      mismatch: 'كلمتا المرور غير متطابقتين.', tooShort: 'يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.', tooLong: 'لا يمكن أن تتجاوز كلمة المرور 32 حرفًا.',
      changeTitle: 'تغيير كلمة المرور', currentPassword: 'كلمة المرور الحالية', newPassword: 'كلمة المرور الجديدة', confirmNewPassword: 'تأكيد كلمة المرور الجديدة',
      mustDiffer: 'يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.', incorrectError: 'كلمة المرور الحالية غير صحيحة.',
    });
  });

  it('the Sync Password flow no longer has a distinct "cancel" string — it reuses account.signOut instead', () => {
    for (const locale of APP_LOCALES) {
      expect(MESSAGES[locale].syncPassphrase).not.toHaveProperty('cancel');
    }
  });

  it('ar-EG matches ar exactly for the mandatory Sync Password copy — never Egyptian colloquial for this security flow', () => {
    expect(MESSAGES['ar-EG'].syncPassphrase).toEqual(MESSAGES.ar.syncPassphrase);
  });

  it('the Delete Account confirmation copy uses the exact approved wording for en and ar, including the required confirmation word', () => {
    expect(MESSAGES.en.deleteAccount).toEqual({
      title: 'Delete your account?',
      description:
        'This will permanently delete your Quran Heals account, synced reflections, favorites, preferences, and other account data. This action cannot be undone.',
      confirmationInstruction: 'To confirm, type DELETE below.',
      confirmationWord: 'DELETE',
      placeholder: 'Type DELETE',
      deleteButton: 'Delete my account',
      deleting: 'Deleting…',
      cancel: 'Cancel',
      successMessage: 'Your Quran Heals account has been deleted.',
      failureMessage: "We couldn't delete your account right now. Please try again.",
    });

    expect(MESSAGES.ar.deleteAccount).toEqual({
      title: 'حذف حسابك؟',
      description:
        'سيؤدي هذا إلى حذف حساب Quran Heals وخواطرك المحفوظة وآياتك المفضلة وتفضيلاتك وجميع البيانات المرتبطة بالحساب نهائيًا. لا يمكن التراجع عن هذا الإجراء.',
      confirmationInstruction: 'للتأكيد، اكتب حذف في الحقل أدناه.',
      confirmationWord: 'حذف',
      placeholder: 'اكتب حذف',
      deleteButton: 'حذف حسابي نهائيًا',
      deleting: 'جارٍ الحذف…',
      cancel: 'إلغاء',
      successMessage: 'تم حذف حسابك في Quran Heals.',
      failureMessage: 'تعذّر حذف حسابك الآن. يرجى المحاولة مرة أخرى.',
    });
  });

  it('ar-EG matches ar exactly for the Delete Account copy — never Egyptian colloquial for this destructive flow', () => {
    expect(MESSAGES['ar-EG'].deleteAccount).toEqual(MESSAGES.ar.deleteAccount);
  });

  it('the Danger Zone / Delete Account entry-point copy uses the exact approved wording for en and ar, and ar-EG matches ar', () => {
    expect(MESSAGES.en.account.dangerZoneTitle).toBe('Danger Zone');
    expect(MESSAGES.en.account.deleteAccountAction).toBe('Delete Account');
    expect(MESSAGES.en.account.deleteAccountActionDescription).toBe(
      'Permanently delete your Quran Heals account and all synced data.',
    );
    expect(MESSAGES['ar-EG'].account.dangerZoneTitle).toBe(MESSAGES.ar.account.dangerZoneTitle);
    expect(MESSAGES['ar-EG'].account.deleteAccountAction).toBe(MESSAGES.ar.account.deleteAccountAction);
    expect(MESSAGES['ar-EG'].account.deleteAccountActionDescription).toBe(MESSAGES.ar.account.deleteAccountActionDescription);
  });

  it('ar-EG uses the exact same Standard Arabic wording as ar for every new general-UI section (auth/account/reflection/syncPassphrase/issueReport/syncStatus)', () => {
    const generalUiSections = ['auth', 'account', 'reflection', 'syncPassphrase', 'issueReport', 'syncStatus'] as const;
    for (const section of generalUiSections) {
      expect(MESSAGES['ar-EG'][section], `ar-EG.${section} should equal ar.${section}`).toEqual(MESSAGES.ar[section]);
    }
  });

  it('ar-EG uses Standard Arabic (not Egyptian colloquial) for favorites and ayah loading/retry/error/empty-state wording', () => {
    const favoritesKeys: (keyof (typeof MESSAGES)['ar']['favorites'])[] = [
      'loadingTitle',
      'loadingMessage',
      'errorTitle',
      'retry',
      'emptyTitle',
      'emptyMessage',
      'unresolvedSuffix',
    ];
    for (const key of favoritesKeys) {
      expect(MESSAGES['ar-EG'].favorites[key], `ar-EG.favorites.${key}`).toBe(MESSAGES.ar.favorites[key]);
    }
    expect(MESSAGES['ar-EG'].favorites.emptyTitle).toBe('لا توجد آيات محفوظة بعد');

    const ayahKeys: (keyof (typeof MESSAGES)['ar']['ayah'])[] = [
      'loadingTitle',
      'loadingMessage',
      'errorTitle',
      'retry',
      'genericError',
      'missingEmotion',
    ];
    for (const key of ayahKeys) {
      expect(MESSAGES['ar-EG'].ayah[key], `ar-EG.ayah.${key}`).toBe(MESSAGES.ar.ayah[key]);
    }
    expect(MESSAGES['ar-EG'].ayah.loadingTitle).toBe('جارٍ تحميل الآية');
  });

  it('ar-EG keeps the three approved Egyptian exceptions unchanged and distinct from ar', () => {
    expect(MESSAGES['ar-EG'].home.title).toBe('إيه إحساسك دلوقتي؟');
    expect(MESSAGES['ar-EG'].home.subtitle).toBe('رسالة من القرآن لكل إحساس بتحسه');
    expect(MESSAGES['ar-EG'].home.title).not.toBe(MESSAGES.ar.home.title);
    expect(MESSAGES['ar-EG'].home.subtitle).not.toBe(MESSAGES.ar.home.subtitle);
  });

  it('never localizes Quran Arabic, Pickthall translation text, verse keys, or stable emotion keys (only interface copy is present)', () => {
    const disallowedSubstrings = ['pickthall', 'bismillah', 'surah_', 'verseKey', 'emotionKey'];
    for (const locale of APP_LOCALES) {
      const serialized = JSON.stringify(MESSAGES[locale]).toLowerCase();
      disallowedSubstrings.forEach((needle) => {
        expect(serialized.includes(needle.toLowerCase()), `${locale} messages unexpectedly reference "${needle}"`).toBe(false);
      });
    }
  });
});

describe('Locale persistence (useAppLocale.tsx): AsyncStorage wiring proven by source + isolated logic', () => {
  const PROVIDER_PATH = resolve(__dirname, '../src/localization/useAppLocale.tsx');
  const source = readFileSync(PROVIDER_PATH, 'utf-8');

  it('persists under a versioned/namespaced AsyncStorage key, matching this project`s existing storage convention', () => {
    expect(source).toMatch(/APP_LOCALE_STORAGE_KEY\s*=\s*'quran-heals:app-locale:v1'/);
    expect(source).toMatch(/AsyncStorage\.getItem\(APP_LOCALE_STORAGE_KEY\)/);
    expect(source).toMatch(/AsyncStorage\.setItem\(APP_LOCALE_STORAGE_KEY,\s*next\)/);
  });

  it('defaults to DEFAULT_APP_LOCALE (English) and only accepts a stored value that passes isAppLocale', () => {
    expect(source).toMatch(/useState<AppLocale>\(DEFAULT_APP_LOCALE\)/);
    expect(source).toMatch(/isAppLocale\(stored\)/);
  });

  it('never throws on unreadable/corrupted storage — a read failure is caught and the default locale is kept', () => {
    expect(source).toMatch(/try\s*{[\s\S]*AsyncStorage\.getItem[\s\S]*}\s*catch/);
  });
});

describe('AsyncStorage-backed locale round trip (simulated provider logic)', () => {
  beforeEach(() => asyncStorageState.clear());

  it('a valid persisted locale is read back through isAppLocale exactly as the provider would validate it', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('quran-heals:app-locale:v1', 'ar-EG');
    const stored = await AsyncStorage.getItem('quran-heals:app-locale:v1');
    expect(isAppLocale(stored)).toBe(true);
    expect(stored).toBe('ar-EG');
  });

  it('an invalid persisted value fails isAppLocale, matching the provider`s safe-fallback-to-default path', async () => {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.setItem('quran-heals:app-locale:v1', 'fr');
    const stored = await AsyncStorage.getItem('quran-heals:app-locale:v1');
    expect(isAppLocale(stored)).toBe(false);
  });
});
