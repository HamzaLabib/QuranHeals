import { BookMarked, Check, ChevronDown, Plus } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View, type DimensionValue, type LayoutRectangle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDropdownMotion } from '@/components/useDropdownMotion';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import type { ReadingStop } from '@/mushaf/readingStops';
import { DROPDOWN_GAP, resolveDropdownPlacement } from '@/utils/dropdownPlacement';

type Labels = {
  choose: string;
  selectorLabel: string;
  selectorHint: string;
  add: string;
  addNew: string;
  close: string;
  page: string;
  /** أورادي وختماتي: the page that manages every ورد. */
  manage: string;
};

type MushafWirdSelectorProps = {
  labels: Labels;
  dark: boolean;
  rtl: boolean;
  /** Formats a page number for the app language (Arabic-Indic in Arabic). */
  formatNumber: (n: number) => string;
  stops: readonly ReadingStop[];
  active: ReadingStop | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (stop: ReadingStop) => void;
  /** The existing way to create a stop: the bookmark's name field. */
  onAdd: () => void;
  /** Opens أورادي وختماتي. */
  onManage: () => void;
  /** Distance from the screen's bottom edge to the pill's top, so the list opens just above it. */
  anchorBottom: number;
  /** Narrower than the default (72% of the row) where other controls share the row: page 604's du'a and Complete Khatma. A longer name ends in “…”. */
  pillMaxWidth?: DimensionValue;
  /** Where the pill is laid out, in its row (read only: المعاني places itself beside it when there is room). */
  onPillLayout?: (layout: LayoutRectangle) => void;
};

/** Height of the pill itself; its touch target is 44 pt. */
export const WIRD_PILL_HEIGHT = 26;
/** The pill's chevron (ChevronDown, in the accent colour). */
export const WIRD_CHEVRON_SIZE = 14;
/** The pill's touch target beyond its edges: 44 pt tall, 8 pt either side. */
export const WIRD_PILL_HIT_SLOP = { top: (44 - WIRD_PILL_HEIGHT) / 2, bottom: (44 - WIRD_PILL_HEIGHT) / 2, left: 8, right: 8 };
/** The list's rows (44 pt), its title and padding, and its two last rows (new ورد, أورادي وختماتي): its full height. */
const listHeight = (rows: number) => 8 + 20 + rows * 44 + 1 + 2 * 44 + 8;

/**
 * The active reading stop (ورد), centred between the page and the floating
 * bar: "ورد الفجر ⌄". Tapping it lists the reader's stops (name and page,
 * a check on the active one) to switch between them; the list scrolls, stays
 * on screen and closes on a choice, a tap outside or Back. With no stops it
 * offers the bookmark's existing name field instead.
 *
 * The list opens above the pill (the bar is below it), or below where
 * there is no room above; the chevron turns to show which way it opens and
 * closes (utils/dropdownPlacement.ts).
 *
 * Choosing a stop changes no stop: it only becomes the active one and the
 * reader opens its saved page (mushaf.tsx). The last row opens أورادي
 * وختماتي, where every ورد is created, renamed, deleted and followed.
 */
