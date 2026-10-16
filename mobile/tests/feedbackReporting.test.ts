import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createElement } from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESSAGES } from '@/localization/messages';

/**
 * Home feedback and contextual issue reporting: the one reporting sheet
 * (ReportIssueSheet) in its three uses — Home's Share Feedback, the ayah
 * screen's flag action, Settings' Report an issue — and where each entry
 * point sits. The sheet is rendered with mocked React Native host
 * components, like reportIssueSheet.test.ts; placement is checked in the
 * screens' source.
 */

const state = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  submitIssue: vi.fn(),
  submitFeedback: vi.fn(),
}));
vi.mock('react-native', () => ({
  useColorScheme: () => 'light',
  Keyboard: { dismiss: vi.fn() }, useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }), Platform: { OS: 'ios', select: (values: { ios: unknown }) => values.ios }, StyleSheet: { create: (value: unknown) => value },
  Modal: 'Modal', KeyboardAvoidingView: 'KeyboardAvoidingView', Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', TextInput: 'TextInput', TouchableWithoutFeedback: 'TouchableWithoutFeedback', View: 'View',
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
vi.mock('lucide-react-native', () => ({ Check: 'Check' }));
vi.mock('@/localization/useAppLocale', () => ({ useAppLocale: () => ({ locale: state.locale, messages: MESSAGES[state.locale] }) }));
vi.mock('@/localization/useQuranTranslationPreference', () => ({
  useQuranTranslationPreference: () => ({ preference: { displayMode: 'on-demand', translationId: 'en.pickthall.gutenberg16955' } }),
}));
vi.mock('@/services/issueReportApi', () => ({ submitIssueReport: state.submitIssue, submitFeedback: state.submitFeedback }));

import { ReportIssueSheet, type ReportSheetVariant } from '@/components/ReportIssueSheet';

const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8').split(String.fromCharCode(13)).join('');

let root: ReactTestRenderer;
let onClose: ReturnType<typeof vi.fn<() => void>>;
const m = () => MESSAGES[state.locale];
const pressables = () => root.root.findAllByType('Pressable' as never);
const button = (label: string) => pressables().find((node) => node.props.accessibilityLabel === label);
const field = (label: string) => root.root.findAllByType('TextInput' as never).find((node) => node.props.accessibilityLabel === label);
const texts = () => root.root.findAllByType('Text' as never).map((node: ReactTestInstance) => node.props.children);
const text = () => JSON.stringify(root.toJSON());
const ayahContext = { verseKey: '2:255', surahNumber: 2, ayahNumber: 255 };

async function render(variant: ReportSheetVariant, context?: typeof ayahContext) {
  await act(async () => { root = create(createElement(ReportIssueSheet, { visible: true, onClose, variant, context })); });
}
async function type(label: string, value: string) {
  await act(async () => field(label)!.props.onChangeText(value));
}
async function press(label: string) {
  await act(async () => { await button(label)!.props.onPress(); });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  state.locale = 'en';
  state.submitIssue.mockReset().mockResolvedValue(undefined);
  state.submitFeedback.mockReset().mockResolvedValue(undefined);
  onClose = vi.fn();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
});

