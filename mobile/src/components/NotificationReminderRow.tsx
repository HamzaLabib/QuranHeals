import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import type { AppLanguage } from '@/localization/locales';
import type { Messages } from '@/localization/messages';
import { formatReminderTime, frequencyLabel, scheduleSummary, weekdayName } from '@/notifications/format';
import { canSetTwiceTime } from '@/notifications/preferences';
import type { ReminderChange } from '@/notifications/useNotifications';
import {
  WEEKDAYS,
  type NotificationPermission,
  type ReminderFrequency,
  type ReminderPreference,
  type ReminderScheduleState,
  type TwiceDailySlot,
} from '@/notifications/types';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

import { CompactDropdown } from './CompactDropdown';
import { ReminderTimePicker } from './ReminderTimePicker';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type NotificationReminderRowProps = {
  testID: string;
  title: string;
  /** This reminder's frequencies, in order (types.ts reminderFrequencies: Twice Daily last, the Check-in's only). */
  frequencies: readonly ReminderFrequency[];
  preference: ReminderPreference;
  state: ReminderScheduleState | null;
  permission: NotificationPermission;
  locale: AppLanguage;
  messages: Messages;
  direction: Direction;
  isRtl: boolean;
  uses24HourClock: boolean | null;
  onChange: (change: ReminderChange) => void;
  /** "Permission required": asks (with an explanation) or opens the device settings, per the OS state. */
  onPermissionPress: () => void;
};

/** Below this width (or at large text sizes) the frequency moves under the time, so nothing overlaps or shrinks. */
const STACK_BELOW_WIDTH = 360;
const STACK_FROM_FONT_SCALE = 1.3;

/**
 * One reminder in its Settings section (the approved compact row): the name
 * with its time underneath (tap to change it), a small frequency selector
 * (Daily / Every 3 days / Weekly) and the switch at the far end. Weekly adds
 * the weekday before the time ("Sunday · 9:00 PM"), itself a small selector.
 * Every change applies and saves at once (no Save or Done). Twice Daily (the
 * Check-in only) shows its two times instead of the one ("Morning 9:00 AM ·
 * Evening 9:00 PM"), each tapped and changed on its own with the same picker;
 * a time equal to the other one is refused with a short note, never saved.
 *
 * OFF: the frequency, weekday and time are kept but dimmed and disabled; the
 * reminder's notifications are cancelled (only this type's). ON with no OS
 * permission: an accurate "Permission required" line that asks (once, with an
 * explanation) or opens the device settings — never a false "scheduled".
 * Mirrors in Arabic.
 */
