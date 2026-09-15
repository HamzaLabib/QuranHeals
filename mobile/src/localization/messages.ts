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
  translation: {
    showTranslation: string;
    hideTranslation: string;
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
    },
    favorites: {
      title: 'Saved Ayahs',
      subtitle: 'Favorites stored on this device.',
      loadingTitle: 'Loading favorites',
      loadingMessage: 'Opening your saved ayahs.',
      errorTitle: 'Some saved ayahs could not be opened',
      retry: 'Try Again',
      emptyTitle: 'No saved ayahs yet',
      emptyMessage: 'Save an ayah from the reflection screen and it will appear here.',
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
    translation: {
      showTranslation: 'Show translation',
      hideTranslation: 'Hide translation',
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
  },
  ar: {
    appName: 'Quran Heals',
    home: {
      subtitle: 'هداية قرآنية لكل شعور.',
      eyebrow: 'تأمل مع آية',
      title: 'كيف تشعر؟',
      loadingTitle: 'جارٍ تحميل المشاعر',
      loadingMessage: 'جارٍ إعداد قائمة المشاعر.',
      errorTitle: 'تعذّر الاتصال',
      retry: 'أعد المحاولة',
      disclaimer: 'يقدّم تطبيق Quran Heals تأملًا روحيًا، وهو ليس بديلًا عن الرعاية المتخصصة.',
      openFavorites: 'فتح الآيات المحفوظة',
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
    },
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة المخزّنة على هذا الجهاز.',
      loadingTitle: 'جارٍ تحميل المفضّلة',
      loadingMessage: 'جارٍ فتح آياتك المحفوظة.',
      errorTitle: 'تعذّر فتح بعض الآيات المحفوظة',
      retry: 'أعد المحاولة',
      emptyTitle: 'لا توجد آيات محفوظة بعد',
      emptyMessage: 'احفظ آية من شاشة التأمل وستظهر هنا.',
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
    translation: {
      showTranslation: 'إظهار الترجمة',
      hideTranslation: 'إخفاء الترجمة',
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
      translationDisplayOnDemandHint: 'يظهر النص العربي أولًا، مع إمكانية إظهار الترجمة عند الطلب.',
      translationDisplayOffHint: 'العربية فقط. لا تظهر الترجمة أبدًا.',
      quranArabicNote: 'يظهر القرآن الكريم بالعربية دائمًا — يؤثر هذا الإعداد فقط على الترجمة الإنجليزية.',
    },
  },
  'ar-EG': {
    appName: 'Quran Heals',
    home: {
      subtitle: 'هداية من القرآن لكل حاسة بتحسها.',
      eyebrow: 'اتأمل مع آية',
      title: 'حاسس إزاي؟',
      loadingTitle: 'بنحمّل المشاعر',
      loadingMessage: 'بنجهّز قائمة المشاعر.',
      errorTitle: 'مش قادرين نتصل',
      retry: 'جرّب تاني',
      disclaimer: 'تطبيق Quran Heals بيقدّم تأمل روحي، مش بديل عن رعاية متخصصة.',
      openFavorites: 'افتح الآيات المحفوظة',
    },
    ayah: {
      kicker: 'آية مختارة للحظة دي',
      goBack: 'رجوع',
      loadingTitle: 'بنحمّل الآية',
      loadingMessage: 'بندوّر على آية مناسبة.',
      errorTitle: 'جرّب تاني من فضلك',
      retry: 'جرّب تاني',
      missingEmotion: 'اختار حاسة الأول من فضلك.',
      genericError: 'مش قادرين نحمّل آية دلوقتي.',
      historyUnresolved: 'بعض السجل القديم متقدرناش نستخدمه عشان منكررش. سجلك المخزّن اتحفظ.',
      historyReadFailed: 'متقدرناش نقرا السجل الأخير. سجلك المخزّن اتحفظ.',
      historySaveFailed: 'متقدرناش نضيف الآية دي للسجل الأخير. سجلك القديم اتحفظ.',
      share: 'مشاركة',
      shareAyah: 'شارك الآية',
      anotherAyah: 'آية تانية',
      loadAnotherAyah: 'حمّل آية تانية',
    },
    favorites: {
      title: 'الآيات المحفوظة',
      subtitle: 'المفضّلة محفوظة على الجهاز ده.',
      loadingTitle: 'بنحمّل المفضّلة',
      loadingMessage: 'بنفتح آياتك المحفوظة.',
      errorTitle: 'مش قادرين نفتح بعض الآيات المحفوظة',
      retry: 'جرّب تاني',
      emptyTitle: 'لسه مفيش آيات محفوظة',
      emptyMessage: 'احفظ آية من شاشة التأمل وهتلاقيها هنا.',
      unresolvedSuffix: 'من العناصر المحفوظة متقدرناش نفتحها. سجلك المخزّن اتحفظ.',
      share: 'مشاركة',
      shareSaved: 'شارك الآية المحفوظة',
      remove: 'شيل',
      removeSaved: 'شيل الآية المحفوظة',
    },
    favoriteButton: {
      save: 'احفظ',
      saved: 'محفوظة',
      saveLabel: 'احفظ الآية في المفضّلة',
      removeLabel: 'شيل الآية من المفضّلة',
    },
    translation: {
      showTranslation: 'عرض الترجمة',
      hideTranslation: 'اخفي الترجمة',
    },
    settings: {
      title: 'الإعدادات',
      subtitle: 'لغة التطبيق وتفضيلات ترجمة القرآن.',
      openSettings: 'افتح الإعدادات',
      appLanguageSection: 'لغة التطبيق',
      quranTranslationSection: 'ترجمة القرآن',
      translationDisplayAlways: 'دايمًا',
      translationDisplayOnDemand: 'لما أطلبها',
      translationDisplayOff: 'إيقاف',
      translationDisplayAlwaysHint: 'النص العربي والترجمة الإنجليزية بيظهروا مع بعض أوتوماتيك.',
      translationDisplayOnDemandHint: 'النص العربي بيظهر الأول، وتقدر تعرض الترجمة لما تحب.',
      translationDisplayOffHint: 'عربي بس. الترجمة مش هتظهر خالص.',
      quranArabicNote: 'القرآن بالعربي بيظهر دايمًا — الإعداد ده بيأثر بس على الترجمة الإنجليزية.',
    },
  },
};

export function getMessages(locale: AppLocale): Messages {
  return MESSAGES[locale] ?? MESSAGES[('en' as AppLocale)];
}