describe('feedback sheet (Home)', () => {
  it('no categories: the feedback title, description, required message, optional email, privacy note, Cancel | Send', async () => {
    await render('feedback');
    expect(texts()).toEqual(expect.arrayContaining([m().feedback.sheetTitle, m().feedback.sheetDescription, m().feedback.privacyNote]));
    expect(field(m().feedback.messageLabel)).toBeDefined();
    expect(field(m().issueReport.emailLabel)).toBeDefined();
    expect(pressables().map((node) => node.props.accessibilityLabel)).toEqual([m().issueReport.cancel, m().feedback.submit]);
    expect(text()).not.toContain(m().issueReport.categoryOther);
  });

  it('requires a message: empty or whitespace-only sends nothing and explains why; typing clears it', async () => {
    await render('feedback');
    await press(m().feedback.submit);
    await type(m().feedback.messageLabel, '   \n ');
    await press(m().feedback.submit);
    expect(state.submitFeedback).not.toHaveBeenCalled();
    const error = root.root.findAllByType('Text' as never).find((node) => node.props.children === m().feedback.messageRequired)!;
    expect(error.props).toMatchObject({ accessibilityLiveRegion: 'polite', accessibilityRole: 'alert' });
    await type(m().feedback.messageLabel, 'A');
    expect(text()).not.toContain(m().feedback.messageRequired);
  });

  it('an invalid optional email is caught before sending; an empty one is simply left out', async () => {
    await render('feedback');
    await type(m().feedback.messageLabel, 'Great app');
    await type(m().issueReport.emailLabel, 'not-an-email');
    await press(m().feedback.submit);
    expect(state.submitFeedback).not.toHaveBeenCalled();
    expect(text()).toContain(m().issueReport.emailInvalid);
    await type(m().issueReport.emailLabel, '  ');
    await press(m().feedback.submit);
    expect(state.submitFeedback).toHaveBeenCalledWith({ comment: 'Great app', email: undefined, appLocale: 'en' });
  });

  it('sends only the trimmed message, the email and the App Language — never an issue, an ayah or anything private', async () => {
    await render('feedback', ayahContext);
    await type(m().feedback.messageLabel, '  Please add tafsir.  ');
    await type(m().issueReport.emailLabel, ' me@example.com ');
    await press(m().feedback.submit);
    expect(state.submitIssue).not.toHaveBeenCalled();
    expect(state.submitFeedback).toHaveBeenCalledTimes(1);
    expect(state.submitFeedback.mock.calls[0][0]).toEqual({ comment: 'Please add tafsir.', email: 'me@example.com', appLocale: 'en' });
  });

  it('success only after the backend accepted it; two taps in the same moment send once', async () => {
    let finish!: () => void;
    state.submitFeedback.mockImplementationOnce(() => new Promise<void>((done) => { finish = done; }));
    await render('feedback');
    await type(m().feedback.messageLabel, 'Thank you');
    await act(async () => {
      void button(m().feedback.submit)!.props.onPress();
      void button(m().feedback.submit)!.props.onPress();
    });
    expect(state.submitFeedback).toHaveBeenCalledTimes(1);
    expect(button(m().feedback.submit)!.props).toMatchObject({ disabled: true, accessibilityState: { disabled: true, busy: true } });
    expect(text()).not.toContain(m().feedback.successMessage);
    await act(async () => finish());
    expect(text()).toContain(m().feedback.successMessage);
    expect(pressables().map((node) => node.props.accessibilityLabel)).toEqual([m().issueReport.done]);
  });

  it('a failure (offline, rate-limited) keeps everything entered, shows the feedback error and allows a retry', async () => {
    state.submitFeedback.mockRejectedValueOnce(new Error('429'));
    await render('feedback');
    await type(m().feedback.messageLabel, 'Keep this text');
    await type(m().issueReport.emailLabel, 'me@example.com');
    await press(m().feedback.submit);
    expect(text()).toContain(m().feedback.failureMessage);
    expect(text()).not.toContain(m().feedback.successMessage);
    expect(field(m().feedback.messageLabel)!.props.value).toBe('Keep this text');
    expect(field(m().issueReport.emailLabel)!.props.value).toBe('me@example.com');
    await press(m().feedback.submit);
    expect(state.submitFeedback).toHaveBeenCalledTimes(2);
    expect(text()).toContain(m().feedback.successMessage);
  });

  it('Arabic: right-to-left, Standard Arabic copy, and the App Language is what is sent', async () => {
    state.locale = 'ar';
    await render('feedback');
    const title = root.root.findAllByType('Text' as never).find((node) => node.props.children === 'شاركنا رأيك')!;
    expect(title.props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
    expect(field('شاركنا رأيك أو اقتراحاتك...')!.props.style).toContainEqual({ writingDirection: 'rtl', textAlign: 'right' });
    await type('شاركنا رأيك أو اقتراحاتك...', 'جزاكم الله خيرًا');
    await press('إرسال الملاحظات');
    expect(state.submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ appLocale: 'ar' }));
    expect(text()).toContain('شكرًا لمشاركتنا رأيك!');
  });
});

