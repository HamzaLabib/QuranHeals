import type { AppLocale } from './locales';

/**
 * Current, user-visible mobile interface strings only. Explicitly excluded
 * (never localized here): Quran Arabic text, the Pickthall translation
 * text, technical/debug messages, verse keys, and stable internal emotion
 * keys — all of those come from verified data assets/the API, never from
 * this dictionary.
 */
export type Messages = {
  appName: string;
  home: {
    subtitle: string;
    eyebrow: string;
    title: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    disclaimer: string;
    openFavorites: string;
    openReflections: string;
  };
  /**
   * The general Quran flow's single home-screen action — completely
   * separate from the 29-emotion mapping system (no emotionKey involved).
   * One tappable label, not a heading+button pair. General UI text: ar-EG
   * uses this same Standard Arabic wording, not Egyptian colloquial.
   */
  generalQuran: {
    action: string;
    loadError: string;
  };
  ayah: {
    kicker: string;
    goBack: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    missingEmotion: string;
    genericError: string;
    historyUnresolved: string;
    historyReadFailed: string;
    historySaveFailed: string;
    share: string;
    shareAyah: string;
    anotherAyah: string;
    loadAnotherAyah: string;
    /** Deep-links to this exact ayah on tanzil.net in the device's browser — see utils/tanzilLink.ts. */
    readInQuran: string;
    /** Accessibility label for the copy-ayah-text icon on AyahCard — the visible control is icon-only. */
    copyAyah: string;
  };
  favorites: {
    title: string;
    subtitle: string;
    loadingTitle: string;
    loadingMessage: string;
    errorTitle: string;
    retry: string;
    emptyTitle: string;
    emptyMessage: string;
    unresolvedSuffix: string;
    share: string;
    shareSaved: string;
    remove: string;
    removeSaved: string;
  };
  favoriteButton: {
    save: string;
    saved: string;
    saveLabel: string;
    removeLabel: string;
  };
  /**
   * The dedicated "My Reflections" list screen — separate from the singular
   * `reflection` editor strings above (ReflectionSheet), which this screen
   * reuses unchanged rather than duplicating.
   */
  reflections: {
    title: string;
    subtitle: string;
    loadingTitle: string;
    loadingMessage: string;
    emptyTitle: string;
    emptyMessage: string;
    errorTitle: string;
    errorMessage: string;
    retry: string;
    referenceUnresolved: string;
    editedLabel: string;
    statusSavedOnDevice: string;
    statusPendingSync: string;
    statusSynced: string;
    openReflectionLabel: string;
  };
  translation: {
    showTranslation: string;
    hideTranslation: string;
  };
  quranFontSize: {
    decreaseLabel: string;
    increaseLabel: string;
    auto: string;
    autoLabel: string;
  };
  settings: {
    title: string;
    subtitle: string;
    openSettings: string;
    appLanguageSection: string;
    quranTranslationSection: string;
    translationDisplayAlways: string;
    translationDisplayOnDemand: string;
    translationDisplayOff: string;
    translationDisplayAlwaysHint: string;
    translationDisplayOnDemandHint: string;
    translationDisplayOffHint: string;
    quranArabicNote: string;
  };
  auth: {
    syncPrompt: string;
    continueWithoutAccount: string;
    continueWithApple: string;
    continueWithGoogle: string;
    signInFailed: string;
  };
  account: {
    sectionTitle: string;
    /** Shown only while auth status is still 'loading' (session restoration in progress) — never the same as notSignedIn, so a cold start never flashes a guest/sign-in prompt before restoration has actually concluded. */
    checkingSession: string;
    notSignedIn: string;
    signInWithApple: string;
    signInWithGoogle: string;
    signedIn: string;
    signOut: string;
    dangerZoneTitle: string;
    deleteAccountAction: string;
    deleteAccountActionDescription: string;
  };
  /** The permanent account-deletion confirmation sheet — GitHub-style typed confirmation, never auto-submits. */
  deleteAccount: {
    title: string;
    description: string;
    confirmationInstruction: string;
    /** The exact word the user must type (case-sensitive for en) — never accept a partial match. */
    confirmationWord: string;
    placeholder: string;
    deleteButton: string;
    deleting: string;
    cancel: string;
    successMessage: string;
    failureMessage: string;
  };
  reflection: {
    action: string;
    writeAction: string;
    title: string;
    prompt: string;
    placeholder: string;
    guestNote: string;
    syncedNote: string;
    save: string;
    cancel: string;
    deleteAction: string;
    deleteConfirmTitle: string;
    deleteConfirmMessage: string;
    deleteConfirmCancel: string;
    deleteConfirmConfirm: string;
    deleteError: string;
  };
  /**
   * The mandatory "Sync Password" gate for synced reflections/favorites
   * (never a skip/cancel — see SyncPassphraseSheet.tsx). Reuses
   * `account.signOut` for the sheet's one way out; no `cancel` key here.
   */
  syncPassphrase: {
    createTitle: string;
    unlockTitle: string;
    createDescription: string;
    unlockDescription: string;
    createPlaceholder: string;
    unlockPlaceholder: string;
    continueLabel: string;
    confirmPassword: string;
    show: string;
    hide: string;
    lengthHint: string;
    allowedHint: string;
    mismatch: string;
    tooShort: string;
    tooLong: string;
    changeTitle: string;
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
    mustDiffer: string;
    incorrectError: string;
    changeDescription: string;
    saveError: string;
    loadError: string;
    retry: string;
  };
  issueReport: {
    action: string;
    description: string;
    categoryAyahNotRelevant: string;
    categoryQuranTextDisplay: string;
    categoryTranslationIssue: string;
    categoryAppTechnicalIssue: string;
    categoryOther: string;
    emailLabel: string;
    submit: string;
    cancel: string;
    successMessage: string;
    failureMessage: string;
  };
  syncStatus: {
    savedOnDevice: string;
    syncing: string;
    synced: string;
    syncFailed: string;
  };
};

