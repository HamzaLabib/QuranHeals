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

import type { AuthProvider } from '@/auth/authTypes';
import {
  ReauthenticationFailedError,
  ReauthenticationUnavailableError,
  useFreshProviderCredential,
} from '@/auth/reauthentication';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { useThemedStyles } from '@/theme/useTheme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { SyncApiError } from '@/sync/syncApi';
import type { ResetEncryptedSync, SyncPassphraseMode, VerifyPassphrase } from '@/sync/syncKeyManager';
import { useVerifiedSyncPassword } from '@/sync/useVerifiedSyncPassword';
import { canSetSyncPassword, passwordLengthError } from '@/utils/syncPasswordValidation';
import { DeleteAccountSheet } from './DeleteAccountSheet';
import { SyncPasswordField } from './SyncPasswordField';

export type PassphraseRequestLike = { mode: SyncPassphraseMode; verify?: VerifyPassphrase; reset?: ResetEncryptedSync } | null;

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
  /**
   * Forgotten password (unlock step only): called after the user confirmed
   * and the reset of encrypted reflection sync succeeded. The caller then
   * continues into creating a NEW password — the gate is still satisfied,
   * never skipped.
   */
  onResetComplete: () => void;
  /** The account's deleteAccount(), so a user who forgot the password can still delete the account (same typed confirmation as Settings). */
  deleteAccount: () => Promise<void>;
  /** Called once account deletion completed; the caller ends this step (the session is gone). */
  onAccountDeleted: () => void;
  /** The signed-in account's own provider — the only one that can confirm the reset (each account has exactly one). */
  accountProvider: AuthProvider | null;
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
  return props.request ? <SyncPassphraseForm {...props} request={props.request} /> : null;
}

function SyncPassphraseForm({
  request,
  onSubmit,
  onSignOut,
  onResetComplete,
  deleteAccount,
  onAccountDeleted,
  accountProvider,
}: SyncPassphraseSheetProps & { request: NonNullable<PassphraseRequestLike> }) {
  const styles = useThemedStyles(makeSyncPasswordStyles);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [value, setValue] = useState('');
  // 'forgot': the reset explanation/confirmation; 'delete': account deletion.
  const [view, setView] = useState<'password' | 'forgot' | 'delete'>('password');
  // 'verifying': the fresh Apple/Google sign-in; 'resetting': the reset itself.
  const [resetPhase, setResetPhase] = useState<'idle' | 'verifying' | 'resetting'>('idle');
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const isResetting = resetPhase !== 'idle';
  const canReset = request.mode === 'unlock' && request.reset !== undefined;
  const authenticateWithProvider = useFreshProviderCredential(accountProvider);

  const [confirmation, setConfirmation] = useState('');
  const [touched, setTouched] = useState(false);

  // After a forgotten-password reset the unlock request is replaced by the
  // 'create' one in the same render. The sheet stays the same native modal
  // and only its content starts over: closing one modal and presenting
  // another at once can fail on iOS — right after the Google sign-in sheet
  // it left no sheet and an invisible layer blocking every tap.
  const [shownMode, setShownMode] = useState(request.mode);
  if (shownMode !== request.mode) {
    setShownMode(request.mode);
    setValue('');
    setConfirmation('');
    setTouched(false);
    setView('password');
    setResetPhase('idle');
    setResetMessage(null);
  }

  const { verified, checking } = useVerifiedSyncPassword(value, request.mode === 'unlock' ? request.verify : undefined);

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

  // Nothing is reset unless a fresh sign-in with the account's own
  // Apple/Google identity succeeds AND the backend verifies it. Every other
  // outcome stays here, with Back, Delete account and (on the password
  // step) Sign out still available.
  const confirmReset = async () => {
    if (isResetting || !request.reset) return;
    setResetMessage(null);
    setResetPhase('verifying');
    try {
      const credential = await authenticateWithProvider();
      if (!credential) {
        setResetMessage(messages.syncPassphrase.reauthCancelled);
        return;
      }
      setResetPhase('resetting');
      await request.reset(credential);
      onResetComplete();
    } catch (error) {
      // Never a raw provider/server error: one of three fixed messages.
      setResetMessage(
        error instanceof ReauthenticationUnavailableError
          ? messages.syncPassphrase.reauthUnavailable
          : error instanceof ReauthenticationFailedError || (error instanceof SyncApiError && error.statusCode === 403)
            ? messages.syncPassphrase.reauthFailed
            : messages.syncPassphrase.resetError,
      );
    } finally {
      setResetPhase('idle');
    }
  };

  if (view === 'delete') {
    return (
      <DeleteAccountSheet
        visible
        deleteAccount={deleteAccount}
        onClose={() => setView('forgot')}
        onDeleted={onAccountDeleted}
      />
    );
  }

  if (view === 'forgot') {
    return (
      <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.backdrop}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView contentContainerStyle={styles.scrollContent}>
                <Text style={[styles.title, direction]}>{messages.syncPassphrase.resetTitle}</Text>
                <Text style={[styles.description, direction]}>{messages.syncPassphrase.resetUnrecoverable}</Text>
                <Text style={[styles.description, direction]}>{messages.syncPassphrase.resetCloudLoss}</Text>
                {accountProvider && (
                  <Text style={[styles.description, direction]}>
                    {accountProvider === 'apple' ? messages.syncPassphrase.reauthNoticeApple : messages.syncPassphrase.reauthNoticeGoogle}
                  </Text>
                )}
                {resetMessage && (
                  <Text accessibilityLiveRegion="polite" style={[styles.error, direction]}>{resetMessage}</Text>
                )}
                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.syncPassphrase.resetBack}
                    accessibilityState={{ disabled: isResetting }}
                    disabled={isResetting}
                    onPress={() => setView('password')}
                    style={({ pressed }) => [styles.secondaryButton, isResetting && styles.disabled, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>{messages.syncPassphrase.resetBack}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.syncPassphrase.resetConfirm}
                    accessibilityState={{ disabled: isResetting }}
                    disabled={isResetting}
                    onPress={() => void confirmReset()}
                    style={({ pressed }) => [styles.destructiveButton, isResetting && styles.disabled, pressed && styles.pressed]}>
                    <Text style={styles.primaryButtonText}>
                      {resetPhase === 'verifying'
                        ? messages.syncPassphrase.verifying
                        : resetPhase === 'resetting'
                          ? messages.syncPassphrase.resetting
                          : messages.syncPassphrase.resetConfirm}
                    </Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={messages.syncPassphrase.deleteAccountInstead}
                  disabled={isResetting}
                  onPress={() => setView('delete')}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                  <Text style={[styles.dangerLinkText, direction]}>{messages.syncPassphrase.deleteAccountInstead}</Text>
                </Pressable>
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    );
  }

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
              <ScrollView key={request.mode} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
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
                {canReset && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.syncPassphrase.forgotPassword}
                    onPress={() => {
                      setValue('');
                      setResetMessage(null);
                      setView('forgot');
                    }}
                    style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                    <Text style={[styles.linkText, direction]}>{messages.syncPassphrase.forgotPassword}</Text>
                  </Pressable>
                )}
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
                    accessibilityState={{ disabled: !canSubmit, busy: checking }}
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

export const makeSyncPasswordStyles = (colors: Palette) => StyleSheet.create({
  error: { color: colors.danger, fontSize: typography.caption },
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    width: '100%',
    maxHeight: '100%',
  },
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  scrollContent: {
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
  destructiveButton: {
    alignItems: 'center',
    backgroundColor: colors.dangerFill,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  linkButton: {
    alignSelf: 'stretch',
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  dangerLinkText: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '700',
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

