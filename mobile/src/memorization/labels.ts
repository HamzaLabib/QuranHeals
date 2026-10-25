import type { AppLocale } from '@/localization/locales';

/**
 * Memorization Mode's interface text (وضع الحفظ), kept with the feature. The App Language is English or Arabic;
 * Egyptian Arabic (an Emotions Language only) reads the Arabic.
 */
export type MemorizationLabels = {
  /** Settings → Quran: the switch's title. */
  settingTitle: string;
  /** The Eye button's spoken labels. */
  enter: string;
  exit: string;
  showAll: string;
  hideAll: string;
  /** The gold Eye's spoken hint while on: a touch and hold opens Show All / Hide All. */
  menuHint: string;
  /** Closes that menu (a tap outside, Back). */
  close: string;
  /** Settings → Mushaf Guide: the choice between the two guides. */
  guideChooserTitle: string;
  normalGuide: string;
  memorizationGuide: string;
  cancel: string;
  /** The Memorization Mode Guide: one text per step (memorizationGuide.ts), its notes and last button. */
  guide: {
    enable: string;
    findEye: string;
    hide: string;
    reveal: string;
    peek: string;
    continueExit: string;
    showHideAll: string;
    /** Step 7 where Show All / Hide All sit in the top bar (no room beside the page number on that layout). */
    showHideAllInBar: string;
    /** Under a step whose control is not drawn now (the Eye while the setting is OFF; Show All / Hide All). */
    eyeNotShown: string;
    /** The Eye's steps on page 61's Quran SVG (its QPC V1 page not available): no Eye there for now. */
    eyeUnavailable: string;
    allNotShown: string;
    /** On the last step: where the guide is opened again. */
    reopenHint: string;
    done: string;
  };
};

const EN: MemorizationLabels = {
  settingTitle: 'Memorization Mode',
  enter: 'Enter Memorization Mode',
  exit: 'Exit Memorization Mode',
  showAll: 'Show All',
  hideAll: 'Hide All',
  menuHint: 'Touch and hold for Show All and Hide All',
  close: 'Close',
  guideChooserTitle: 'Mushaf Guide',
  normalGuide: 'Normal Mushaf Guide',
  memorizationGuide: 'Memorization Mode Guide',
  cancel: 'Cancel',
  guide: {
    enable: 'Turn on Memorization Mode in Settings → Quran → Memorization Mode.',
    findEye: 'An Eye button then appears in the Mushaf\'s top bar.',
    hide: 'Tap the Eye to hide all ayah text on the page.',
    reveal: 'Tap an ayah\'s position to reveal it, then tap it again to hide it. You can reveal multiple ayahs at once.',
    peek: 'Press and hold an ayah to reveal it temporarily, until you lift your finger.',
    continueExit: 'Swipe to another page. Memorization Mode stays active, and the new page\'s ayahs remain hidden. Tap the gold Eye to exit Memorization Mode and reveal the full page.',
    showHideAll: 'Show All and Hide All appear beside the page number while Memorization Mode is active. You can also long-press the gold Eye to access them.',
    showHideAllInBar: 'Show All and Hide All appear in the top bar while Memorization Mode is active. You can also long-press the gold Eye to access them.',
    eyeNotShown: 'The Eye appears in the top bar once Memorization Mode is turned on in Settings.',
    eyeUnavailable: 'The Eye is unavailable on this page until its standard Mushaf page loads.',
    allNotShown: 'Shown only while Memorization Mode is on.',
    reopenHint: 'You can view this guide again anytime from Settings → Quran → Mushaf Guide.',
    done: 'Done',
  },
};

const AR: MemorizationLabels = {
  settingTitle: 'وضع الحفظ',
  enter: 'الدخول إلى وضع الحفظ',
  exit: 'الخروج من وضع الحفظ',
  showAll: 'إظهار الكل',
  hideAll: 'إخفاء الكل',
  menuHint: 'اضغط مطولًا لإظهار الكل أو إخفاء الكل',
  close: 'إغلاق',
  guideChooserTitle: 'دليل المصحف',
  normalGuide: 'دليل المصحف',
  memorizationGuide: 'دليل وضع الحفظ',
  cancel: 'إلغاء',
  guide: {
    enable: 'فعّل وضع الحفظ من الإعدادات ← القرآن ← وضع الحفظ.',
    findEye: 'يظهر بعد ذلك زر العين في الشريط العلوي للمصحف.',
    hide: 'اضغط على العين لإخفاء نص جميع آيات الصفحة.',
    reveal: 'اضغط على موضع الآية لإظهارها، واضغط عليها مرة أخرى لإخفائها. يمكنك إظهار عدة آيات معًا.',
    peek: 'اضغط مطولًا على آية لتراها فقط حتى ترفع إصبعك.',
    continueExit: 'اسحب إلى صفحة أخرى، وسيبقى وضع الحفظ مفعّلًا وتكون آيات الصفحة الجديدة مخفية. اضغط على العين الذهبية للخروج من وضع الحفظ وإظهار الصفحة كاملة.',
    showHideAll: 'يظهر «إظهار الكل» و«إخفاء الكل» بجانب رقم الصفحة ما دام وضع الحفظ مفعّلًا. ويمكنك أيضًا الضغط مطولًا على العين الذهبية لإظهارهما.',
    showHideAllInBar: 'يظهر «إظهار الكل» و«إخفاء الكل» في الشريط العلوي ما دام وضع الحفظ مفعّلًا. ويمكنك أيضًا الضغط مطولًا على العين الذهبية لإظهارهما.',
    eyeNotShown: 'تظهر العين في الشريط العلوي بعد تفعيل وضع الحفظ من الإعدادات.',
    eyeUnavailable: 'العين غير متاحة في هذه الصفحة حتى تُحمَّل صفحة المصحف المعتادة.',
    allNotShown: 'يظهران فقط ما دام وضع الحفظ مفعّلًا.',
    reopenHint: 'يمكنك عرض هذا الدليل مرة أخرى في أي وقت من الإعدادات ← القرآن ← دليل المصحف.',
    done: 'تم',
  },
};

export function memorizationLabels(locale: AppLocale): MemorizationLabels {
  return locale === 'en' ? EN : AR;
}
