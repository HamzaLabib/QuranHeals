import { Check, ChevronDown, Plus } from 'lucide-react-native';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import type { ReadingStop } from '@/mushaf/readingStops';

type Labels = {
  choose: string;
  selectorLabel: string;
  selectorHint: string;
  add: string;
  addNew: string;
  close: string;
  page: string;
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
  /** Distance from the screen's bottom edge to the pill's top, so the list opens just above it. */
  anchorBottom: number;
};

/** Height of the pill itself; its touch target is 44 pt. */
export const WIRD_PILL_HEIGHT = 26;

/**
 * The active reading stop (ورد), centred between the page and the floating
 * bar: "ورد الفجر ⌄". Tapping it lists the reader's stops (name and page,
 * a check on the active one) to switch between them; the list scrolls, stays
 * on screen and closes on a choice, a tap outside or Back. With no stops it
 * offers the bookmark's existing name field instead.
 *
 * Choosing a stop changes no stop: it only becomes the active one and the
 * reader opens its saved page (mushaf.tsx).
 */
export function MushafWirdSelector(props: MushafWirdSelectorProps) {
  const { labels, dark, rtl, stops, active, formatNumber } = props;
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const empty = stops.length === 0;
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
        hitSlop={{ top: (44 - WIRD_PILL_HEIGHT) / 2, bottom: (44 - WIRD_PILL_HEIGHT) / 2, left: 8, right: 8 }}
        style={({ pressed }) => [styles.pill, row, theme.pill, pressed && styles.pressed]}>
        {empty && <Plus size={14} color={theme.accent} />}
        <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.pillText, { color: active ? theme.text : theme.accent, writingDirection: rtl ? 'rtl' : 'ltr' }]}>
          {title}
        </Text>
        {!empty && <ChevronDown size={14} color={theme.accent} />}
      </Pressable>

      <Modal visible={props.open} transparent animationType="fade" onRequestClose={props.onClose}>
        {/* A tap anywhere outside the list closes it. */}
        <Pressable testID="mushaf-wird-backdrop" accessibilityLabel={labels.close} style={[styles.backdrop, { backgroundColor: theme.backdrop }]} onPress={props.onClose} />
        <View
          testID="mushaf-wird-list"
          accessibilityViewIsModal
          style={[styles.card, theme.sheet, { shadowColor: theme.surface.shadowColor, bottom: props.anchorBottom + 6, maxHeight: Math.min(380, windowHeight * 0.5), width: Math.min(340, windowWidth - 32) }]}>
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  // 26 pt tall at the default text size; taller when the system text size is larger (Android font scale, iOS Dynamic
  // Type), so its text is never cut. Always a capsule.
  pill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
    justifyContent: 'center',
    maxWidth: '72%',
    minHeight: WIRD_PILL_HEIGHT,
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  pillText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '600',
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