describe('contextual ayah report (the flag action)', () => {
  it('shows which ayah is attached, all five categories, and requires a description', async () => {
    await render('ayah', ayahContext);
    expect(texts()).toEqual(expect.arrayContaining([m().issueReport.aboutAyah, 'Al-Baqara · 2:255 · البقرة']));
    for (const label of [m().issueReport.categoryAyahNotRelevant, m().issueReport.categoryQuranTextDisplay, m().issueReport.categoryTranslationIssue, m().issueReport.categoryAppTechnicalIssue, m().issueReport.categoryOther]) {
      expect(button(label)).toBeDefined();
    }
    await press(m().issueReport.submit);
    expect(state.submitIssue).not.toHaveBeenCalled();
    expect(text()).toContain(m().issueReport.commentRequired);
  });

  it('sends the surah, ayah, verse reference and source with the description — no translation id, nothing private', async () => {
    await render('ayah', ayahContext);
    await press(m().issueReport.categoryQuranTextDisplay);
    await type(m().issueReport.commentLabel, ' A word looks misplaced. ');
    await press(m().issueReport.submit);
    expect(state.submitIssue.mock.calls[0][0]).toEqual({
      source: 'ayah', category: 'quran_text_display', comment: 'A word looks misplaced.', email: undefined,
      verseKey: '2:255', surahNumber: 2, ayahNumber: 255,
      appLocale: 'en', translationDisplayMode: 'on-demand',
    });
    expect(text()).toContain(m().issueReport.successMessage);
  });

  it('the reference keeps its fixed left-to-right order in Arabic', async () => {
    state.locale = 'ar';
    await render('ayah', ayahContext);
    const reference = root.root.findAllByType('Text' as never).find((node) => node.props.children === 'Al-Baqara · 2:255 · البقرة')!;
    expect(reference.props.style.at(-1)).toEqual({ writingDirection: 'ltr' });
  });
});

describe('no emotion key or private data in reports', () => {
  it('an emotion key passed by a caller (as the ayah screen used to) is never sent', async () => {
    await render('ayah', { ...ayahContext, emotionKey: 'hopeless' } as typeof ayahContext);
    await type(m().issueReport.commentLabel, 'Not related.');
    await press(m().issueReport.submit);
    const sent = state.submitIssue.mock.calls[0][0];
    expect(Object.keys(sent).sort()).toEqual(['appLocale', 'ayahNumber', 'category', 'comment', 'email', 'source', 'surahNumber', 'translationDisplayMode', 'verseKey']);
    expect(JSON.stringify(sent)).not.toMatch(/emotion|hopeless/i);
  });

  it('the ayah screen attaches only the ayah reference; emotion selection and connections are untouched', () => {
    const ayahScreen = source('src/components/AyahExperience.tsx');
    const sheetBlock = ayahScreen.match(/<ReportIssueSheet\b[\s\S]*?\/>/)?.[0] ?? '';
    expect(sheetBlock).toMatch(/verseKey: ayah\?\.verseKey,\s*surahNumber: ayah\?\.surahNumber,\s*ayahNumber: ayah\?\.ayahNumber,\s*\}\}/);
    // The comment above the context may say what is left out; no field, value or source.* may carry an emotion.
    expect(sheetBlock.replace(/\/\/.*$/gm, '')).not.toMatch(/emotion|source\./i);
    expect(ayahScreen).toMatch(/getRandomAyah\(source\.emotionKey, exclude\)/);
    expect(ayahScreen).toMatch(/resolveConnectionText\(connection, source\.mode === 'emotion' \? source\.emotionKey : undefined, emotionLocale\)/);
  });

  it('neither the report API nor the sheet has any field for an emotion', () => {
    // Only code is checked: comments may say what is never sent.
    const code = (path: string) => source(path).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    expect(code('src/services/issueReportApi.ts')).not.toMatch(/emotion/i);
    expect(code('src/components/ReportIssueSheet.tsx')).not.toMatch(/emotion/i);
  });
});

