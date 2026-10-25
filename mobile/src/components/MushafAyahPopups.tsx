import { Check, Copy, Headphones, Heart, Share2, X } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReflectionBulbIcon } from '@/components/ReflectionBulbIcon';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';

/** Where the ayah was tapped, in window coordinates. */
export type PopupAnchor = { x: number; y: number };

/** The retired bar's icon size, so the lamp is drawn exactly as it was there. */
const ICON_SIZE = 23;
const EDGE = 12;
const GAP = 14;

/**
 * A small floating card near the tapped point: above it when there is room, otherwise below; never past the screen's
 * sides or safe areas. Measured before it shows (no jump). A tap anywhere outside, or Back, dismisses it.
 */
export function AnchoredPopup({ anchor, onClose, closeLabel, testID, theme, children }: {
  anchor: PopupAnchor | null;
  onClose: () => void;
  closeLabel: string;
  testID: string;
  theme: (typeof MUSHAF_PANEL_COLORS)['light'] | (typeof MUSHAF_PANEL_COLORS)['dark'];
  children: ReactNode;
}) {
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  let position: { left: number; top: number; opacity: number } = { left: EDGE, top: insets.top + EDGE, opacity: 0 };
  if (anchor && size) {
    const left = Math.min(window.width - size.width - EDGE, Math.max(EDGE, anchor.x - size.width / 2));
    const above = anchor.y - size.height - GAP;
    const top = above >= insets.top + EDGE ? above : Math.min(anchor.y + GAP + 8, window.height - insets.bottom - size.height - EDGE);
    position = { left, top, opacity: 1 };
  }
  return (
    <Modal visible={anchor !== null} transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable testID={`${testID}-backdrop`} accessibilityLabel={closeLabel} style={StyleSheet.absoluteFill} onPress={onClose} />
      <View
        testID={testID}
        accessibilityViewIsModal
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          if (!size || size.width !== width || size.height !== height) setSize({ width, height });
        }}
        style={[styles.card, theme.sheet, position]}>
        {children}
      </View>
    </Modal>
  );
}

type Theme = (typeof MUSHAF_PANEL_COLORS)['light'] | (typeof MUSHAF_PANEL_COLORS)['dark'];
const themeOf = (dark: boolean): Theme => (dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light);

/**
 * Tapping an ayah's words: exactly five actions, in this order (the same in every app language), nothing else.
 *  - Listen (استمع): recitation from this ayah onward, ayah after ayah, turning pages (audio/engine.ts), in the
 *    player's current reciter or else the Favorite Reciter.
 *  - Reflection, with the retired bar's enabled, lit lamp exactly (ReflectionBulbIcon lit, its size, the `saved` green
 *    outline and the `activeFill` yellow glass): opens the existing Reflection editor for this ayah.
 *  - Save, with the Favorites heart (filled when this ayah is already a favourite): the existing Favorites toggle.
 *  - Copy: the ayah's verified Arabic text, a blank line and its reference (mushaf/ayahCopyText.ts) to the clipboard;
 *    "Copied" with a check for a moment after it succeeds. The popup stays open and the ayah selected.
 *  - Share, with the ayah screen's Share icon: the existing Share Ayah sheet for this ayah (no emotion on the card).
 * None touches a ورد, reading progress or a Khatma.
 */