export const MESSAGES: Record<AppLocale, Messages> = {
  en: {
    appName: 'Quran Heals',
    home: {
      subtitle: "Qur'anic guidance for every emotion.",
      eyebrow: 'Reflect with an ayah',
      title: 'How are you feeling?',
      loadingTitle: 'Loading emotions',
      loadingMessage: 'Preparing the emotion list.',
      errorTitle: 'Unable to connect',
      retry: 'Try Again',
      disclaimer: 'Quran Heals offers spiritual reflection and is not a substitute for professional care.',
      openFavorites: 'Open saved ayahs',
      openReflections: 'Open My Reflections',
    },
    generalQuran: {
      action: 'A Message from the Quran',
      loadError: "We couldn't load an ayah. Please try again.",
    },
    ayah: {
      kicker: 'A selected ayah for this moment',
      goBack: 'Go back',
      loadingTitle: 'Loading ayah',
      loadingMessage: 'Finding a relevant ayah.',
      errorTitle: 'Please try again',
      retry: 'Try Again',
      missingEmotion: 'Please choose an emotion first.',
      genericError: "We couldn't load an ayah right now.",
      historyUnresolved: 'Some older history entries could not be used to prevent repeats. Your stored history has been kept.',
      historyReadFailed: 'Recent history could not be read. Your stored history has been kept.',
      historySaveFailed: 'This ayah could not be added to recent history. Your previous history has been kept.',
      share: 'Share',
      shareAyah: 'Share ayah',
      anotherAyah: 'Another Ayah',
      loadAnotherAyah: 'Load another ayah',
      readInQuran: 'Read in Quran',
      copyAyah: 'Copy ayah',
    },
    favorites: {
      title: 'Saved Ayahs',
      subtitle: 'Favorites stored on this device.',
      loadingTitle: 'Loading favorites',
      loadingMessage: 'Opening your saved ayahs.',
      errorTitle: 'Some saved ayahs could not be opened',
      retry: 'Try Again',
      emptyTitle: 'No saved ayahs yet',
      emptyMessage: 'Save an ayah and it will appear here.',
      unresolvedSuffix: 'saved item(s) could not be resolved. Your stored entries have been kept.',
      share: 'Share',
      shareSaved: 'Share saved ayah',
      remove: 'Remove',
      removeSaved: 'Remove saved ayah',
    },
    favoriteButton: {
      save: 'Save',
      saved: 'Saved',
      saveLabel: 'Save ayah to favorites',
      removeLabel: 'Remove ayah from favorites',
    },
    reflections: {
      title: 'My Reflections',
      subtitle: 'Your thoughts and reflections on Quran verses',
      loadingTitle: 'Loading reflections',
      loadingMessage: 'Opening your saved reflections.',
      emptyTitle: 'No reflections yet',
      emptyMessage: 'Open an ayah and write a reflection. It will appear here.',
      errorTitle: 'Some reflections could not be opened',
      errorMessage: 'Your reflections could not be read. Your stored data has been kept.',
      retry: 'Try Again',
      referenceUnresolved: 'This Quran reference could not be verified right now.',
      editedLabel: 'Edited',
      statusSavedOnDevice: 'Saved on device',
      statusPendingSync: 'Pending sync',
      statusSynced: 'Synced',
      openReflectionLabel: 'Open reflection for',
    },
    translation: {
      showTranslation: 'Show translation',
      hideTranslation: 'Hide translation',
    },
    quranFontSize: {
      decreaseLabel: 'Decrease Quran text size',
      increaseLabel: 'Increase Quran text size',
      auto: 'Auto',
      autoLabel: 'Reset Quran text size to automatic',
    },
    settings: {
      title: 'Settings',
      subtitle: 'App language and Quran translation preferences.',
      openSettings: 'Open settings',
      appLanguageSection: 'App Language',
      quranTranslationSection: 'Quran Translation',
      translationDisplayAlways: 'Always',
      translationDisplayOnDemand: 'On demand',
      translationDisplayOff: 'Off',
      translationDisplayAlwaysHint: 'Arabic and the English translation are both shown automatically.',
      translationDisplayOnDemandHint: 'Arabic is shown first; tap to reveal the translation.',
      translationDisplayOffHint: 'Arabic only. The translation is never shown.',
      quranArabicNote: 'The Arabic Quran is always shown — this setting only affects the English translation.',
    },
    auth: {
      syncPrompt: 'Sign in to sync across devices',
      continueWithoutAccount: 'Continue without an account',
      continueWithApple: 'Continue with Apple',
      continueWithGoogle: 'Continue with Google',
      signInFailed: "We couldn't sign you in. You can try again or continue without an account.",
    },
    account: {
      sectionTitle: 'Account',
      checkingSession: 'Checking your session…',
      notSignedIn: 'Not signed in',
      signInWithApple: 'Sign in with Apple',
      signInWithGoogle: 'Sign in with Google',
      signedIn: 'Signed in',
      signOut: 'Sign out',
      dangerZoneTitle: 'Danger Zone',
      deleteAccountAction: 'Delete Account',
      deleteAccountActionDescription: 'Permanently delete your Quran Heals account and all synced data.',
    },
    deleteAccount: {
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
    },
    reflection: {
      action: 'Reflection',
      writeAction: 'Write a reflection',
      title: 'Reflections on this ayah',
      prompt: 'What feeling did this ayah leave you with?',
      placeholder: 'Write how this ayah touched your heart...',
      guestNote: 'Your reflections are saved on this device. Sign in to access them across your devices.',
      syncedNote: 'Your reflection is privately synced across your signed-in devices.',
      save: 'Save',
      cancel: 'Cancel',
      deleteAction: 'Delete reflection',
      deleteConfirmTitle: 'Delete reflection?',
      deleteConfirmMessage: 'This reflection will be removed from this device and your other signed-in devices.',
      deleteConfirmCancel: 'Cancel',
      deleteConfirmConfirm: 'Delete',
      deleteError: 'Your reflection could not be deleted. Please try again.',
    },
    syncPassphrase: {
      createTitle: "Set Password",
      unlockTitle: "Enter Password",
      createDescription: "Create a Password to protect and encrypt your private reflections when they sync across your devices. Quran Heals cannot recover your Password if you forget it, so choose something you can remember.",
      unlockDescription: "Enter your Password to unlock your encrypted synced data on this device.",
      createPlaceholder: "Password",
      unlockPlaceholder: "Password",
      continueLabel: "Continue",
      confirmPassword: "Confirm Password",
      show: "Show",
      hide: "Hide",
      lengthHint: "Use 8–32 characters.",
      allowedHint: "Letters, numbers, and symbols are allowed.",
      mismatch: "Passwords don’t match.",
      tooShort: "Password must be at least 8 characters.",
      tooLong: "Password cannot exceed 32 characters.",
      changeTitle: "Change Password",
      currentPassword: "Current Password",
      newPassword: "New Password",
      confirmNewPassword: "Confirm New Password",
      mustDiffer: "New Password must be different from your current Password.",
      incorrectError: "Current Password is incorrect.",
      changeDescription: "Change the Password for your encrypted synced reflections.",
      saveError: "Could not confirm the password change. Check your connection and try again. If it was saved, use your new Password.",
      loadError: "Could not load your encrypted sync key. Please try again.",
      retry: "Try again",
    },
    issueReport: {
      action: 'Report an issue',
      description: 'Tell us what seems wrong. Your report helps us improve Quran Heals.',
      categoryAyahNotRelevant: "Ayah doesn't feel relevant",
      categoryQuranTextDisplay: 'Quran text display issue',
      categoryTranslationIssue: 'Translation issue',
      categoryAppTechnicalIssue: 'App or technical issue',
      categoryOther: 'Other',
      emailLabel: 'Email for follow-up (optional)',
      submit: 'Submit',
      cancel: 'Cancel',
      successMessage: 'Thank you. Your report has been received.',
      failureMessage: "We couldn't send your report. Please try again.",
    },
    syncStatus: {
      savedOnDevice: 'Saved on device',
      syncing: 'Syncing',
      synced: 'Synced',
      syncFailed: 'Sync failed',
    },
  },
  ar: {
    appName: 'Quran Heals',
    home: {
      subtitle: 'هداية قرآنية لكل شعور.',
      eyebrow: 'تأمّل مع آية',
      title: 'بماذا تشعر الآن؟',
      loadingTitle: 'جارٍ تحميل المشاعر',
      loadingMessage: 'جارٍ إعداد قائمة المشاعر.',
      errorTitle: 'تعذّر الاتصال',
      retry: 'أعد المحاولة',
      disclaimer: 'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
      openFavorites: 'فتح الآيات المحفوظة',
      openReflections: 'فتح خواطري',
    },
    generalQuran: {
      action: 'رسالة من القرآن',
      loadError: 'تعذّر تحميل الآية. يُرجى المحاولة مرة أخرى.',
    },
    ayah: {
      kicker: 'آية مختارة لهذه اللحظة',
      goBack: 'رجوع',
      loadingTitle: 'جارٍ تحميل الآية',
      loadingMessage: 'جارٍ البحث عن آية مناسبة.',
      errorTitle: 'يرجى إعادة المحاولة',
      retry: 'أعد المحاولة',
      missingEmotion: 'يرجى اختيار شعور أولًا.',
      genericError: 'تعذّر تحميل آية الآن.',
      historyUnresolved: 'تعذّر استخدام بعض سجلات السجل القديمة لمنع التكرار. تم الاحتفاظ بسجلك المخزّن.',
      historyReadFailed: 'تعذّرت قراءة السجل الأخير. تم الاحتفاظ بسجلك المخزّن.',
      historySaveFailed: 'تعذّرت إضافة هذه الآية إلى السجل الأخير. تم الاحتفاظ بسجلك السابق.',
      share: 'مشاركة',
      shareAyah: 'مشاركة الآية',
      anotherAyah: 'آية أخرى',
      loadAnotherAyah: 'تحميل آية أخرى',
      readInQuran: 'اقرأ الآية في المصحف',
      copyAyah: 'نسخ الآية',
    },
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة المخزّنة على هذا الجهاز.',
      loadingTitle: 'جارٍ تحميل المفضّلة',
      loadingMessage: 'جارٍ فتح آياتك المحفوظة.',
      errorTitle: 'تعذّر فتح بعض الآيات المحفوظة',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد آيات محفوظة بعد',
      emptyMessage: 'احفظ آية وستظهر هنا.',
      unresolvedSuffix: 'من العناصر المحفوظة تعذّر فتحها. تم الاحتفاظ بسجلك المخزّن.',
      share: 'مشاركة',
      shareSaved: 'مشاركة الآية المحفوظة',
      remove: 'إزالة',
      removeSaved: 'إزالة الآية المحفوظة',
    },
    favoriteButton: {
      save: 'حفظ',
      saved: 'محفوظة',
      saveLabel: 'حفظ الآية في المفضّلة',
      removeLabel: 'إزالة الآية من المفضّلة',
    },
    reflections: {
      title: 'خواطري',
      subtitle: 'خواطرك وتأملاتك مع آيات القرآن',
      loadingTitle: 'جارٍ تحميل الخواطر',
      loadingMessage: 'جارٍ فتح خواطرك المحفوظة.',
      emptyTitle: 'لا توجد خواطر بعد',
      emptyMessage: 'افتح آية وأضف خاطرة، وستظهر هنا.',
      errorTitle: 'تعذّر فتح بعض الخواطر',
      errorMessage: 'تعذّرت قراءة خواطرك. تم الاحتفاظ ببياناتك المخزّنة.',
      retry: 'أعد المحاولة',
      referenceUnresolved: 'تعذّر التحقق من مرجع هذه الآية حاليًا.',
      editedLabel: 'آخر تعديل',
      statusSavedOnDevice: 'محفوظ على الجهاز',
      statusPendingSync: 'بانتظار المزامنة',
      statusSynced: 'تمت المزامنة',
      openReflectionLabel: 'فتح الخاطرة الخاصة بـ',
    },
    translation: {
      showTranslation: 'إظهار الترجمة',
      hideTranslation: 'إخفاء الترجمة',
    },
    quranFontSize: {
      decreaseLabel: 'تصغير حجم نص القرآن',
      increaseLabel: 'تكبير حجم نص القرآن',
      auto: 'تلقائي',
      autoLabel: 'إعادة ضبط حجم نص القرآن تلقائيًا',
    },
    settings: {
      title: 'الإعدادات',
      subtitle: 'لغة التطبيق وتفضيلات ترجمة القرآن.',
      openSettings: 'فتح الإعدادات',
      appLanguageSection: 'لغة التطبيق',
      quranTranslationSection: 'ترجمة القرآن',
      translationDisplayAlways: 'دائمًا',
      translationDisplayOnDemand: 'عند الطلب',
      translationDisplayOff: 'إيقاف',
      translationDisplayAlwaysHint: 'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
      translationDisplayOnDemandHint: 'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
      translationDisplayOffHint: 'النص العربي فقط. لن تظهر الترجمة.',
      quranArabicNote: 'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
    },
    auth: {
      syncPrompt: 'سجّل الدخول لتجد محتواك المحفوظ على أجهزتك الأخرى',
      continueWithoutAccount: 'المتابعة دون حساب',
      continueWithApple: 'المتابعة باستخدام Apple',
      continueWithGoogle: 'المتابعة باستخدام Google',
      signInFailed: 'تعذّر تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة دون حساب.',
    },
    account: {
      sectionTitle: 'الحساب',
      checkingSession: 'جارٍ التحقق من تسجيل الدخول…',
      notSignedIn: 'لم يتم تسجيل الدخول',
      signInWithApple: 'تسجيل الدخول باستخدام Apple',
      signInWithGoogle: 'تسجيل الدخول باستخدام Google',
      signedIn: 'تم تسجيل الدخول',
      signOut: 'تسجيل الخروج',
      dangerZoneTitle: 'منطقة الخطر',
      deleteAccountAction: 'حذف الحساب',
      deleteAccountActionDescription: 'حذف حساب Quran Heals وجميع بياناته المتزامنة نهائيًا.',
    },
    // Account-deletion confirmation copy is a security/destructive-action
    // flow — intentionally byte-identical Standard Arabic in `ar` and
    // `ar-EG`, never Egyptian colloquial (matches the mandatory Sync
    // Password flow's precedent).
    deleteAccount: {
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
    },
    reflection: {
      action: 'خواطر',
      writeAction: 'أضف خاطرة',
      title: 'خواطر حول هذه الآية',
      prompt: 'ما الشعور الذي تركته هذه الآية في نفسك؟',
      placeholder: 'اكتب ما تركته هذه الآية في قلبك...',
      guestNote: 'تُحفظ خواطرك على هذا الجهاز. سجّل الدخول للوصول إليها عبر أجهزتك.',
      syncedNote: 'تتم مزامنة خواطرك بشكل خاص بين أجهزتك التي سجّلت الدخول عليها.',
      save: 'حفظ',
      cancel: 'إلغاء',
      deleteAction: 'حذف الخاطرة',
      deleteConfirmTitle: 'حذف الخاطرة؟',
      deleteConfirmMessage: 'ستُحذف هذه الخاطرة من هذا الجهاز وأجهزتك الأخرى التي سجّلت الدخول عليها.',
      deleteConfirmCancel: 'إلغاء',
      deleteConfirmConfirm: 'حذف',
      deleteError: 'تعذّر حذف خاطرتك. يُرجى المحاولة مرة أخرى.',
    },
    syncPassphrase: {
      createTitle: "إنشاء كلمة المرور",
      unlockTitle: "أدخل كلمة المرور",
      createDescription: "أنشئ كلمة مرور لحماية وتشفير خواطرك الخاصة عند مزامنتها بين أجهزتك. لا يمكن لتطبيق Quran Heals استعادة كلمة المرور إذا نسيتها، لذا اختر كلمة مرور يمكنك تذكرها.",
      unlockDescription: "أدخل كلمة المرور لفتح بياناتك المشفّرة على هذا الجهاز.",
      createPlaceholder: "كلمة المرور",
      unlockPlaceholder: "كلمة المرور",
      continueLabel: "متابعة",
      confirmPassword: "تأكيد كلمة المرور",
      show: "إظهار",
      hide: "إخفاء",
      lengthHint: "استخدم من 8 إلى 32 حرفًا.",
      allowedHint: "يمكنك استخدام الحروف والأرقام والرموز.",
      mismatch: "كلمتا المرور غير متطابقتين.",
      tooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
      tooLong: "لا يمكن أن تتجاوز كلمة المرور 32 حرفًا.",
      changeTitle: "تغيير كلمة المرور",
      currentPassword: "كلمة المرور الحالية",
      newPassword: "كلمة المرور الجديدة",
      confirmNewPassword: "تأكيد كلمة المرور الجديدة",
      mustDiffer: "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.",
      incorrectError: "كلمة المرور الحالية غير صحيحة.",
      changeDescription: "غيّر كلمة المرور الخاصة بخواطرك المشفّرة المتزامنة.",
      saveError: "تعذّر تأكيد تغيير كلمة المرور. تحقق من اتصالك وحاول مرة أخرى. إذا تم حفظ التغيير، فاستخدم كلمة المرور الجديدة.",
      loadError: "تعذّر تحميل مفتاح المزامنة المشفّر. يُرجى المحاولة مرة أخرى.",
      retry: "حاول مرة أخرى",
    },
    issueReport: {
      action: 'الإبلاغ عن مشكلة',
      description: 'أخبرنا بالمشكلة التي لاحظتها. يساعدنا بلاغك على تحسين Quran Heals.',
      categoryAyahNotRelevant: 'الآية لا تبدو مرتبطة بالشعور',
      categoryQuranTextDisplay: 'مشكلة في عرض نص القرآن',
      categoryTranslationIssue: 'مشكلة في الترجمة',
      categoryAppTechnicalIssue: 'مشكلة تقنية في التطبيق',
      categoryOther: 'أخرى',
      emailLabel: 'البريد الإلكتروني للمتابعة (اختياري)',
      submit: 'إرسال',
      cancel: 'إلغاء',
      successMessage: 'شكرًا لك. تم استلام بلاغك.',
      failureMessage: 'تعذّر إرسال البلاغ. يُرجى المحاولة مرة أخرى.',
    },
    syncStatus: {
      savedOnDevice: 'محفوظ على الجهاز',
      syncing: 'جارٍ المزامنة',
      synced: 'تمت المزامنة',
      syncFailed: 'تعذّرت المزامنة',
    },
  },
  'ar-EG': {
    appName: 'Quran Heals',
    home: {
      subtitle: 'رسالة من القرآن لكل إحساس بتحسه',
      eyebrow: 'تأمّل مع آية',
      title: 'إيه إحساسك دلوقتي؟',
      loadingTitle: 'بنحمّل المشاعر',
      loadingMessage: 'بنجهّز قائمة المشاعر.',
      errorTitle: 'مش قادرين نتصل',
      retry: 'جرّب تاني',
      disclaimer: 'تطبيق Quran Heals يقدّم تأملًا روحيًا، وليس بديلًا عن الرعاية المتخصصة.',
      openFavorites: 'افتح الآيات المحفوظة',
      openReflections: 'فتح خواطري',
    },
    // Standard Arabic, same as `ar` — general UI (Part J §47), not one of
    // the three approved Egyptian exceptions.
    generalQuran: {
      action: 'رسالة من القرآن',
      loadError: 'تعذّر تحميل الآية. يُرجى المحاولة مرة أخرى.',
    },
    // Loading/retry/error/placeholder wording while an ayah is being
    // obtained is Standard Arabic, same as `ar` — not one of the three
    // approved Egyptian exceptions (Part J §47), and consistent with
    // favorites' own loading/error/retry wording below.
    ayah: {
      kicker: 'آية مختارة لهذه اللحظة',
      goBack: 'رجوع',
      loadingTitle: 'جارٍ تحميل الآية',
      loadingMessage: 'جارٍ البحث عن آية مناسبة.',
      errorTitle: 'يرجى إعادة المحاولة',
      retry: 'أعد المحاولة',
      missingEmotion: 'يرجى اختيار شعور أولًا.',
      genericError: 'تعذّر تحميل آية الآن.',
      historyUnresolved: 'بعض السجل القديم متقدرناش نستخدمه عشان منكررش. سجلك المخزّن اتحفظ.',
      historyReadFailed: 'متقدرناش نقرا السجل الأخير. سجلك المخزّن اتحفظ.',
      historySaveFailed: 'متقدرناش نضيف الآية دي للسجل الأخير. سجلك القديم اتحفظ.',
      share: 'مشاركة',
      shareAyah: 'شارك الآية',
      anotherAyah: 'آية أخرى',
      loadAnotherAyah: 'تحميل آية أخرى',
      readInQuran: 'اقرأ الآية في المصحف',
      copyAyah: 'نسخ الآية',
    },
    // Loading/error/retry/empty-state wording is Standard Arabic, same as
    // `ar` — see the doc comment on `ayah` above.
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة محفوظة على هذا الجهاز.',
      loadingTitle: 'جارٍ تحميل المفضّلة',
      loadingMessage: 'جارٍ فتح آياتك المحفوظة.',
      errorTitle: 'تعذّر فتح بعض الآيات المحفوظة',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد آيات محفوظة بعد',
      emptyMessage: 'احفظ آية وستظهر هنا.',
      unresolvedSuffix: 'من العناصر المحفوظة تعذّر فتحها. تم الاحتفاظ بسجلك المخزّن.',
      share: 'مشاركة',
      shareSaved: 'شارك الآية المحفوظة',
      remove: 'إزالة',
      removeSaved: 'إزالة الآية المحفوظة',
    },
    favoriteButton: {
      save: 'احفظ',
      saved: 'محفوظة',
      saveLabel: 'احفظ الآية في المفضّلة',
      removeLabel: 'إزالة الآية من المفضّلة',
    },
    // Standard Arabic, same as `ar` — general UI (Part J §47), not one of
    // the three approved Egyptian exceptions.
    reflections: {
      title: 'خواطري',
      subtitle: 'خواطرك وتأملاتك مع آيات القرآن',
      loadingTitle: 'جارٍ تحميل الخواطر',
      loadingMessage: 'جارٍ فتح خواطرك المحفوظة.',
      emptyTitle: 'لا توجد خواطر بعد',
      emptyMessage: 'افتح آية وأضف خاطرة، وستظهر هنا.',
      errorTitle: 'تعذّر فتح بعض الخواطر',
      errorMessage: 'تعذّرت قراءة خواطرك. تم الاحتفاظ ببياناتك المخزّنة.',
      retry: 'أعد المحاولة',
      referenceUnresolved: 'تعذّر التحقق من مرجع هذه الآية حاليًا.',
      editedLabel: 'آخر تعديل',
      statusSavedOnDevice: 'محفوظ على الجهاز',
      statusPendingSync: 'بانتظار المزامنة',
      statusSynced: 'تمت المزامنة',
      openReflectionLabel: 'فتح الخاطرة الخاصة بـ',
    },
    translation: {
      showTranslation: 'عرض الترجمة',
      hideTranslation: 'إخفاء الترجمة',
    },
    quranFontSize: {
      decreaseLabel: 'تصغير حجم نص القرآن',
      increaseLabel: 'تكبير حجم نص القرآن',
      auto: 'تلقائي',
      autoLabel: 'إعادة ضبط حجم نص القرآن تلقائيًا',
    },
    settings: {
      title: 'الإعدادات',
      subtitle: 'لغة التطبيق وتفضيلات ترجمة القرآن.',
      openSettings: 'افتح الإعدادات',
      appLanguageSection: 'لغة التطبيق',
      quranTranslationSection: 'ترجمة القرآن',
      translationDisplayAlways: 'دائمًا',
      translationDisplayOnDemand: 'عند الطلب',
      translationDisplayOff: 'إيقاف',
      translationDisplayAlwaysHint: 'يظهر النص العربي والترجمة الإنجليزية معًا تلقائيًا.',
      translationDisplayOnDemandHint: 'يظهر النص العربي أولًا، ويمكنك إظهار الترجمة متى شئت.',
      translationDisplayOffHint: 'النص العربي فقط. لن تظهر الترجمة.',
      quranArabicNote: 'يظهر القرآن بالعربية دائمًا — هذا الإعداد يؤثر فقط على الترجمة الإنجليزية.',
    },
    // ar-EG general UI uses the same Standard Arabic as `ar` for everything
    // outside the three approved Egyptian exceptions (home heading/subtitle,
    // emotion names) — see Part J §47. Account/auth/reflection/sync/issue
    // copy is all general UI, so it is intentionally byte-identical to `ar`.
    auth: {
      syncPrompt: 'سجّل الدخول لتجد محتواك المحفوظ على أجهزتك الأخرى',
      continueWithoutAccount: 'المتابعة دون حساب',
      continueWithApple: 'المتابعة باستخدام Apple',
      continueWithGoogle: 'المتابعة باستخدام Google',
      signInFailed: 'تعذّر تسجيل الدخول. يمكنك المحاولة مرة أخرى أو المتابعة دون حساب.',
    },
    account: {
      sectionTitle: 'الحساب',
      checkingSession: 'جارٍ التحقق من تسجيل الدخول…',
      notSignedIn: 'لم يتم تسجيل الدخول',
      signInWithApple: 'تسجيل الدخول باستخدام Apple',
      signInWithGoogle: 'تسجيل الدخول باستخدام Google',
      signedIn: 'تم تسجيل الدخول',
      signOut: 'تسجيل الخروج',
      dangerZoneTitle: 'منطقة الخطر',
      deleteAccountAction: 'حذف الحساب',
      deleteAccountActionDescription: 'حذف حساب Quran Heals وجميع بياناته المتزامنة نهائيًا.',
    },
    // Account-deletion confirmation copy is a security/destructive-action
    // flow — intentionally byte-identical Standard Arabic in `ar` and
    // `ar-EG`, never Egyptian colloquial (matches the mandatory Sync
    // Password flow's precedent).
    deleteAccount: {
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
    },
    reflection: {
      action: 'خواطر',
      writeAction: 'أضف خاطرة',
      title: 'خواطر حول هذه الآية',
      prompt: 'ما الشعور الذي تركته هذه الآية في نفسك؟',
      placeholder: 'اكتب ما تركته هذه الآية في قلبك...',
      guestNote: 'تُحفظ خواطرك على هذا الجهاز. سجّل الدخول للوصول إليها عبر أجهزتك.',
      syncedNote: 'تتم مزامنة خواطرك بشكل خاص بين أجهزتك التي سجّلت الدخول عليها.',
      save: 'حفظ',
      cancel: 'إلغاء',
      deleteAction: 'حذف الخاطرة',
      deleteConfirmTitle: 'حذف الخاطرة؟',
      deleteConfirmMessage: 'ستُحذف هذه الخاطرة من هذا الجهاز وأجهزتك الأخرى التي سجّلت الدخول عليها.',
      deleteConfirmCancel: 'إلغاء',
      deleteConfirmConfirm: 'حذف',
      deleteError: 'تعذّر حذف خاطرتك. يُرجى المحاولة مرة أخرى.',
    },
    // Sync Password copy is a security-sensitive flow — intentionally
    // byte-identical to `ar`'s Standard Arabic (Part 9 of the mandatory
    // sync-password phase), never Egyptian colloquial.
    syncPassphrase: {
      createTitle: "إنشاء كلمة المرور",
      unlockTitle: "أدخل كلمة المرور",
      createDescription: "أنشئ كلمة مرور لحماية وتشفير خواطرك الخاصة عند مزامنتها بين أجهزتك. لا يمكن لتطبيق Quran Heals استعادة كلمة المرور إذا نسيتها، لذا اختر كلمة مرور يمكنك تذكرها.",
      unlockDescription: "أدخل كلمة المرور لفتح بياناتك المشفّرة على هذا الجهاز.",
      createPlaceholder: "كلمة المرور",
      unlockPlaceholder: "كلمة المرور",
      continueLabel: "متابعة",
      confirmPassword: "تأكيد كلمة المرور",
      show: "إظهار",
      hide: "إخفاء",
      lengthHint: "استخدم من 8 إلى 32 حرفًا.",
      allowedHint: "يمكنك استخدام الحروف والأرقام والرموز.",
      mismatch: "كلمتا المرور غير متطابقتين.",
      tooShort: "يجب أن تتكون كلمة المرور من 8 أحرف على الأقل.",
      tooLong: "لا يمكن أن تتجاوز كلمة المرور 32 حرفًا.",
      changeTitle: "تغيير كلمة المرور",
      currentPassword: "كلمة المرور الحالية",
      newPassword: "كلمة المرور الجديدة",
      confirmNewPassword: "تأكيد كلمة المرور الجديدة",
      mustDiffer: "يجب أن تكون كلمة المرور الجديدة مختلفة عن كلمة المرور الحالية.",
      incorrectError: "كلمة المرور الحالية غير صحيحة.",
      changeDescription: "غيّر كلمة المرور الخاصة بخواطرك المشفّرة المتزامنة.",
      saveError: "تعذّر تأكيد تغيير كلمة المرور. تحقق من اتصالك وحاول مرة أخرى. إذا تم حفظ التغيير، فاستخدم كلمة المرور الجديدة.",
      loadError: "تعذّر تحميل مفتاح المزامنة المشفّر. يُرجى المحاولة مرة أخرى.",
      retry: "حاول مرة أخرى",
    },
    issueReport: {
      action: 'الإبلاغ عن مشكلة',
      description: 'أخبرنا بالمشكلة التي لاحظتها. يساعدنا بلاغك على تحسين Quran Heals.',
      categoryAyahNotRelevant: 'الآية لا تبدو مرتبطة بالشعور',
      categoryQuranTextDisplay: 'مشكلة في عرض نص القرآن',
      categoryTranslationIssue: 'مشكلة في الترجمة',
      categoryAppTechnicalIssue: 'مشكلة تقنية في التطبيق',
      categoryOther: 'أخرى',
      emailLabel: 'البريد الإلكتروني للمتابعة (اختياري)',
      submit: 'إرسال',
      cancel: 'إلغاء',
      successMessage: 'شكرًا لك. تم استلام بلاغك.',
      failureMessage: 'تعذّر إرسال البلاغ. يُرجى المحاولة مرة أخرى.',
    },
    syncStatus: {
      savedOnDevice: 'محفوظ على الجهاز',
      syncing: 'جارٍ المزامنة',
      synced: 'تمت المزامنة',
      syncFailed: 'تعذّرت المزامنة',
    },
  },
};

export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES[('en' as AppLocale)];
}
