import { useState } from 'react';
import {
  ActivityIndicator,
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
import { isValidDeleteConfirmation } from '@/utils/deleteAccountConfirmation';

type DeleteAccountSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Called once the backend confirms deletion and local data has been cleared — never before either has actually happened. */
  onDeleted: () => void;
  /**
   * The account's deleteAccount() (useAuth). Passed in rather than read via
   * useAuth here so the Sync Password sheet — rendered by AuthProvider
   * itself — can offer account deletion without an import cycle.
   */
  deleteAccount: () => Promise<void>;
};

/**
 * GitHub-style destructive confirmation: the final button stays disabled
 * until the user types the exact, locale-specific confirmation word (never
 * a partial match, never auto-submitted). Unlike SyncPassphraseSheet, this
 * is an ordinary, cancelable confirmation dialog — Cancel and Android
 * Back both work normally, except while a delete request is actually in
 * flight (see isDeleting below), to avoid leaving the app mid-request in an
 * ambiguous state.
 */
export function DeleteAccountSheet({ visible, onClose, onDeleted, deleteAccount }: DeleteAccountSheetProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [confirmationText, setConfirmationText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!visible) return null;

  const canDelete = isValidDeleteConfirmation(confirmationText, messages.deleteAccount.confirmationWord) && !isDeleting;

  const reset = () => {
    setConfirmationText('');
    setErrorMessage(null);
  };

  const close = () => {
    if (isDeleting) return;
    reset();
    onClose();
  };

  const confirmDelete = async () => {
    if (!canDelete) return;
    setIsDeleting(true);
    setErrorMessage(null);
    try {
      await deleteAccount();
      reset();
      onDeleted();
    } catch {
      // Network/backend failure — local session is untouched (deleteAccount
      // only clears local data after a confirmed backend success), so the
      // user can simply retry from here.
      setErrorMessage(messages.deleteAccount.failureMessage);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      {/* See ReflectionSheet.tsx's matching comment — same shared bottom-sheet-over-Modal pattern and the same keyboard-overlap fix. */}
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Tap outside the field dismisses the keyboard only — never closes this dialog; Cancel/Delete remain deliberate separate presses. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <Text style={[styles.title, direction]}>{messages.deleteAccount.title}</Text>
                <Text style={[styles.description, direction]}>{messages.deleteAccount.description}</Text>
                <Text style={[styles.instruction, direction]}>{messages.deleteAccount.confirmationInstruction}</Text>
                <TextInput
                  value={confirmationText}
                  onChangeText={setConfirmationText}
                  editable={!isDeleting}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  returnKeyType="done"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  placeholder={messages.deleteAccount.placeholder}
                  placeholderTextColor={colors.placeholder}
                  style={[styles.input, direction]}
                  accessibilityLabel={messages.deleteAccount.placeholder}
                />

                {errorMessage && <Text style={[styles.errorText, direction]}>{errorMessage}</Text>}

                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.deleteAccount.cancel}
                    disabled={isDeleting}
                    onPress={close}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>{messages.deleteAccount.cancel}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.deleteAccount.deleteButton}
                    disabled={!canDelete}
                    onPress={() => void confirmDelete()}
                    style={({ pressed }) => [
                      styles.destructiveButton,
                      !canDelete && styles.disabled,
                      pressed && styles.pressed,
                    ]}>
                    {isDeleting ? (
                      <>
                        <ActivityIndicator size="small" color={colors.onDangerFill} />
                        <Text style={styles.destructiveButtonText}>{messages.deleteAccount.deleting}</Text>
                      </>
                    ) : (
                      <Text style={styles.destructiveButtonText}>{messages.deleteAccount.deleteButton}</Text>
                    )}
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
  instruction: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
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
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '700',
    lineHeight: 18,
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
  destructiveButton: {
    alignItems: 'center',
    backgroundColor: colors.dangerFill,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  disabled: {
    opacity: 0.5,
  },
  destructiveButtonText: {
    color: colors.onDangerFill,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
