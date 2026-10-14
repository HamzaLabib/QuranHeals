import { Check } from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { submitFeedback, submitIssueReport, type IssueReportCategory } from '@/services/issueReportApi';
import { formatAyahReference } from '@/utils/ayahReference';

/**
 * The one reporting sheet, opened from three places:
 *  - 'ayah': the ayah screen's flag action — an issue with that ayah attached;
 *  - 'settings': Settings' Report an issue — a general or technical issue;
 *  - 'feedback': Home's Share Feedback — general feedback, no category.
 */
export type ReportSheetVariant = 'ayah' | 'settings' | 'feedback';

const CATEGORIES: Record<Exclude<ReportSheetVariant, 'feedback'>, IssueReportCategory[]> = {
  ayah: ['ayah_not_relevant', 'quran_text_display', 'translation_issue', 'app_technical_issue', 'other'],
  // No ayah is attached from Settings, so "this ayah doesn't feel relevant" can't apply.
  settings: ['app_technical_issue', 'quran_text_display', 'translation_issue', 'other'],
};

// Light client-side check so a typo is caught before sending; the backend validates again.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MESSAGE_MAX_LENGTH = 2000;

type ReportIssueSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Defaults to 'ayah', the original use. */
  variant?: ReportSheetVariant;
  /** The reported ayah's reference ('ayah' only). Never the emotion that led to it. */
  context?: {
    verseKey?: string;
    surahNumber?: number;
    ayahNumber?: number;
  };
};

/**
 * Completely separate from ReflectionSheet/خواطر (Part I §34) — this
 * component never imports storage/ayahReflections.ts, Khatma or reading
 * data, and its input types (IssueReportInput, FeedbackInput) have no field
 * that could carry reflection, reading or account content (Part I §38).
 * Works with or without an account (§34/§37). Uses the App Language
 * (useAppLocale), never the Emotions Language.
 */
