import { Eye, EyeOff } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AnchoredPopup, type PopupAnchor } from '@/components/MushafAyahPopups';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';

import type { MemorizationLabels } from './labels';

/**
 * The gold Eye held (Memorization Mode on): Show All / Hide All in the ayah popups' own small card, beside the Eye
 * (above it on the page number's line, below it in the top bar), so it covers only the page's edge for a moment. Each
 * action applies to the page being read and closes the card; a tap outside or Back closes it with nothing changed. It
 * is reachable whatever else is on screen, the recitation's chip included, and never touches the audio.
 */
export function MemorizationMenu({ anchor, labels, dark, rtl, onShowAll, onHideAll, onClose }: {
  anchor: PopupAnchor | null;
  labels: MemorizationLabels;
  dark: boolean;
  rtl: boolean;
  onShowAll: () => void;
  onHideAll: () => void;
  onClose: () => void;
}) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const row = (testID: string, label: string, icon: ReactNode, onPress: () => void) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        onPress();
        onClose();
      }}
      style={({ pressed }) => [styles.row, rtl && styles.rowRtl, pressed && theme.selected]}>
      <View style={styles.icon}>{icon}</View>
      <Text style={[styles.text, { color: theme.text, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{label}</Text>
    </Pressable>
  );
  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} closeLabel={labels.close} testID="memorization-menu" theme={theme}>
      {row('memorization-menu-show-all', labels.showAll, <Eye size={20} color={theme.icon} />, onShowAll)}
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
      {row('memorization-menu-hide-all', labels.hideAll, <EyeOff size={20} color={theme.icon} />, onHideAll)}
    </AnchoredPopup>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    minHeight: 44,
    minWidth: 150,
    paddingHorizontal: 10,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  icon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
  },
  text: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
});
