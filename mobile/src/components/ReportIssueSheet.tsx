import { Check } from 'lucide-react-native';
import { useState } from 'react';
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

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
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
  const { locale, messages } = useAppLocale();
  const { preference } = useQuranTranslationPreference();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);

  const [category, setCategory] = useState<IssueReportCategory>('ayah_not_relevant');
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);

  if (!visible) return null;

  const categoryLabel: Record<IssueReportCategory, string> = {
    ayah_not_relevant: messages.issueReport.categoryAyahNotRelevant,
    quran_text_display: messages.issueReport.categoryQuranTextDisplay,
    translation_issue: messages.issueReport.categoryTranslationIssue,
    app_technical_issue: messages.issueReport.categoryAppTechnicalIssue,
    other: messages.issueReport.categoryOther,
  };

  const close = () => {
    setComment('');
    setEmail('');
    setResult(null);
    onClose();
  };

  const submit = async () => {
    if (isSubmitting) return;
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
      setResult('success');
    } catch {
      setResult('failure');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      {/* See ReflectionSheet.tsx's matching comment — same shared bottom-sheet-over-Modal pattern and the same keyboard-overlap fix. */}
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Tap outside the fields dismisses the keyboard only — Cancel is
            still a deliberate, separate button press; this never closes
            the sheet itself. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <Text style={[styles.title, direction]}>{messages.issueReport.action}</Text>
                <Text style={[styles.description, direction]}>{messages.issueReport.description}</Text>

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
                      <Text style={[styles.optionLabel, direction]}>{categoryLabel[option]}</Text>
                      {category === option && <Check size={18} color={colors.olive} strokeWidth={2.5} />}
                    </Pressable>
                  ))}
                </View>

                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  multiline
                  maxLength={2000}
                  placeholder={messages.issueReport.description}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, styles.commentInput, direction]}
                  accessibilityLabel={messages.issueReport.description}
                />

                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  placeholder={messages.issueReport.emailLabel}
                  placeholderTextColor={colors.muted}
                  style={[styles.input, direction]}
                  accessibilityLabel={messages.issueReport.emailLabel}
                />

                {result === 'success' && <Text style={[styles.successText, direction]}>{messages.issueReport.successMessage}</Text>}
                {result === 'failure' && <Text style={[styles.failureText, direction]}>{messages.issueReport.failureMessage}</Text>}

                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.issueReport.cancel}
                    onPress={close}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>{messages.issueReport.cancel}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.issueReport.submit}
                    disabled={isSubmitting}
                    onPress={submit}
                    style={({ pressed }) => [styles.primaryButton, isSubmitting && styles.disabled, pressed && styles.pressed]}>
                    <Text style={styles.primaryButtonText}>{messages.issueReport.submit}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(31, 42, 36, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    maxHeight: '90%',
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  description: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  optionList: {
    backgroundColor: colors.parchment,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  optionRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
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
    backgroundColor: colors.oliveWash,
  },
  optionLabel: {
    color: colors.ink,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.parchment,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
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
    color: colors.olive,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  failureText: {
    color: colors.rust,
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
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  disabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
