import { StyleSheet, Switch, Text, View, useWindowDimensions } from 'react-native';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import type { Messages } from '@/localization/messages';
import { ENABLED_TRANSLATION_MODES, type EnabledTranslationMode } from '@/localization/quranTranslationPreference';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

import { CompactDropdown } from './CompactDropdown';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type TranslationSettingRowProps = {
  on: boolean;
  mode: EnabledTranslationMode;
  messages: Messages;
  direction: Direction;
  isRtl: boolean;
  onToggle: (on: boolean) => void;
  onModeChange: (mode: EnabledTranslationMode) => void;
};

/** As the reminder rows (NotificationReminderRow): below this width or at large text sizes, the dropdown moves under the text. */
const STACK_BELOW_WIDTH = 360;
const STACK_FROM_FONT_SCALE = 1.3;

/**
 * Settings → Emotions → Show Translation, in the reminder rows' compact layout:
 * the name with its description underneath, a small dropdown (Always / On
 * Demand), and the switch at the far end. OFF dims and disables the dropdown
 * but keeps its choice; ON applies it. Every change applies and saves at once.
 * Mirrors in Arabic.
 */
export function TranslationSettingRow({ on, mode, messages, direction, isRtl, onToggle, onModeChange }: TranslationSettingRowProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < STACK_BELOW_WIDTH || fontScale >= STACK_FROM_FONT_SCALE;
  const s = messages.settings;
  const modeLabel: Record<EnabledTranslationMode, string> = { always: s.translationModeAlways, 'on-demand': s.translationModeOnDemand };

  const dropdown = (
    <CompactDropdown
      testID="settings-show-translation-mode"
      accessibilityLabel={`${s.showTranslationTitle}, ${s.translationModeLabel}`}
      accessibilityHint={messages.notifications.changeHint}
      value={mode}
      options={ENABLED_TRANSLATION_MODES.map((value) => ({ value, label: modeLabel[value] }))}
      onChange={onModeChange}
      disabled={!on}
      direction={direction}
    />
  );

  return (
    <View testID="settings-show-translation-row" style={styles.card}>
      <View style={[styles.row, isRtl && styles.rowRtl]}>
        <View style={styles.textWrap}>
          <Text style={[styles.title, direction]}>{s.showTranslationTitle}</Text>
          <Text style={[styles.description, direction]}>{s.showTranslationDescription}</Text>
        </View>
        {!stacked && dropdown}
        <Switch
          testID="settings-show-translation"
          accessibilityRole="switch"
          accessibilityLabel={s.showTranslationTitle}
          accessibilityHint={s.showTranslationDescription}
          accessibilityState={{ checked: on }}
          value={on}
          onValueChange={onToggle}
          trackColor={{ false: colors.border, true: colors.accentFill }}
          ios_backgroundColor={colors.border}
          thumbColor={colors.onAccentFill}
        />
      </View>
      {stacked && <View style={[styles.stackedControls, isRtl && styles.rowRtl]}>{dropdown}</View>}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  /** The same card as the reminder rows and Settings' other cards. */
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
  description: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 17,
  },
  stackedControls: {
    flexDirection: 'row',
  },
});