describe('general issue report (Settings)', () => {
  it('no ayah: no reference shown, no "ayah not relevant" category, technical issue selected first', async () => {
    await render('settings');
    expect(text()).not.toContain(m().issueReport.aboutAyah);
    expect(button(m().issueReport.categoryAyahNotRelevant)).toBeUndefined();
    expect(button(m().issueReport.categoryAppTechnicalIssue)!.props.accessibilityState).toEqual({ selected: true });
    expect(texts()).toContain(m().issueReport.settingsDescription);
  });

  it('sends a general issue from Settings with no ayah fields', async () => {
    await render('settings');
    await type(m().issueReport.commentLabel, 'The app closes when I open the Mushaf.');
    await press(m().issueReport.submit);
    expect(state.submitIssue.mock.calls[0][0]).toEqual({
      source: 'settings', category: 'app_technical_issue', comment: 'The app closes when I open the Mushaf.', email: undefined, appLocale: 'en', translationDisplayMode: 'on-demand',
    });
  });
});

describe('entry points', () => {
  const home = source('src/app/(tabs)/index.tsx');
  const ayah = source('src/components/AyahExperience.tsx');
  const settings = source('src/app/settings.tsx');
  const sheet = source('src/components/ReportIssueSheet.tsx');

  it('Home: only the Share Feedback action, immediately after A Message from the Quran and before the sources footer — no heading, description or card', () => {
    const at = (needle: string) => home.indexOf(needle);
    const ordered = ['<ContinueReadingCard />', 'testID="home-emotions"', 'testID="home-view-all"', "router.push('/ayah/general')", 'testID="home-feedback"', 'testID="home-sources"'].map(at);
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
    const block = home.slice(at('testID="home-feedback"'), at('testID="home-sources"'));
    // One button holding one icon and one label; no other text.
    expect(block.match(/<(Pressable|Text)\b/g)).toEqual(['<Pressable', '<Text']);
    expect(block).toMatch(/<Text style=\{styles\.feedbackButtonText\}>\{messages\.feedback\.action\}<\/Text>/);
    expect(home).not.toMatch(/feedbackTitle|feedbackDescription|homeTitle|homeDescription|styles\.feedback\b/);
    expect(home).toMatch(/accessibilityLabel=\{messages\.feedback\.action\}\s*onPress=\{\(\) => setIsFeedbackVisible\(true\)\}/);
    expect(home.match(/setIsFeedbackVisible\(true\)/g)).toHaveLength(1); // one Feedback action, no duplicate
    expect(home).toContain('<ReportIssueSheet visible={isFeedbackVisible} onClose={() => setIsFeedbackVisible(false)} variant="feedback" />');
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      expect(MESSAGES[locale].feedback).not.toHaveProperty('homeTitle');
      expect(MESSAGES[locale].feedback).not.toHaveProperty('homeDescription');
    }
  });

  it('Home: styled exactly like the ayah screen Report an Issue — same values, icon treatment, touch target and pressed state, in the palette (Light and Dark), mirrored in Arabic', () => {
    const body = (src: string, name: string) => src.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1] ?? null;
    for (const [mine, theirs] of [['feedbackActions', 'tertiaryActions'], ['feedbackButton', 'tertiaryButton'], ['feedbackButtonRtl', 'tertiaryButtonRtl'], ['feedbackButtonText', 'tertiaryButtonText'], ['feedbackPressed', 'pressed']]) {
      expect(body(home, mine), mine).not.toBeNull();
      expect(body(home, mine), mine).toBe(body(ayah, theirs));
    }
    // Text in the palette's secondary colour (so it follows Light and Dark), no literal colours.
    expect(body(home, 'feedbackButtonText')).toMatch(/color: colors\.textSecondary/);
    // The same icon treatment: 14 pt, secondary colour, stroke 2 (a speech bubble here, the flag there).
    expect(home).toMatch(/<MessageSquare size=\{14\} color=\{colors\.textSecondary\} strokeWidth=\{2\} \/>/);
    expect(ayah).toMatch(/<Flag size=\{14\} color=\{colors\.textSecondary\} strokeWidth=\{2\} \/>/);
    // Same touch target and mirroring.
    expect(home).toMatch(/hitSlop=\{4\}\s*style=\{\(\{ pressed \}\) => \[styles\.feedbackButton, isRtl && styles\.feedbackButtonRtl, pressed && styles\.feedbackPressed\]\}/);
    expect(ayah).toMatch(/hitSlop=\{4\}\s*style=\{\(\{ pressed \}\) => \[styles\.tertiaryButton, isRtl && styles\.tertiaryButtonRtl, pressed && styles\.pressed\]\}/);
  });

  it('ayah screen: the discreet flag action sits below Share | Add Reflection | Favorite, whose order is unchanged', () => {
    const at = (needle: string) => ayah.indexOf(needle);
    const ordered = ['accessibilityLabel={messages.ayah.shareAyah}', 'accessibilityLabel={messages.reflection.writeAction}', '<FavoriteButton', '<View style={styles.tertiaryActions}>', 'accessibilityLabel={messages.issueReport.flagAction}'].map(at);
    expect(ordered.every((index) => index >= 0)).toBe(true);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
    const primaryRow = ayah.slice(at('<View style={styles.actions}>'), at('{connectionText'));
    expect(primaryRow).not.toMatch(/issueReport|Flag/);
    expect(ayah).toMatch(/<Flag size=\{14\} color=\{colors\.textSecondary\}/);
    expect(ayah).toMatch(/<ReportIssueSheet\s+visible=\{isReportVisible\}\s+onClose=\{\(\) => setIsReportVisible\(false\)\}\s+variant="ayah"/);
  });

  it('Settings keeps a single Report an issue entry on the same sheet: one reporting system', () => {
    expect(settings).toContain('<ReportIssueSheet visible={isReportVisible} onClose={() => setIsReportVisible(false)} variant="settings" />');
    for (const screen of [home, ayah, settings]) expect(screen).not.toMatch(/fetch\(|\/api\/issues/);
    // One request, to one endpoint, for feedback and issues alike.
    const api = source('src/services/issueReportApi.ts');
    expect(api.match(/fetch\(/g)).toHaveLength(1);
    expect(api).toContain('await fetch(`${apiBaseUrl}/api/issues`');
  });

  it('the sheet never reads private data or the Emotions Language: only the App Language and the translation preference', () => {
    const imports = sheet.match(/^import .*$/gm)!.join('\n');
    expect(imports).not.toMatch(/ayahReflections|reflection|khatma|readingStops|readingSync|favorites|recentEmotions|recentAyah|useAuth|tokenManager|useEmotionsLanguage|emotionsLanguage/i);
    expect(imports).toMatch(/useAppLocale/);
  });
});

