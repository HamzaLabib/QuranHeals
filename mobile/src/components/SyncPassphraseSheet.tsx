import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import type { SyncPassphraseMode } from '@/sync/syncKeyManager';

export type PassphraseRequestLike = { mode: SyncPassphraseMode } | null;

type SyncPassphraseSheetProps = {
  request: PassphraseRequestLike;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
};

/**
 * Shown once per device: the first time sync turns on (mode: 'create', the
 * user sets a new Sync Passphrase) or when a second device needs to recover
 * the already-established key (mode: 'unlock'). See
 * docs/reflection-privacy.md — this passphrase never leaves the device and
 * is never sent to the backend.
 */
export function SyncPassphraseSheet({ request, onSubmit, onCancel }: SyncPassphraseSheetProps) {
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [value, setValue] = useState('');

  if (!request) return null;

  const isCreate = request.mode === 'create';
  const canSubmit = value.trim().length >= 4;

  const submit = () => {
    if (!canSubmit) return;
    const passphrase = value;
    setValue('');
    onSubmit(passphrase);
  };

  const cancel = () => {
    setValue('');
    onCancel();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.sheet}>
            <Text style={[styles.title, direction]}>
              {isCreate ? messages.syncPassphrase.createTitle : messages.syncPassphrase.unlockTitle}
            </Text>
            <Text style={[styles.description, direction]}>
              {isCreate ? messages.syncPassphrase.createDescription : messages.syncPassphrase.unlockDescription}
            </Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={messages.syncPassphrase.placeholder}
              placeholderTextColor={colors.muted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.input, direction]}
              accessibilityLabel={messages.syncPassphrase.placeholder}
            />
            <View style={[styles.actions, isRtl && styles.actionsRtl]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.syncPassphrase.cancel}
                onPress={cancel}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                <Text style={styles.secondaryButtonText}>{messages.syncPassphrase.cancel}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.syncPassphrase.continueLabel}
                disabled={!canSubmit}
                onPress={submit}
                style={({ pressed }) => [styles.primaryButton, !canSubmit && styles.disabled, pressed && styles.pressed]}>
                <Text style={styles.primaryButtonText}>{messages.syncPassphrase.continueLabel}</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
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
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.soft,
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