export function ReportIssueSheet({ visible, onClose, variant = 'ayah', context = {} }: ReportIssueSheetProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const { preference } = useQuranTranslationPreference();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const isFeedback = variant === 'feedback';
  const categories = variant === 'feedback' ? [] : CATEGORIES[variant];

  const [category, setCategory] = useState<IssueReportCategory>(categories[0] ?? 'other');
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  const [invalid, setInvalid] = useState<'comment' | 'email' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const commentFieldYRef = useRef(0);
  const emailFieldYRef = useRef(0);
  // Identifies the report being edited: a response for one that was closed
  // meanwhile never changes the next one.
  const reportIdRef = useRef(0);
  // Set synchronously, so two taps in the same frame (before a re-render
  // disables Submit) can never send twice.
  const sendingRef = useRef(false);

  // Each opening is a new report: empty form, nothing sent yet.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setCategory(categories[0] ?? 'other');
      setComment('');
      setEmail('');
      setIsSubmitting(false);
      setResult(null);
      setInvalid(null);
    }
  }

  // Scrolls so the field starting at `fieldY` (captured via that field's
  // wrapper onLayout, in content-container coordinates) sits just below the
  // top of the scroll viewport — used on focus so the newly active field
  // moves above the keyboard without a manual scroll.
  const scrollToField = (fieldY: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(fieldY - spacing.md, 0), animated: true });
  };

  if (!visible) return null;

  const categoryLabel: Record<IssueReportCategory, string> = {
    ayah_not_relevant: messages.issueReport.categoryAyahNotRelevant,
    quran_text_display: messages.issueReport.categoryQuranTextDisplay,
    translation_issue: messages.issueReport.categoryTranslationIssue,
    app_technical_issue: messages.issueReport.categoryAppTechnicalIssue,
    other: messages.issueReport.categoryOther,
  };

  const copy = isFeedback
    ? {
        title: messages.feedback.sheetTitle,
        description: messages.feedback.sheetDescription,
        commentLabel: messages.feedback.messageLabel,
        commentRequired: messages.feedback.messageRequired,
        submit: messages.feedback.submit,
        success: messages.feedback.successMessage,
        failure: messages.feedback.failureMessage,
      }
    : {
        title: messages.issueReport.action,
        description: variant === 'settings' ? messages.issueReport.settingsDescription : messages.issueReport.description,
        commentLabel: messages.issueReport.commentLabel,
        commentRequired: messages.issueReport.commentRequired,
        submit: messages.issueReport.submit,
        success: messages.issueReport.successMessage,
        failure: messages.issueReport.failureMessage,
      };
  const ayahReference =
    variant === 'ayah' && context.surahNumber && context.ayahNumber ? formatAyahReference(context.surahNumber, context.ayahNumber) : null;

  const close = () => {
    reportIdRef.current += 1;
    sendingRef.current = false;
    setComment('');
    setEmail('');
    setIsSubmitting(false);
    setResult(null);
    setInvalid(null);
    onClose();
  };

  const submit = async () => {
    if (sendingRef.current) return;
    const message = comment.trim();
    const contact = email.trim();
    // A description is required; nothing is sent without one.
    if (message.length === 0) {
      setInvalid('comment');
      setResult(null);
      return;
    }
    if (contact.length > 0 && !EMAIL_PATTERN.test(contact)) {
      setInvalid('email');
      setResult(null);
      return;
    }
    const reportId = reportIdRef.current;
    sendingRef.current = true;
    setInvalid(null);
    setIsSubmitting(true);
    setResult(null);
    try {
      if (variant === 'feedback') {
        await submitFeedback({ comment: message, email: contact || undefined, appLocale: locale });
      } else if (variant === 'settings') {
        await submitIssueReport({
          source: 'settings',
          category,
          comment: message,
          email: contact || undefined,
          appLocale: locale,
          translationDisplayMode: preference.displayMode,
        });
      } else {
        await submitIssueReport({
          source: 'ayah',
          category,
          comment: message,
          email: contact || undefined,
          verseKey: context.verseKey,
          surahNumber: context.surahNumber,
          ayahNumber: context.ayahNumber,
          appLocale: locale,
          translationDisplayMode: preference.displayMode,
        });
      }
      // Shown only once the backend has accepted it.
      if (reportId === reportIdRef.current) setResult('success');
    } catch {
      // The form stays as entered, so the user can simply try again.
      if (reportId === reportIdRef.current) setResult('failure');
    } finally {
      if (reportId === reportIdRef.current) {
        sendingRef.current = false;
        setIsSubmitting(false);
      }
    }
  };

  const isSent = result === 'success';

  return (
   <Modal visible transparent animationType="slide" onRequestClose={close}>
  <KeyboardAvoidingView
    style={styles.backdrop}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={0}>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.sheet}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={[styles.title, direction]}>
              {copy.title}
            </Text>

            {!isSent && <>
            <Text style={[styles.description, direction]}>
              {copy.description}
            </Text>

            {ayahReference && (
              <View style={styles.reportedAyah}>
                <Text style={[styles.reportedAyahLabel, direction]}>{messages.issueReport.aboutAyah}</Text>
                <Text style={[styles.reportedAyahReference, direction, styles.ltr]}>{ayahReference}</Text>
              </View>
            )}

            {categories.length > 0 && (
            <View style={styles.optionList}>
              {categories.map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: category === option }}
                  accessibilityLabel={categoryLabel[option]}
                  onPress={() => setCategory(option)}
                  style={({ pressed }) => [
                    styles.optionRow,
                    isRtl && styles.optionRowRtl,
                    category === option && styles.optionRowSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.optionLabel, direction]}>
                    {categoryLabel[option]}
                  </Text>

                  {category === option && (
                    <Check
                      size={18}
                      color={colors.accent}
                      strokeWidth={2.5}
                    />
                  )}
                </Pressable>
              ))}
            </View>
            )}

            <View
              onLayout={(e) => {
                commentFieldYRef.current = e.nativeEvent.layout.y;
              }}>
              <TextInput
                value={comment}
                onChangeText={(value) => {
                  setComment(value);
                  if (invalid === 'comment') setInvalid(null);
                }}
                onFocus={() => scrollToField(commentFieldYRef.current)}
                onContentSizeChange={() =>
                  scrollRef.current?.scrollToEnd({ animated: true })
                }
                multiline
                maxLength={MESSAGE_MAX_LENGTH}
                placeholder={copy.commentLabel}
                placeholderTextColor={colors.placeholder}
                style={[styles.input, styles.commentInput, invalid === 'comment' && styles.inputInvalid, direction]}
                accessibilityLabel={copy.commentLabel}
              />
              {invalid === 'comment' && (
                <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.fieldError, direction]}>
                  {copy.commentRequired}
                </Text>
              )}
            </View>

            <View
              onLayout={(e) => {
                emailFieldYRef.current = e.nativeEvent.layout.y;
              }}>
              <TextInput
                value={email}
                onChangeText={(value) => {
                  setEmail(value);
                  if (invalid === 'email') setInvalid(null);
                }}
                onFocus={() => scrollToField(emailFieldYRef.current)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                maxLength={254}
                placeholder={messages.issueReport.emailLabel}
                placeholderTextColor={colors.placeholder}
                style={[styles.input, invalid === 'email' && styles.inputInvalid, direction]}
                accessibilityLabel={messages.issueReport.emailLabel}
              />
              {invalid === 'email' && (
                <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.fieldError, direction]}>
                  {messages.issueReport.emailInvalid}
                </Text>
              )}
            </View>

            {isFeedback && (
              <Text style={[styles.description, direction]}>
                {messages.feedback.privacyNote}
              </Text>
            )}
            </>}

            {isSent && (
              <Text accessibilityLiveRegion="polite" style={[styles.successText, direction]}>
                {copy.success}
              </Text>
            )}

            {result === 'failure' && (
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.failureText, direction]}>
                {copy.failure}
              </Text>
            )}

            {isSent ? (
              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={messages.issueReport.done}
                  onPress={close}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <Text style={styles.primaryButtonText}>
                    {messages.issueReport.done}
                  </Text>
                </Pressable>
              </View>
            ) : (
            <View style={[styles.actions, isRtl && styles.actionsRtl]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.issueReport.cancel}
                onPress={close}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.secondaryButtonText}>
                  {messages.issueReport.cancel}
                </Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.submit}
                accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
                disabled={isSubmitting}
                onPress={submit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {copy.submit}
                </Text>
              </Pressable>
            </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  </KeyboardAvoidingView>
</Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    maxHeight: '90%',
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  optionList: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  optionRow: {
    alignItems: 'center',
    borderBottomColor: colors.divider,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  optionRowRtl: {
    flexDirection: 'row-reverse',
  },
  optionRowSelected: {
    backgroundColor: colors.accentSoft,
  },
  optionLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  commentInput: {
    minHeight: 100,
    paddingTop: spacing.sm,
    textAlignVertical: 'top',
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  fieldError: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  reportedAyah: {
    gap: 2,
  },
  reportedAyahLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  reportedAyahReference: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  // The reference's fixed English · number · Arabic order (see formatAyahReference).
  ltr: {
    writingDirection: 'ltr',
  },
  successText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
    lineHeight: 22,
  },
  failureText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