describe('localization', () => {
  it('every approved English and Standard Arabic string, exactly (Egyptian Arabic shows the Standard Arabic)', () => {
    const approved = {
      en: { action: 'Share Feedback', sheetTitle: 'Share Feedback', messageLabel: 'Share your thoughts or suggestions...', submit: 'Send Feedback', successMessage: 'Thank you for your feedback!' },
      ar: { action: 'شاركنا رأيك', sheetTitle: 'شاركنا رأيك', messageLabel: 'شاركنا رأيك أو اقتراحاتك...', submit: 'إرسال الملاحظات', successMessage: 'شكرًا لمشاركتنا رأيك!' },
    };
    expect(MESSAGES.en.feedback).toMatchObject(approved.en);
    expect(MESSAGES.ar.feedback).toMatchObject(approved.ar);
    expect(MESSAGES['ar-EG'].feedback).toMatchObject(approved.ar);
    expect(MESSAGES.en.issueReport.action).toBe('Report an Issue');
    expect(MESSAGES.ar.issueReport.action).toBe('الإبلاغ عن مشكلة');
    expect(MESSAGES['ar-EG'].issueReport.action).toBe('الإبلاغ عن مشكلة');
  });

  it('the ten final approved reporting strings, exactly, in English and Standard Arabic (ar-EG shows the Standard Arabic)', () => {
    const approved = {
      en: {
        feedback: {
          sheetDescription: 'Share your ideas to help us improve Quran Heals.',
          privacyNote: "Please don't include sensitive personal information.",
          messageRequired: 'Please enter your feedback.',
          failureMessage: "Couldn't send your feedback. Please try again.",
        },
        issueReport: {
          aboutAyah: 'This report includes the ayah:',
          commentLabel: 'Describe the problem...',
          commentRequired: 'Please describe the problem.',
          emailInvalid: 'Please enter a valid email address.',
          flagAction: 'Report an issue with this ayah',
          settingsDescription: "Let us know if something isn't working properly.",
        },
      },
      ar: {
        feedback: {
          sheetDescription: 'شاركنا أفكارك لنطوّر Quran Heals معًا.',
          privacyNote: 'يُرجى عدم مشاركة معلومات شخصية هامة.',
          messageRequired: 'يُرجى كتابة رأيك أو اقتراحك.',
          failureMessage: 'تعذّر إرسال ملاحظاتك. يُرجى المحاولة مرة أخرى.',
        },
        issueReport: {
          aboutAyah: 'يتضمن هذا البلاغ الآية:',
          commentLabel: 'ما هي المشكلة؟',
          commentRequired: 'يُرجى وصف المشكلة.',
          emailInvalid: 'يُرجى إدخال بريد إلكتروني صحيح.',
          flagAction: 'الإبلاغ عن مشكلة في هذه الآية',
          settingsDescription: 'أخبرنا إذا واجهتك مشكلة في التطبيق.',
        },
      },
    };
    for (const [locale, copy] of [['en', approved.en], ['ar', approved.ar], ['ar-EG', approved.ar]] as const) {
      expect(MESSAGES[locale].feedback, locale).toMatchObject(copy.feedback);
      expect(MESSAGES[locale].issueReport, locale).toMatchObject(copy.issueReport);
    }
  });

  it('the issue description field shows the approved placeholder, also as its screen-reader label', async () => {
    await render('ayah', ayahContext);
    expect(field('Describe the problem...')!.props.placeholder).toBe('Describe the problem...');
  });

  it('the feedback message field shows the approved placeholder and is labelled with it for screen readers', async () => {
    await render('feedback');
    expect(field(m().feedback.messageLabel)!.props.placeholder).toBe('Share your thoughts or suggestions...');
    expect(button('Send Feedback')).toBeDefined();
    expect(button(m().issueReport.cancel)).toBeDefined();
  });

  it('the approved English button', () => {
    expect(MESSAGES.en.feedback.action).toBe('Share Feedback');
  });

  it('every new string exists in English and Arabic; Egyptian Arabic keeps the Standard Arabic wording for this general UI', () => {
    for (const section of ['feedback', 'issueReport'] as const) {
      const keys = Object.keys(MESSAGES.en[section]).sort();
      expect(Object.keys(MESSAGES.ar[section]).sort()).toEqual(keys);
      expect(MESSAGES['ar-EG'][section]).toEqual(MESSAGES.ar[section]);
      for (const key of keys) {
        expect((MESSAGES.en[section] as Record<string, string>)[key].trim().length, `${section}.${key}`).toBeGreaterThan(0);
        expect((MESSAGES.ar[section] as Record<string, string>)[key], `${section}.${key}`).toMatch(/[؀-ۿ]/);
      }
    }
  });

  it('existing reporting copy is unchanged apart from the approved title case', () => {
    expect(MESSAGES.en.issueReport.action).toBe('Report an Issue');
    expect(MESSAGES.en.issueReport.cancel).toBe('Cancel');
    expect(MESSAGES.ar.issueReport.cancel).toBe('إلغاء');
    expect(MESSAGES.en.issueReport.successMessage).toBe('Thank you. Your report has been received.');
    expect(MESSAGES.ar.issueReport.action).toBe('الإبلاغ عن مشكلة');
    expect(MESSAGES.en.generalQuran.action).toBe('A Message from the Quran');
  });
});
