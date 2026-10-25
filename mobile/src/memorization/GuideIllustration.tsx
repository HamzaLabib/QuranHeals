import { ArrowLeft, ArrowRight, Eye, EyeOff } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';

import { EYE_ICON_SIZE } from './MemorizationControls';

/**
 * The Memorization Mode Guide's small pictures (memorizationGuide.ts): pictures only — nothing in them can be touched
 * and they change nothing. 'setting': the Settings row with its switch ON; 'eyeChange': the Eye, then the gold
 * crossed-out Eye it becomes.
 */
export function MemorizationGuideIllustration({ kind, title, dark, rtl, color, gold }: { kind: 'setting' | 'eyeChange'; title: string; dark: boolean; rtl: boolean; color: string; gold: string }) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const row = { flexDirection: rtl ? 'row-reverse' as const : 'row' as const };
  if (kind === 'setting') {
    return (
      <View testID="memorization-guide-setting" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.setting, row, { borderColor: theme.accent }]}>
        <Text style={[styles.settingText, { color: theme.text, writingDirection: rtl ? 'rtl' : 'ltr' }]}>{title}</Text>
        <View style={[styles.track, { backgroundColor: theme.accent }, rtl ? styles.trackRtl : null]}>
          <View style={styles.knob} />
        </View>
      </View>
    );
  }
  const Arrow = rtl ? ArrowLeft : ArrowRight;
  return (
    <View testID="memorization-guide-eye-change" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.eyes, row]}>
      <Eye size={EYE_ICON_SIZE + 3} color={color} />
      <Arrow size={16} color={theme.muted} />
      <EyeOff size={EYE_ICON_SIZE + 3} color={gold} />
    </View>
  );
}

const styles = StyleSheet.create({
  setting: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
    justifyContent: 'space-between',
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  settingText: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '700',
  },
  // A switch drawn ON: its knob at the end the language reads to.
  track: {
    alignItems: 'flex-end',
    borderRadius: 999,
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 38,
  },
  trackRtl: {
    alignItems: 'flex-start',
  },
  knob: {
    backgroundColor: '#FFFFFF',
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  eyes: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    marginTop: 4,
  },
});
