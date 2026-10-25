import { Eye, EyeOff } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { useGuideTarget } from '@/mushaf/guideTargets';

import type { MemorizationLabels } from './labels';
import { ALL_MIN_FONT_SCALE } from './placement';

/** The Eye's icon in the top bar: as the reader's other plain icons (the headphones are 21 pt), a little smaller. */
export const EYE_ICON_SIZE = 19;
const ALL_FONT_SIZE = 12;

type EyeProps = {
  active: boolean;
  labels: MemorizationLabels;
  /** The reader's plain-icon colour (normal), and the ورد medallion's gold (Memorization Mode on). */
  color: string;
  gold: string;
  /** Its box in the top bar's row (the bar's own 44-pt icon box). */
  style: ViewStyle | null;
  slopTop: number;
  /** The page not drawn yet: kept in place, unseen, untouchable and unannounced. */
  hidden: boolean;
  onPress: () => void;
  /**
   * While Memorization Mode is on: a touch and hold opens Show All / Hide All (at the touch, in window coordinates),
   * and a screen reader offers both as the Eye's own actions. A long press never also counts as a tap (it never leaves
   * Memorization Mode). Off: neither, as before.
   */
  onLongPress: (at: { x: number; y: number } | null) => void;
  onShowAll: () => void;
  onHideAll: () => void;
};

/**
 * Memorization Mode's Eye: an outline Eye to enter it; while it is on, a gold crossed-out Eye to leave it (and, held,
 * Show All / Hide All). Plain, as the reader's other icons (no circle or label), in a full-width 44-pt touch target.
 */
export function MemorizationEyeButton({ active, labels, color, gold, style, slopTop, hidden, onPress, onLongPress, onShowAll, onHideAll }: EyeProps) {
  const guideTarget = useGuideTarget('memorize');
  return (
    <Pressable
      ref={guideTarget}
      testID="memorization-eye"
      accessibilityRole="button"
      accessibilityLabel={active ? labels.exit : labels.enter}
      accessibilityHint={active ? labels.menuHint : undefined}
      accessibilityState={{ selected: active }}
      accessibilityActions={active ? [{ name: 'showAll', label: labels.showAll }, { name: 'hideAll', label: labels.hideAll }] : undefined}
      onAccessibilityAction={active ? (event) => {
        if (event.nativeEvent.actionName === 'showAll') onShowAll();
        else if (event.nativeEvent.actionName === 'hideAll') onHideAll();
      } : undefined}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      disabled={hidden}
      onPress={onPress}
      onLongPress={active ? (event) => {
        const native = event.nativeEvent as { pageX?: number; pageY?: number };
        onLongPress(Number.isFinite(native.pageX) && Number.isFinite(native.pageY) ? { x: native.pageX as number, y: native.pageY as number } : null);
      } : undefined}
      hitSlop={{ top: slopTop, bottom: 0, left: 0, right: 0 }}
      style={({ pressed }) => [styles.eye, style, hidden && styles.hidden, pressed && styles.pressed]}>
      {active
        ? <EyeOff testID="memorization-eye-off" size={EYE_ICON_SIZE} color={gold} />
        : <Eye testID="memorization-eye-on" size={EYE_ICON_SIZE} color={color} />}
    </Pressable>
  );
}

type AllProps = {
  labels: MemorizationLabels;
  dark: boolean;
  rtl: boolean;
  /** Its place on the page number's line (its width may be under its natural one: `shrunk`), or null in the top bar. */
  place: { style: ViewStyle; slopTop: number; shrunk: boolean } | null;
  hidden: boolean;
  onShowAll: () => void;
  onHideAll: () => void;
  /** Its natural width (both labels at full size), measured off screen, for placement.ts. */
  onMeasure: (width: number) => void;
  /**
   * Only the measuring copy (nothing seen, touched or announced): the Memorization Mode Guide, before Memorization
   * Mode is on, learns where this layout would put them (beside the page number or in the top bar).
   */
  measureOnly?: boolean;
};

/**
 * Show All / Hide All: one small capsule of two halves, in the ورد pill's colours, shown only while Memorization Mode
 * is on. A hidden copy at full size is measured first, so its place never depends on a guessed width.
 */
export function MemorizationAllControls({ labels, dark, rtl, place, hidden, onShowAll, onHideAll, onMeasure, measureOnly = false }: AllProps) {
  const guideTarget = useGuideTarget('memorizeAll');
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const row = { flexDirection: rtl ? 'row-reverse' as const : 'row' as const };
  const label = (text: string, fit: boolean) => (
    <Text
      allowFontScaling={false}
      numberOfLines={1}
      adjustsFontSizeToFit={fit}
      minimumFontScale={ALL_MIN_FONT_SCALE}
      style={[styles.allText, { color: theme.text, writingDirection: rtl ? 'rtl' : 'ltr' }]}>
      {text}
    </Text>
  );
  const half = (testID: string, text: string, onPress: () => void, fit: boolean, slopTop: number) => (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={text}
      disabled={hidden}
      onPress={onPress}
      hitSlop={{ top: slopTop, bottom: 0, left: 0, right: 0 }}
      style={({ pressed }) => [styles.half, fit && styles.halfFit, pressed && styles.pressed]}>
      {label(text, fit)}
    </Pressable>
  );
  const fit = place?.shrunk ?? false;
  const slopTop = place?.slopTop ?? 0;
  return (
    <>
      {/* The measuring copy: never seen, touched or announced. */}
      <View
        testID="memorization-all-measure"
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.capsule, styles.measure, row]}
        onLayout={(event) => onMeasure(event.nativeEvent.layout.width)}>
        <View style={styles.half}>{label(labels.showAll, false)}</View>
        <View style={styles.divider} />
        <View style={styles.half}>{label(labels.hideAll, false)}</View>
      </View>
      {!measureOnly && <View
        ref={guideTarget}
        testID="memorization-all"
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
        pointerEvents={hidden ? 'none' : 'box-none'}
        style={[styles.capsule, theme.pill, row, place?.style ?? styles.inBar, hidden && styles.hidden]}>
        {half('memorization-show-all', labels.showAll, onShowAll, fit, slopTop)}
        <View style={[styles.divider, { backgroundColor: theme.accent }]} />
        {half('memorization-hide-all', labels.hideAll, onHideAll, fit, slopTop)}
      </View>}
    </>
  );
}

const styles = StyleSheet.create({
  eye: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    alignItems: 'stretch',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  inBar: {
    minHeight: 30,
  },
  measure: {
    left: -10000,
    opacity: 0,
    position: 'absolute',
    top: 0,
  },
  half: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  halfFit: {
    flex: 1,
    paddingHorizontal: 4,
  },
  allText: {
    fontSize: ALL_FONT_SIZE,
    fontWeight: '700',
  },
  divider: {
    alignSelf: 'center',
    height: '60%',
    opacity: 0.5,
    width: StyleSheet.hairlineWidth,
  },
  hidden: {
    opacity: 0,
  },
  pressed: {
    opacity: 0.6,
  },
});
