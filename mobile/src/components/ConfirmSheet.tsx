import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { useSheetFrameStyle } from '@/layout/useWindowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type ConfirmSheetProps = {
  visible: boolean;
  testID: string;
  title: string;
  body?: string;
  /** A second paragraph under the body, in the same style (e.g. the notification sheet's privacy note). */
  note?: string;
  /** Shown above the title (e.g. an ornament). */
  header?: ReactNode;
  /** Without a confirm label (or onConfirm) the sheet only informs: just its close button. */
  confirmLabel?: string;
  cancelLabel: string;
  destructive?: boolean;
  /** While true the confirm button is disabled: a second tap can never start a second action. */
  busy?: boolean;
  error?: string | null;
  onConfirm?: () => void;
  onCancel: () => void;
};

/**
 * A small bottom sheet asking to confirm one action (أورادي وختماتي and the
 * Khatma prompt), in the app's palette, Light and Dark, mirrored in Arabic.
 * Back, a tap outside or the cancel button closes it without doing anything.
 */
export function ConfirmSheet(props: ConfirmSheetProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  // Tablets: centred and width-capped (layout/windowClass.ts); phones: unchanged.
  const frame = useSheetFrameStyle('absolute');

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel}>
      <Pressable testID={`${props.testID}-backdrop`} accessibilityLabel={props.cancelLabel} style={styles.backdrop} onPress={props.busy ? undefined : props.onCancel} />
      <View testID={props.testID} accessibilityViewIsModal style={[styles.sheet, frame, { paddingBottom: insets.bottom + spacing.lg }]}>
        {props.header}
        <Text accessibilityRole="header" style={[styles.title, direction]}>{props.title}</Text>
        {props.body ? <Text style={[styles.body, direction]}>{props.body}</Text> : null}
        {props.note ? <Text testID={`${props.testID}-note`} style={[styles.body, direction]}>{props.note}</Text> : null}
        {props.error ? <Text accessibilityRole="alert" style={[styles.error, direction]}>{props.error}</Text> : null}
        <View style={[styles.actions, rtl && styles.actionsRtl]}>
          <Pressable
            testID={`${props.testID}-cancel`}
            accessibilityRole="button"
            onPress={props.onCancel}
            disabled={props.busy}
            style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{props.cancelLabel}</Text>
          </Pressable>
          {props.confirmLabel !== undefined && props.onConfirm && (
          <Pressable
            testID={`${props.testID}-confirm`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !!props.busy, busy: !!props.busy }}
            onPress={props.onConfirm}
            disabled={props.busy}
            style={({ pressed }) => [styles.button, props.destructive ? styles.danger : styles.primary, props.busy && styles.busy, pressed && styles.pressed]}>
            {props.busy ? <ActivityIndicator color={props.destructive ? colors.onDangerFill : colors.onPrimaryButton} /> : (
              <Text style={props.destructive ? styles.dangerText : styles.primaryText}>{props.confirmLabel}</Text>
            )}
          </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    bottom: 0,
    gap: spacing.md,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    position: 'absolute',
    right: 0,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 32,
  },
  body: {
    color: colors.textSecondary,
    fontSize: typography.body,
    lineHeight: 24,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  button: {
    alignItems: 'center',
    borderRadius: radii.full,
    flex: 1,
    justifyContent: 'center',
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  primary: {
    backgroundColor: colors.primaryButton,
  },
  primaryText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  danger: {
    backgroundColor: colors.dangerFill,
  },
  dangerText: {
    color: colors.onDangerFill,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondary: {
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderWidth: 1,
  },
  secondaryText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
    textAlign: 'center',
  },
  busy: {
    opacity: 0.7,
  },
  pressed: {
    opacity: 0.75,
  },
});
