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

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { submitFeedback, submitIssueReport, type AudioIssueProblem, type IssueReportCategory } from '@/services/issueReportApi';
import { audioEngine } from '@/audio/index';
import { useFavoriteReciter } from '@/audio/useFavoriteReciter';
import { AudioIssueDetails } from '@/audioIssue/AudioIssueDetails';
import { AUDIO_ISSUE_PROBLEMS, audioIssueContext, type AudioIssueContext } from '@/audioIssue/context';
import { audioIssueLabels } from '@/audioIssue/labels';
import { formatAyahReference } from '@/utils/ayahReference';
import { SheetSafeArea } from '@/layout/SheetSafeArea';
import { useKeyboardAvoidingKey } from '@/layout/useDismissKeyboardOnResize';

/**
 * The one reporting sheet, opened from three places:
 *  - 'ayah': the ayah screen's flag action — an issue with that ayah attached;
 *  - 'settings': Settings' Report an issue — a general or technical issue;
 *  - 'feedback': Home's Share Feedback — general feedback, no category;
 *  - 'audio': the ayah screen's Audio Issue — an Audio Issue with that ayah and its recording attached.
 * An Audio Issue (from 'audio', or chosen in Settings) attaches its recording's context (audioIssue/context.ts, read
 * when the sheet opens) and is reviewed before it is sent.
 */
export type ReportSheetVariant = 'ayah' | 'settings' | 'feedback' | 'audio';

const CATEGORIES: Record<Exclude<ReportSheetVariant, 'feedback'>, IssueReportCategory[]> = {
  ayah: ['ayah_not_relevant', 'quran_text_display', 'translation_issue', 'app_technical_issue', 'other'],
  // No ayah is attached from Settings, so "this ayah doesn't feel relevant" can't apply.
  settings: ['app_technical_issue', 'audio_issue', 'quran_text_display', 'translation_issue', 'other'],
  // The one category, so no list is shown.
  audio: ['audio_issue'],
};

// Light client-side check so a typo is caught before sending; the backend validates again.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MESSAGE_MAX_LENGTH = 2000;

type ReportIssueSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Defaults to 'ayah', the original use. */
  variant?: ReportSheetVariant;
  /** The reported ayah's reference ('ayah' and 'audio' only). Never the emotion that led to it. */
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
  // Measured afresh after a rotation or resize (layout/useDismissKeyboardOnResize.ts).
  const keyboardKey = useKeyboardAvoidingKey(visible);
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
  const [invalid, setInvalid] = useState<'comment' | 'email' | 'problem' | null>(null);
  // Audio Issue: its problem, the context read when the sheet opened, and whether the form or its review is shown.
  const { reciterId: favoriteReciterId } = useFavoriteReciter();
  const [audioProblem, setAudioProblem] = useState<AudioIssueProblem | null>(null);
  const [audioContext, setAudioContext] = useState<AudioIssueContext | null>(null);
  const [reviewing, setReviewing] = useState(false);
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
      setAudioProblem(null);
      setReviewing(false);
      setAudioContext(variant === 'feedback' || variant === 'ayah' ? null : audioIssueContext({
        origin: variant === 'audio' ? 'ayah' : 'settings',
        favoriteReciterId,
        playback: audioEngine.getState(),
        ayah: variant === 'audio' && context.surahNumber && context.ayahNumber ? { surah: context.surahNumber, ayah: context.ayahNumber } : undefined,
      }));
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

  const audioLabels = audioIssueLabels(locale);
  const isAudio = category === 'audio_issue' && audioContext !== null;
  const categoryLabel: Record<IssueReportCategory, string> = {
    ayah_not_relevant: messages.issueReport.categoryAyahNotRelevant,
    quran_text_display: messages.issueReport.categoryQuranTextDisplay,
    translation_issue: messages.issueReport.categoryTranslationIssue,
    app_technical_issue: messages.issueReport.categoryAppTechnicalIssue,
    audio_issue: audioLabels.title,
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
        title: variant === 'audio' ? audioLabels.title : messages.issueReport.action,
        description: isAudio ? audioLabels.description : variant === 'settings' ? messages.issueReport.settingsDescription : messages.issueReport.description,
        commentLabel: messages.issueReport.commentLabel,
        commentRequired: messages.issueReport.commentRequired,
        submit: messages.issueReport.submit,
        success: messages.issueReport.successMessage,
        failure: messages.issueReport.failureMessage,
      };
  const ayahReference =
    (variant === 'ayah' || variant === 'audio') && context.surahNumber && context.ayahNumber ? formatAyahReference(context.surahNumber, context.ayahNumber) : null;

  const close = () => {
    reportIdRef.current += 1;
    sendingRef.current = false;
    setComment('');
    setEmail('');
    setIsSubmitting(false);
    setResult(null);
    setInvalid(null);
    setReviewing(false);
    onClose();
  };

  /** The form's button: an Audio Issue goes to its review first (nothing sent yet); anything else is sent. */
  const submit = () => {
    if (!isAudio || reviewing) return send();
    if (!validate()) return undefined;
    setResult(null);
    setReviewing(true);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    return undefined;
  };

  const validate = () => {
    const message = comment.trim();
    const contact = email.trim();
    if (isAudio && audioProblem === null) {
      setInvalid('problem');
      setResult(null);
      return false;
    }
    // A description is required; nothing is sent without one.
    if (message.length === 0) {
      setInvalid('comment');
      setResult(null);
      return false;
    }
    if (contact.length > 0 && !EMAIL_PATTERN.test(contact)) {
      setInvalid('email');
      setResult(null);
      return false;
    }
    return true;
  };

  const send = async () => {
    if (sendingRef.current) return;
    if (!validate()) {
      setReviewing(false);
      return;
    }
    const message = comment.trim();
    const contact = email.trim();
    const reportId = reportIdRef.current;
    sendingRef.current = true;
    setInvalid(null);
    setIsSubmitting(true);
    setResult(null);
    try {
      if (isAudio && audioContext) {
        await submitIssueReport({
          source: variant === 'audio' ? 'ayah' : 'settings',
          category: 'audio_issue',
          comment: message,
          email: contact || undefined,
          verseKey: audioContext.surah && audioContext.ayah ? `${audioContext.surah}:${audioContext.ayah}` : undefined,
          surahNumber: audioContext.surah,
          ayahNumber: audioContext.ayah,
          audioProblem: audioProblem ?? undefined,
          reciterId: audioContext.reciterId,
          audioSource: audioContext.audioSource,
          playbackContext: audioContext.playbackContext,
          appLocale: locale,
          translationDisplayMode: preference.displayMode,
        });
      } else if (variant === 'feedback') {
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
  const submitLabel = !isAudio ? copy.submit : reviewing ? audioLabels.send : audioLabels.review;

  return (
   <Modal visible transparent animationType="slide" onRequestClose={close}>
  <KeyboardAvoidingView key={keyboardKey}
    style={styles.backdrop}
    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    keyboardVerticalOffset={0}>
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <SheetSafeArea style={styles.safeArea}>
        <View style={styles.sheet}>
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.content}>
            <Text accessibilityRole="header" style={[styles.title, direction]}>
              {copy.title}
            </Text>

            {!isSent && reviewing && audioContext && <>
            <Text testID="audio-issue-review" style={[styles.description, direction]}>
              {audioLabels.reviewTitle}. {audioLabels.reviewNote}
            </Text>
            <AudioIssueDetails
              context={audioContext}
              labels={audioLabels}
              locale={locale}
              rtl={isRtl}
              extra={[
                [audioLabels.problemTitle, audioProblem ? audioLabels.problems[audioProblem] : ''],
                [audioLabels.descriptionLabel, comment.trim()],
                [audioLabels.email, email.trim() || audioLabels.noEmail],
              ]}
            />
            </>}

            {!isSent && !reviewing && <>
            <Text style={[styles.description, direction]}>
              {copy.description}
            </Text>

            {ayahReference && !isAudio && (
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

            {isAudio && audioContext && <>
            <Text style={[styles.reportedAyahLabel, direction]}>{audioLabels.problemTitle}</Text>
            <View testID="audio-issue-problems" style={[styles.optionList, invalid === 'problem' && styles.inputInvalid]}>
              {AUDIO_ISSUE_PROBLEMS.map((option) => (
                <Pressable
                  key={option}
                  testID={`audio-issue-problem-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: audioProblem === option }}
                  accessibilityLabel={audioLabels.problems[option]}
                  onPress={() => {
                    setAudioProblem(option);
                    if (invalid === 'problem') setInvalid(null);
                  }}
                  style={({ pressed }) => [
                    styles.optionRow,
                    isRtl && styles.optionRowRtl,
                    audioProblem === option && styles.optionRowSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.optionLabel, direction]}>{audioLabels.problems[option]}</Text>
                  {audioProblem === option && <Check size={18} color={colors.accent} strokeWidth={2.5} />}
                </Pressable>
              ))}
            </View>
            {invalid === 'problem' && (
              <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.fieldError, direction]}>
                {audioLabels.problemRequired}
              </Text>
            )}
            <AudioIssueDetails context={audioContext} labels={audioLabels} locale={locale} rtl={isRtl} />
            </>}

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
                testID={reviewing ? 'report-edit' : 'report-cancel'}
                accessibilityRole="button"
                accessibilityLabel={reviewing ? audioLabels.edit : messages.issueReport.cancel}
                disabled={reviewing && isSubmitting}
                // The review's Edit goes back to the form as it was; Cancel closes.
                onPress={reviewing ? () => setReviewing(false) : close}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.secondaryButtonText}>
                  {reviewing ? audioLabels.edit : messages.issueReport.cancel}
                </Text>
              </Pressable>

              <Pressable
                testID="report-submit"
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: isSubmitting, busy: isSubmitting }}
                disabled={isSubmitting}
                onPress={submit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {submitLabel}
                </Text>
              </Pressable>
            </View>
            )}
          </ScrollView>
        </View>
      </SheetSafeArea>
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
    backgroundColor: colors.fieldBackground,
    borderColor: colors.fieldBorder,
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
