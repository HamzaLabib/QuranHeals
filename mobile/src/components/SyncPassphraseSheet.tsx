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
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import type { SyncPassphraseMode, VerifyPassphrase } from '@/sync/syncKeyManager';
import { useVerifiedSyncPassword } from '@/sync/useVerifiedSyncPassword';
import { canSetSyncPassword, passwordLengthError } from '@/utils/syncPasswordValidation';
import { SyncPasswordField } from './SyncPasswordField';

export type PassphraseRequestLike = { mode: SyncPassphraseMode; verify?: VerifyPassphrase } | null;

type SyncPassphraseSheetProps = {
  request: PassphraseRequestLike;
  onSubmit: (passphrase: string) => void;
  /**
   * The one way out of this mandatory step other than entering the correct
   * password: fully sign out of the account (never a "skip"/"not now" that
   * would leave the user signed in without having satisfied it). Wired to
   * the real signOut() by the caller (useAuth.tsx).
   */
  onSignOut: () => void;
};

/**
 * Shown once per device: the first time sync turns on (mode: 'create', the
 * user sets a new Sync Password) or when a second device needs to recover
 * the already-established key (mode: 'unlock'). See
 * docs/reflection-privacy.md — this password never leaves the device and is
 * never sent to the backend.
 *
 * Mandatory: this is a security gate for synced reflections/favorites, not
 * a dismissible dialog. There is deliberately no Cancel/"Not now"/Skip —
 * see onSignOut above for the only sanctioned way out. Backdrop tap,
 * swipe-down, and Android Back must never close it (onRequestClose is a
 * no-op below); only Keyboard.dismiss() happens on an outside tap.
 */
export function SyncPassphraseSheet(props: SyncPassphraseSheetProps) {
  return props.request ? <SyncPassphraseForm key={props.request.mode} {...props} request={props.request} /> : null;
}

function SyncPassphraseForm({ request, onSubmit, onSignOut }: SyncPassphraseSheetProps & { request: NonNullable<PassphraseRequestLike> }) {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [value, setValue] = useState('');

  const [confirmation, setConfirmation] = useState('');
  const [touched, setTouched] = useState(false);
  const { verified } = useVerifiedSyncPassword(value, request.mode === 'unlock' ? request.verify : undefined);

  const isCreate = request.mode === 'create';
  const canSubmit = isCreate ? canSetSyncPassword(value, confirmation) : verified;
  const lengthError = passwordLengthError(value);
  const feedback = isCreate && touched && lengthError ? messages.syncPassphrase[lengthError]
    : isCreate && confirmation && value !== confirmation ? messages.syncPassphrase.mismatch : null;
  const submitLabel = isCreate ? messages.syncPassphrase.createTitle : messages.syncPassphrase.continueLabel;

  const submit = () => {
    if (!canSubmit) return;
    const passphrase = value;
    setValue('');
    setConfirmation('');
    onSubmit(passphrase);
  };

  const signOut = () => {
    setValue('');
    setConfirmation('');
    onSignOut();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      {/* See ReflectionSheet.tsx's matching comment — same shared bottom-sheet-over-Modal pattern and the same keyboard-overlap fix. The password input is this app's closest equivalent to a password field, so it gets the same treatment. */}
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Tapping anywhere outside the TextInput (backdrop or the sheet's
            own empty space) only dismisses the keyboard — never the sheet
            itself. A tap that lands on a button/input inside is claimed by
            that element first and never reaches this handler, so Continue
            and the field itself are unaffected. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, direction]}>
                  {isCreate ? messages.syncPassphrase.createTitle : messages.syncPassphrase.unlockTitle}
                </Text>
                <Text style={[styles.description, direction]}>
                  {isCreate ? messages.syncPassphrase.createDescription : messages.syncPassphrase.unlockDescription}
                </Text>
                <SyncPasswordField value={value} onChangeText={setValue}
                  onBlur={() => setTouched(true)}
                  label={isCreate ? messages.syncPassphrase.createPlaceholder : messages.syncPassphrase.unlockPlaceholder} />
                {isCreate && <>
                  <SyncPasswordField value={confirmation} onChangeText={setConfirmation}
                    label={messages.syncPassphrase.confirmPassword} />
                  <Text style={[styles.description, direction]}>{messages.syncPassphrase.lengthHint}{'\n'}{messages.syncPassphrase.allowedHint}</Text>
                </>}
                {feedback && <Text accessibilityLiveRegion="polite" style={[styles.error, direction]}>{feedback}</Text>}
                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.account.signOut}
                    onPress={signOut}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>{messages.account.signOut}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={submitLabel}
                    disabled={!canSubmit}
                    onPress={submit}
                    style={({ pressed }) => [styles.primaryButton, !canSubmit && styles.disabled, pressed && styles.pressed]}>
                    <Text style={styles.primaryButtonText}>{submitLabel}</Text>
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

export const syncPasswordStyles = StyleSheet.create({
  error: { color: colors.rust, fontSize: typography.caption },
  backdrop: {
    backgroundColor: 'rgba(31, 42, 36, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    width: '100%',
    maxHeight: '100%',
  },
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  scrollContent: {
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

const styles = syncPasswordStyles;
