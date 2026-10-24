import { ChevronDown } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { WIRD_CHEVRON_SIZE, WIRD_PILL_STYLES } from '@/components/MushafWirdSelector';
import { useDropdownMotion } from '@/components/useDropdownMotion';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';

import { BUTTON_SLOP } from './placement';

type Props = {
  testID: string;
  label: string;
  hint: string;
  dark: boolean;
  rtl: boolean;
  /** The ورد pill's text colour as it is drawn now (its name, or its accent while no ورد is chosen), so all three match. */
  textColor: 'text' | 'accent';
  /** Whether this button's sheet is open: the chevron turns up while it is, and back down the moment it closes. */
  open: boolean;
  /** Not placed yet, zoomed, the page not drawn or another popup open: kept in place but unseen, untouchable and unannounced. */
  hidden: boolean;
  /** Where it is drawn, in the reading area (FeatureRow's placement). */
  position: ViewStyle;
  /** Its touch target above and below it (44 pt in all where nothing else is in the way); BUTTON_SLOP either side. */
  slopTop: number;
  slopBottom: number;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  /**
   * Arrow-only (the ورد name needs the room, placement.ts labelledButtons): the label is not drawn, the capsule keeps
   * this height (the labelled button's, so it stays on the pill's line at any text size) and is ARROW_ONLY_WIDTH wide.
   * The chevron, spoken label, hint and touch target stay as they are.
   */
  arrowOnlyHeight?: number;
};

/** An arrow-only button's width, exactly as laid out: the capsule's padding and border around the chevron. */
export const ARROW_ONLY_WIDTH = 2 * (WIRD_PILL_STYLES.pill.paddingHorizontal as number) + WIRD_CHEVRON_SIZE + 2 * StyleSheet.hairlineWidth;

/**
 * One of the reader's feature buttons under the page (المعاني, عن السورة): the ورد pill exactly — its capsule, colours,
 * text, chevron and pressed state, from MushafWirdSelector itself — with a fixed label. One line at its full size: the
 * width follows the label, the font never shrinks. Its chevron moves as the ورد pill's does (useDropdownMotion, the
 * sheet opening above it): down while closed, up while open, down again as soon as it closes.
 */
export function FeatureButton({ testID, label, hint, dark, rtl, textColor, open, hidden, position, slopTop, slopBottom, onPress, onLayout, arrowOnlyHeight }: Props) {
  const arrowOnly = arrowOnlyHeight !== undefined;
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const motion = useDropdownMotion(open, 'above');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ expanded: open }}
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      disabled={hidden}
      onPress={onPress}
      onLayout={onLayout}
      hitSlop={{ top: slopTop, bottom: slopBottom, left: BUTTON_SLOP, right: BUTTON_SLOP }}
      style={({ pressed }) => [
        WIRD_PILL_STYLES.pill,
        theme.pill,
        styles.placed,
        { flexDirection: rtl ? 'row-reverse' : 'row' },
        position,
        arrowOnly && { minHeight: arrowOnlyHeight },
        hidden && styles.hidden,
        pressed && WIRD_PILL_STYLES.pressed,
      ]}>
      {!arrowOnly && (
        <Text numberOfLines={1} style={[WIRD_PILL_STYLES.text, styles.label, { color: theme[textColor], writingDirection: rtl ? 'rtl' : 'ltr' }]}>
          {label}
        </Text>
      )}
      <Animated.View testID={`${testID}-chevron`} style={motion.chevronStyle}>
        <ChevronDown size={WIRD_CHEVRON_SIZE} color={theme.accent} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placed: {
    position: 'absolute',
  },
  // Its label is never shortened: the button is as wide as it needs (WIRD_PILL_STYLES.text lets the ورد name shrink).
  label: {
    flexShrink: 0,
  },
  hidden: {
    opacity: 0,
    pointerEvents: 'none',
  },
});