export function MushafAyahActions({ anchor, dark, rtl, saved, copied, busy, error, labels, onReflect, onToggleSave, onCopy, onShare, onListen, onClose }: {
  anchor: PopupAnchor | null;
  dark: boolean;
  rtl: boolean;
  saved: boolean;
  /** Just copied: the Copy row reads "Copied" with a check. */
  copied: boolean;
  busy: boolean;
  error: string | null;
  labels: { reflection: string; save: string; saved: string; saveHint: string; removeHint: string; copy: string; copied: string; share: string; shareHint: string; listen: string; listenHint: string; close: string };
  onReflect: () => void;
  onToggleSave: () => void;
  onCopy: () => void;
  onShare: () => void;
  onListen: () => void;
  onClose: () => void;
}) {
  const theme = themeOf(dark);
  const row = [styles.actionRow, rtl && styles.rowRtl];
  const text = [styles.actionText, { color: theme.text, textAlign: rtl ? 'right' : 'left' } as const];
  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} closeLabel={labels.close} testID="mushaf-ayah-actions" theme={theme}>
      <Pressable
        testID="mushaf-ayah-listen"
        accessibilityRole="button"
        accessibilityLabel={labels.listen}
        accessibilityHint={labels.listenHint}
        onPress={onListen}
        style={({ pressed }) => [row, pressed && theme.selected]}>
        <View style={styles.icon}>
          <Headphones size={20} color={theme.icon} />
        </View>
        <Text style={text}>{labels.listen}</Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
      <Pressable testID="mushaf-ayah-reflection" accessibilityRole="button" accessibilityLabel={labels.reflection} onPress={onReflect} style={({ pressed }) => [row, pressed && theme.selected]}>
        <View style={styles.icon}>
          <ReflectionBulbIcon lit size={ICON_SIZE} color={theme.saved} fill={theme.activeFill} />
        </View>
        <Text style={text}>{labels.reflection}</Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
      <Pressable
        testID="mushaf-ayah-save"
        accessibilityRole="button"
        accessibilityLabel={saved ? labels.removeHint : labels.saveHint}
        accessibilityState={{ selected: saved, busy, disabled: busy }}
        disabled={busy}
        onPress={onToggleSave}
        style={({ pressed }) => [row, pressed && theme.selected, busy && styles.busy]}>
        <View style={styles.icon}>
          {/* Red in both states (theme.savedHeart, the same in Dark): an outline while not in Favorites, filled once it is. No background or badge; only this popup's heart. */}
          <Heart testID={saved ? 'mushaf-ayah-heart-saved' : 'mushaf-ayah-heart'} size={20} color={theme.savedHeart} fill={saved ? theme.savedHeart : 'transparent'} />
        </View>
        <Text style={text}>{saved ? labels.saved : labels.save}</Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
      <Pressable
        testID="mushaf-ayah-copy"
        accessibilityRole="button"
        accessibilityLabel={copied ? labels.copied : labels.copy}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onCopy}
        style={({ pressed }) => [row, pressed && theme.selected, busy && styles.busy]}>
        <View style={styles.icon}>
          {copied ? <Check size={20} color={theme.saved} /> : <Copy size={20} color={theme.icon} />}
        </View>
        <Text accessibilityLiveRegion="polite" style={text}>{copied ? labels.copied : labels.copy}</Text>
      </Pressable>
      <View style={[styles.divider, { backgroundColor: theme.divider }]} />
      <Pressable
        testID="mushaf-ayah-share"
        accessibilityRole="button"
        accessibilityLabel={labels.shareHint}
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onShare}
        style={({ pressed }) => [row, pressed && theme.selected, busy && styles.busy]}>
        <View style={styles.icon}>
          <Share2 size={20} color={theme.icon} />
        </View>
        <Text style={text}>{labels.share}</Text>
      </Pressable>
      {error && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error, textAlign: rtl ? 'right' : 'left' }]}>{error}</Text>}
    </AnchoredPopup>
  );
}

/**
 * Tapping an ayah's number (the separator medallion): one button that saves this page to the active ورد, and X.
 * No title, reference or confirmation; it closes once saved, and on failure stays open with the reason.
 */
export function MushafWirdApply({ anchor, dark, rtl, label, busy, error, closeLabel, onApply, onClose }: {
  anchor: PopupAnchor | null;
  dark: boolean;
  rtl: boolean;
  /** "Apply to Morning Wird", already localised and with the name isolated. */
  label: string;
  busy: boolean;
  error: string | null;
  closeLabel: string;
  onApply: () => void;
  onClose: () => void;
}) {
  const theme = themeOf(dark);
  return (
    <AnchoredPopup anchor={anchor} onClose={onClose} closeLabel={closeLabel} testID="mushaf-wird-apply" theme={theme}>
      <View style={[styles.applyRow, rtl && styles.rowRtl]}>
        <Pressable
          testID="mushaf-wird-apply-button"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={onApply}
          style={({ pressed }) => [styles.apply, theme.go, busy && styles.busy, pressed && styles.pressed]}>
          <Text numberOfLines={2} style={[styles.applyText, { color: theme.onGo }]}>{label}</Text>
        </Pressable>
        <Pressable testID="mushaf-wird-apply-close" accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={6} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <X size={18} color={theme.icon} />
        </Pressable>
      </View>
      {error && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error, textAlign: rtl ? 'right' : 'left' }]}>{error}</Text>}
    </AnchoredPopup>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    maxWidth: 300,
    padding: 4,
    position: 'absolute',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  actionRow: {
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
  actionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
  },
  applyRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  apply: {
    borderRadius: 20,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  applyText: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  close: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 36,
  },
  error: {
    fontSize: 12,
    maxWidth: 260,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  busy: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
});