export function MushafWirdSelector(props: MushafWirdSelectorProps) {
  const { labels, dark, rtl, stops, active, formatNumber } = props;
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const empty = stops.length === 0;
  const pillTop = windowHeight - props.anchorBottom;
  const { placement, maxHeight } = resolveDropdownPlacement({
    anchorTop: pillTop,
    anchorBottom: pillTop + WIRD_PILL_HEIGHT,
    menuHeight: listHeight(stops.length),
    maxHeight: Math.min(380, windowHeight * 0.5),
    windowHeight,
    safeTop: insets.top,
    safeBottom: insets.bottom,
    preferred: 'above',
  });
  const motion = useDropdownMotion(props.open, placement);
  const title = active ? active.name : empty ? labels.add : labels.choose;
  const row = rtl ? styles.rowRtl : styles.row;

  return (
    <>
      <Pressable
        testID="mushaf-wird"
        accessibilityRole="button"
        accessibilityLabel={active ? `${labels.selectorLabel}: ${active.name}` : title}
        accessibilityHint={empty ? undefined : labels.selectorHint}
        accessibilityState={{ expanded: props.open }}
        onPress={empty ? props.onAdd : props.onOpen}
        onLayout={props.onPillLayout ? (event) => props.onPillLayout?.(event.nativeEvent.layout) : undefined}
        hitSlop={WIRD_PILL_HIT_SLOP}
        style={({ pressed }) => [WIRD_PILL_STYLES.pill, styles.pillWidth, props.pillMaxWidth !== undefined && { maxWidth: props.pillMaxWidth }, row, theme.pill, pressed && WIRD_PILL_STYLES.pressed]}>
        {empty && <Plus size={14} color={theme.accent} />}
        <Text numberOfLines={1} ellipsizeMode="tail" style={[WIRD_PILL_STYLES.text, { color: active ? theme.text : theme.accent, writingDirection: rtl ? 'rtl' : 'ltr' }]}>
          {title}
        </Text>
        {!empty && (
          <Animated.View testID="mushaf-wird-chevron" style={motion.chevronStyle}>
            <ChevronDown size={WIRD_CHEVRON_SIZE} color={theme.accent} />
          </Animated.View>
        )}
      </Pressable>

      <Modal visible={motion.mounted} transparent animationType="none" onRequestClose={props.onClose}>
        {/* A tap anywhere outside the list closes it. */}
        <Animated.View style={[styles.backdrop, motion.backdropStyle]}>
          <Pressable testID="mushaf-wird-backdrop" accessibilityLabel={labels.close} style={[styles.backdrop, { backgroundColor: theme.backdrop }]} onPress={props.onClose} />
        </Animated.View>
        <Animated.View
          testID="mushaf-wird-list"
          accessibilityViewIsModal
          style={[
            styles.card,
            theme.sheet,
            { shadowColor: theme.surface.shadowColor, maxHeight, width: Math.min(340, windowWidth - 32) },
            placement === 'above' ? { bottom: props.anchorBottom + DROPDOWN_GAP } : { top: pillTop + WIRD_PILL_HEIGHT + DROPDOWN_GAP },
            motion.menuStyle,
          ]}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.muted, textAlign: rtl ? 'right' : 'left' }]}>{labels.choose}</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {stops.map((stop) => {
              const selected = stop.id === active?.id;
              const page = `${labels.page} ${formatNumber(stop.page)}`;
              return (
                <Pressable
                  key={stop.id}
                  testID={`mushaf-wird-${stop.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${stop.name}, ${page}`}
                  accessibilityState={{ selected }}
                  onPress={() => props.onSelect(stop)}
                  style={({ pressed }) => [styles.item, row, selected && theme.selected, pressed && styles.pressed]}>
                  <View style={styles.check}>{selected && <Check size={16} color={theme.accent} />}</View>
                  <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.name, { color: theme.text, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>
                    {stop.name}
                  </Text>
                  <Text style={[styles.page, { color: theme.muted }]}>{page}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={[styles.divider, { backgroundColor: theme.divider }]} />
          <Pressable
            testID="mushaf-wird-new"
            accessibilityRole="button"
            accessibilityLabel={labels.addNew}
            onPress={props.onAdd}
            style={({ pressed }) => [styles.item, row, pressed && styles.pressed]}>
            <View style={styles.check}><Plus size={16} color={theme.accent} /></View>
            <Text numberOfLines={1} style={[styles.name, { color: theme.accent, textAlign: rtl ? 'right' : 'left' }]}>{labels.addNew}</Text>
          </Pressable>
          <Pressable
            testID="mushaf-wird-manage"
            accessibilityRole="button"
            accessibilityLabel={labels.manage}
            onPress={props.onManage}
            style={({ pressed }) => [styles.item, row, pressed && styles.pressed]}>
            <View style={styles.check}><BookMarked size={16} color={theme.accent} /></View>
            <Text numberOfLines={1} style={[styles.name, { color: theme.accent, textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}>{labels.manage}</Text>
          </Pressable>
        </Animated.View>
      </Modal>
    </>
  );
}

/**
 * The pill's own look, shared with the reader's other controls under the page (mushafFeatures/: المعاني and عن
 * السورة), so they are drawn with these very values: capsule, border, height, padding, gap, text and pressed state. Its
 * colours are the theme's (MUSHAF_PANEL_COLORS.pill, accent, text).
 */
export const WIRD_PILL_STYLES = StyleSheet.create({
  // 26 pt tall at the default text size; taller when the system text size is larger (Android font scale, iOS Dynamic
  // Type), so its text is never cut. Always a capsule.
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    justifyContent: 'center',
    minHeight: WIRD_PILL_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  text: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.6,
  },
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  // The ورد name's widest (a longer name ends in “…”).
  pillWidth: {
    maxWidth: '72%',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  card: {
    alignSelf: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    paddingVertical: 8,
    position: 'absolute',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    paddingBottom: 4,
    paddingHorizontal: 16,
  },
  list: {
    flexGrow: 0,
  },
  item: {
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 6,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  check: {
    alignItems: 'center',
    width: 18,
  },
  name: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  page: {
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 16,
    marginVertical: 4,
  },
  pressed: {
    opacity: 0.6,
  },
});
