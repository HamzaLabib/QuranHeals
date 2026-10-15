import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import type { LocalTime } from '@/notifications/types';
import { useThemeName, useThemedStyles } from '@/theme/useTheme';

import type { ReminderTimePickerProps } from './ReminderTimePicker';

function toDate(time: LocalTime): Date {
  const date = new Date();
  date.setHours(time.hour, time.minute, 0, 0);
  return date;
}

/**
 * The system time picker for a reminder (any hour and minute, in the device's
 * 12/24-hour style). Android: the native time dialog, whose OK confirms.
 * iOS: the native wheel in a small sheet whose "Set time" confirms; Cancel,
 * Back or a tap outside keep the saved time. Nothing is saved until confirmed.
 */
export function ReminderTimePicker({ visible, value, title, onConfirm, onCancel, uses24HourClock }: ReminderTimePickerProps) {
  if (Platform.OS === 'android') return <AndroidTimeDialog visible={visible} value={value} title={title} onConfirm={onConfirm} onCancel={onCancel} uses24HourClock={uses24HourClock} />;
  return <IosTimeSheet visible={visible} value={value} title={title} onConfirm={onConfirm} onCancel={onCancel} uses24HourClock={uses24HourClock} />;
}

function AndroidTimeDialog({ visible, value, onConfirm, onCancel, uses24HourClock }: ReminderTimePickerProps) {
  useEffect(() => {
    if (!visible) return;
    DateTimePickerAndroid.open({
      mode: 'time',
      value: toDate(value),
      is24Hour: uses24HourClock ?? undefined,
      // OK confirms; Cancel, Back or a tap outside dismisses without a change.
      onValueChange: (_event, date) => onConfirm({ hour: date.getHours(), minute: date.getMinutes() }),
      onDismiss: onCancel,
    });
    // Opened once per `visible`; the dialog owns the interaction until it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  return null;
}

function IosTimeSheet({ visible, value, title, onConfirm, onCancel }: ReminderTimePickerProps) {
  const styles = useThemedStyles(makeStyles);
  const theme = useThemeName();
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const rtl = isRtlLocale(locale);
  const [draft, setDraft] = useState(() => toDate(value));
  const [shownFor, setShownFor] = useState(visible);
  // Each opening starts from the saved time (adjusted while rendering, not in an effect).
  if (visible !== shownFor) {
    setShownFor(visible);
    if (visible) setDraft(toDate(value));
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable accessibilityLabel={messages.notifications.timePickerCancel} style={styles.backdrop} onPress={onCancel} />
      <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Text accessibilityRole="header" style={[styles.title, { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{title}</Text>
        <DateTimePicker
          mode="time"
          display="spinner"
          value={draft}
          themeVariant={theme}
          onValueChange={(_event, date) => setDraft(date)}
          style={styles.picker}
        />
        <View style={[styles.actions, rtl && styles.actionsRtl]}>
          <Pressable accessibilityRole="button" onPress={onCancel} style={({ pressed }) => [styles.button, styles.secondary, pressed && styles.pressed]}>
            <Text style={styles.secondaryText}>{messages.notifications.timePickerCancel}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onConfirm({ hour: draft.getHours(), minute: draft.getMinutes() })}
            style={({ pressed }) => [styles.button, styles.primary, pressed && styles.pressed]}>
            <Text style={styles.primaryText}>{messages.notifications.timePickerConfirm}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    bottom: 0,
    gap: spacing.sm,
    left: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    position: 'absolute',
    right: 0,
  },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  picker: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionsRtl: { flexDirection: 'row-reverse' },
  button: { alignItems: 'center', borderRadius: radii.full, flex: 1, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md },
  primary: { backgroundColor: colors.primaryButton },
  primaryText: { color: colors.onPrimaryButton, fontSize: typography.body, fontWeight: '800', textAlign: 'center' },
  secondary: { backgroundColor: colors.secondaryButtonSurface, borderColor: colors.secondaryButtonBorder, borderWidth: 1 },
  secondaryText: { color: colors.textPrimary, fontSize: typography.body, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
