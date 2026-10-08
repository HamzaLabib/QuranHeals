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
import { submitIssueReport, type IssueReportCategory } from '@/services/issueReportApi';

const CATEGORIES: IssueReportCategory[] = [
  'ayah_not_relevant',
  'quran_text_display',
  'translation_issue',
  'app_technical_issue',
  'other',
];

type ReportIssueSheetProps = {
  visible: boolean;
  onClose: () => void;
  context: {
    verseKey?: string;
    surahNumber?: number;
    ayahNumber?: number;
    emotionKey?: string;
  };
};

/**
 * Completely separate from ReflectionSheet/خواطر (Part I §34) — this
 * component never imports storage/ayahReflections.ts and its input type
 * (IssueReportInput) has no field that could carry reflection content
 * (Part I §38). Works with or without an account (§34/§37).
 */
export function ReportIssueSheet({ visible, onClose, context }: ReportIssueSheetProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const { preference } = useQuranTranslationPreference();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);

  const [category, setCategory] = useState<IssueReportCategory>('ayah_not_relevant');
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const commentFieldYRef = useRef(0);
  const emailFieldYRef = useRef(0);
  // Identifies the report being edited: a response for one that was closed
  // meanwhile never changes the next one.
  const reportIdRef = useRef(0);

  // Each opening is a new report: empty form, nothing sent yet.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setCategory('ayah_not_relevant');
      setComment('');
      setEmail('');
      setIsSubmitting(false);
      setResult(null);
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

  const close = () => {
    reportIdRef.current += 1;
    setComment('');
    setEmail('');
    setIsSubmitting(false);
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (isSubmitting) return;
    const reportId = reportIdRef.current;
    setIsSubmitting(true);
    setResult(null);
    try {
      await submitIssueReport({
        category,
        comment: comment.trim().length > 0 ? comment.trim() : undefined,
        email: email.trim().length > 0 ? email.trim() : undefined,
        verseKey: context.verseKey,
        surahNumber: context.surahNumber,
        ayahNumber: context.ayahNumber,
        emotionKey: context.emotionKey,
        appLocale: locale,
        translationDisplayMode: preference.displayMode,
      });
      if (reportId === reportIdRef.current) setResult('success');
    } catch {
      // The form stays as entered, so the user can simply try again.
      if (reportId === reportIdRef.current) setResult('failure');
    } finally {
      if (reportId === reportIdRef.current) setIsSubmitting(false);
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
            <Text style={[styles.title, direction]}>
              {messages.issueReport.action}
            </Text>

            {!isSent && <>
            <Text style={[styles.description, direction]}>
              {messages.issueReport.description}
            </Text>

            <View style={styles.optionList}>
              {CATEGORIES.map((option) => (
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

            <View
              onLayout={(e) => {
                commentFieldYRef.current = e.nativeEvent.layout.y;
              }}>
              <TextInput
                value={comment}
                onChangeText={setComment}
                onFocus={() => scrollToField(commentFieldYRef.current)}
                onContentSizeChange={() =>
                  scrollRef.current?.scrollToEnd({ animated: true })
                }
                multiline
                maxLength={2000}
                placeholder={messages.issueReport.description}
                placeholderTextColor={colors.placeholder}
                style={[styles.input, styles.commentInput, direction]}
                accessibilityLabel={messages.issueReport.description}
              />
            </View>

            <View
              onLayout={(e) => {
                emailFieldYRef.current = e.nativeEvent.layout.y;
              }}>
              <TextInput
                value={email}
                onChangeText={setEmail}
                onFocus={() => scrollToField(emailFieldYRef.current)}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => Keyboard.dismiss()}
                placeholder={messages.issueReport.emailLabel}
                placeholderTextColor={colors.placeholder}
                style={[styles.input, direction]}
                accessibilityLabel={messages.issueReport.emailLabel}
              />
            </View>
            </>}

            {isSent && (
              <Text accessibilityLiveRegion="polite" style={[styles.successText, direction]}>
                {messages.issueReport.successMessage}
              </Text>
            )}

            {result === 'failure' && (
              <Text style={[styles.failureText, direction]}>
                {messages.issueReport.failureMessage}
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
                accessibilityLabel={messages.issueReport.submit}
                disabled={isSubmitting}
                onPress={submit}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSubmitting && styles.disabled,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.primaryButtonText}>
                  {messages.issueReport.submit}
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
