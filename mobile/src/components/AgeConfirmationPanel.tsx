import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import type { Messages } from '@/localization/messages';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type AgeConfirmationPanelProps = {
  messages: Messages;
  direction: Direction;
  isRtl: boolean;
  /** Called only once the checkbox is ticked. */
  onContinue: () => void;
  onCancel: () => void;
};

/**
 * The account-age self-declaration shown in the Account card before Apple or
 * Google sign-in starts (AccountSection.tsx; policy in auth/ageConfirmation.ts).
 * Rendered inline rather than as a modal, so the provider's own sign-in
 * sheet never has to present over a closing modal. Continue stays disabled
 * until the checkbox is ticked; Cancel starts nothing. No age or date of
 * birth is ever asked for.
 */
export function AgeConfirmationPanel({ messages, direction, isRtl, onContinue, onCancel }: AgeConfirmationPanelProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const [checked, setChecked] = useState(false);
  const copy = messages.ageConfirmation;

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.title}</Text>
      <Text style={[styles.description, direction]}>{copy.description}</Text>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={copy.checkbox}
        onPress={() => setChecked((value) => !value)}
        hitSlop={6}
        style={[styles.checkboxRow, isRtl && styles.rowRtl]}>
        <View style={[styles.box, checked && styles.boxChecked]}>
          {checked && <Check size={16} color={colors.onPrimaryButton} strokeWidth={3} />}
        </View>
        <Text style={[styles.checkboxLabel, direction]}>{copy.checkbox}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.continueButton}
        accessibilityState={{ disabled: !checked }}
        disabled={!checked}
        onPress={() => {
          if (checked) onContinue();
        }}
        style={({ pressed }) => [styles.button, !checked && styles.buttonDisabled, pressed && checked && styles.pressed]}>
        <Text style={styles.buttonText}>{copy.continueButton}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.cancel}
        onPress={onCancel}
        style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
        <Text style={styles.secondaryButtonText}>{copy.cancel}</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  panel: {
    gap: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  description: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  checkboxRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  box: {
    alignItems: 'center',
    borderColor: colors.accent,
    borderRadius: 6,
    borderWidth: 2,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  boxChecked: {
    backgroundColor: colors.primaryButton,
    borderColor: colors.primaryButton,
  },
  checkboxLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '700',
  },
  secondaryButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