export function NotificationReminderRow(props: NotificationReminderRowProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { width, fontScale } = useWindowDimensions();
  /** Which time the picker is changing: the single one, or one of Twice Daily's two. */
  const [picking, setPicking] = useState<'single' | TwiceDailySlot | null>(null);
  const [sameTimeRefused, setSameTimeRefused] = useState(false);
  const { preference, messages, direction, isRtl, locale } = props;
  const stacked = width < STACK_BELOW_WIDTH || fontScale >= STACK_FROM_FONT_SCALE;
  const enabled = preference.enabled;
  const time = formatReminderTime(preference.time, locale, messages, props.uses24HourClock);
  const n = messages.notifications;
  const twice = preference.frequency === 'twiceDaily' && preference.twice ? preference.twice : null;
  const change = (next: ReminderChange) => {
    setSameTimeRefused(false);
    props.onChange(next);
  };
  const timeButton = (slot: 'single' | TwiceDailySlot, label: string, accessibilityName: string) => (
    <Pressable
      key={slot}
      testID={slot === 'single' ? `${props.testID}-time` : `${props.testID}-time-${slot}`}
      accessibilityRole="button"
      accessibilityLabel={`${props.title}, ${accessibilityName}, ${label}`}
      accessibilityHint={n.changeHint}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
      onPress={() => setPicking(slot)}
      style={({ pressed }) => [styles.timeButton, pressed && styles.pressed]}>
      <Text style={[styles.time, direction, !enabled && styles.disabledText]}>{label}</Text>
    </Pressable>
  );

  const frequency = (
    <CompactDropdown
      testID={`${props.testID}-frequency`}
      accessibilityLabel={`${props.title}, ${n.frequencyLabel}`}
      accessibilityHint={n.changeHint}
      value={preference.frequency}
      options={props.frequencies.map((value) => ({ value, label: frequencyLabel(value, messages) }))}
      onChange={(value) => change({ frequency: value })}
      disabled={!enabled}
      direction={direction}
    />
  );

  const status = statusLine(props);

  return (
    <View testID={props.testID} style={styles.card}>
      <View style={[styles.row, isRtl && styles.rowRtl]}>
        <View style={styles.textWrap}>
          <Text style={[styles.title, direction]}>{props.title}</Text>
          <View style={[styles.meta, isRtl && styles.rowRtl]}>
            {preference.frequency === 'weekly' && preference.weekday !== null && (
              <>
                <CompactDropdown
                  testID={`${props.testID}-weekday`}
                  variant="text"
                  accessibilityLabel={`${props.title}, ${n.chooseDay}`}
                  accessibilityHint={n.changeHint}
                  value={preference.weekday}
                  options={WEEKDAYS.map((value) => ({ value, label: weekdayName(value, messages) }))}
                  onChange={(value) => change({ weekday: value })}
                  disabled={!enabled}
                  direction={direction}
                />
                <Text style={[styles.separator, !enabled && styles.disabledText]}>·</Text>
              </>
            )}
            {twice ? (
              <>
                {timeButton('morning', `${n.twiceMorning} ${formatReminderTime(twice.morning, locale, messages, props.uses24HourClock)}`, `${n.twiceMorning}, ${n.reminderTimeLabel}`)}
                <Text style={[styles.separator, !enabled && styles.disabledText]}>·</Text>
                {timeButton('evening', `${n.twiceEvening} ${formatReminderTime(twice.evening, locale, messages, props.uses24HourClock)}`, `${n.twiceEvening}, ${n.reminderTimeLabel}`)}
              </>
            ) : (
              timeButton('single', time, n.reminderTimeLabel)
            )}
          </View>
        </View>
        {!stacked && frequency}
        <Switch
          testID={`${props.testID}-switch`}
          accessibilityRole="switch"
          accessibilityLabel={props.title}
          accessibilityHint={`${n.toggleHint} ${scheduleSummary(preference, locale, messages, props.uses24HourClock)}`}
          accessibilityState={{ checked: enabled }}
          value={enabled}
          onValueChange={(value) => change({ enabled: value })}
          trackColor={{ false: colors.border, true: colors.accentFill }}
          ios_backgroundColor={colors.border}
          thumbColor={colors.onAccentFill}
        />
      </View>
      {stacked && <View style={[styles.stackedControls, isRtl && styles.rowRtl]}>{frequency}</View>}
      {status}
      {sameTimeRefused && enabled && <Text testID={`${props.testID}-same-time`} style={[styles.status, styles.error, direction]}>{n.twiceSameTime}</Text>}
      <ReminderTimePicker
        visible={picking !== null}
        value={picking === 'morning' || picking === 'evening' ? (preference.twice?.[picking] ?? preference.time) : preference.time}
        title={`${picking === 'morning' ? `${n.twiceMorning} · ` : picking === 'evening' ? `${n.twiceEvening} · ` : ''}${n.reminderTimeLabel} · ${props.title}`}
        uses24HourClock={props.uses24HourClock}
        onConfirm={(next) => {
          const slot = picking;
          setPicking(null);
          if (slot === 'morning' || slot === 'evening') {
            // The same time as the other one would be one reminder twice: refused, with a note; nothing is saved.
            if (!canSetTwiceTime(preference, slot, next)) {
              setSameTimeRefused(true);
              return;
            }
            change({ twiceTime: { slot, time: next } });
          } else {
            change({ time: next });
          }
        }}
        onCancel={() => setPicking(null)}
      />
    </View>
  );

  function statusLine({ state, permission, testID }: NotificationReminderRowProps) {
    if (!enabled) return null;
    if (permission.status === 'unsupported' || state?.state === 'unsupported') {
      return <Text testID={`${testID}-status`} style={[styles.status, direction]}>{n.unsupported}</Text>;
    }
    if (permission.status === 'undetermined' || permission.status === 'denied' || state?.state === 'needsPermission') {
      const canAsk = permission.status === 'undetermined' || (permission.status === 'denied' && permission.canAskAgain);
      const action = canAsk ? n.permissionAllow : n.permissionOpenSettings;
      return (
        <Pressable
          testID={`${testID}-permission`}
          accessibilityRole="button"
          accessibilityLabel={`${n.permissionRequired}. ${action}`}
          accessibilityHint={permission.status === 'denied' ? n.permissionDeniedHint : undefined}
          onPress={props.onPermissionPress}
          style={({ pressed }) => [styles.permission, isRtl && styles.rowRtl, pressed && styles.pressed]}>
          <Text style={[styles.status, direction]}>{n.permissionRequired}</Text>
          <Text style={[styles.permissionAction, direction]}>{action}</Text>
        </Pressable>
      );
    }
    if (state?.state === 'error') return <Text testID={`${testID}-status`} style={[styles.status, styles.error, direction]}>{n.scheduleError}</Text>;
    return null;
  }
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  /** The same card as Settings' other rows (SettingsAccordion, the switch cards). */
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...shadows.soft,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  meta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  separator: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  timeButton: {
    justifyContent: 'center',
    minHeight: 24,
  },
  time: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
    textDecorationLine: 'underline',
    textDecorationStyle: 'dotted',
  },
  disabledText: {
    color: colors.textMuted,
  },
  stackedControls: {
    flexDirection: 'row',
  },
  status: {
    color: colors.textSecondary,
    fontSize: typography.small,
    lineHeight: 17,
  },
  error: {
    color: colors.danger,
  },
  permission: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    minHeight: 32,
  },
  permissionAction: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
