import { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { computeGuidePlacement, GUIDE_CARD_MAX_WIDTH, GUIDE_SIDE_MARGIN, type Rect } from '@/mushaf/mushafGuide';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type MushafGuideProps = {
  visible: boolean;
  /** 0-based. */
  step: number;
  total: number;
  /** This step's instruction. */
  text: string;
  labels: { next: string; back: string; close: string; start: string; stepOf: string; notOnPage: string; reopenHint: string };
  dark: boolean;
  rtl: boolean;
  direction: Direction;
  safe: { top: number; bottom: number };
  /** The real control this step points at, if it is on screen now (guideTargets.tsx). */
  getTarget: () => { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void } | null | undefined;
  /** Changes whenever the target may have moved or appeared (a control registered, the page, the reading mode). */
  measureKey: string;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
  onFinish: () => void;
};

/**
 * The first-time Mushaf guide's overlay (mushaf/mushafGuide.ts). A full-screen layer over the reader, so no tap can
 * reach the Mushaf while it is shown: the screen is dimmed except a soft highlight around the step's real control,
 * with an arrow from a compact card to it. Positions come from measuring the control where it is drawn
 * (measureInWindow, in the window's coordinates: the layer is statusBarTranslucent so its own coordinates match), and
 * are measured again whenever the control, the page, the reading mode, the screen size or the app's return to the
 * foreground may have moved it. A control that is not on screen (a page without a Hizb mark, a page still loading) gets
 * no arrow: the card is centred and says so, rather than pointing at the wrong place.
 *
 * Only its buttons close or move it: Back, Close, Next, and on the last step Start Reading (with, above it, where the
 * guide can be opened again). A tap elsewhere does nothing,
 * and Android's Back key goes to the previous step (never closing it).
 */
export function MushafGuide(props: MushafGuideProps) {
  const { visible, step, total, text, labels, dark, rtl, direction, safe, getTarget, measureKey } = props;
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const screen = useWindowDimensions();
  const [rect, setRect] = useState<Rect | null>(null);
  const [foregrounds, setForegrounds] = useState(0);

  const measure = useCallback(() => {
    const view = getTarget();
    if (!view) {
      setRect(null);
      return;
    }
    view.measureInWindow((x, y, width, height) => {
      setRect(width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y, width, height } : null);
    });
  }, [getTarget]);

  useEffect(() => {
    if (!visible) return undefined;
    // After this frame's layout, and once more shortly after: a control that has just mounted may not be laid out yet.
    const now = setTimeout(measure, 0);
    const later = setTimeout(measure, 80);
    return () => {
      clearTimeout(now);
      clearTimeout(later);
    };
  }, [visible, step, measureKey, screen.width, screen.height, foregrounds, measure]);

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setForegrounds((n) => n + 1);
    });
    return () => subscription.remove();
  }, [visible]);

  const placement = rect ? computeGuidePlacement(rect, screen, safe) : null;
  const last = step === total - 1;
  const counter = labels.stepOf.replace('{n}', String(step + 1)).replace('{total}', String(total));

  const card = (
    <View
      testID="mushaf-guide-card"
      accessibilityViewIsModal
      style={[
        styles.card,
        theme.sheet,
        placement
          ? { position: 'absolute', left: placement.card.left, width: placement.card.width, ...('top' in placement.card ? { top: placement.card.top } : { bottom: placement.card.bottom }) }
          : { width: Math.min(GUIDE_CARD_MAX_WIDTH, screen.width - GUIDE_SIDE_MARGIN * 2) },
      ]}>
      <Text style={[styles.counter, { color: theme.muted }, direction]}>{counter}</Text>
      <Text testID="mushaf-guide-text" accessibilityRole="header" style={[styles.text, { color: theme.text }, direction]}>{text}</Text>
      {!placement && <Text testID="mushaf-guide-not-on-page" style={[styles.note, { color: theme.muted }, direction]}>{labels.notOnPage}</Text>}
      {/* The last step: where to find the guide again, just above Start Reading. */}
      {last && <Text testID="mushaf-guide-reopen-hint" style={[styles.note, { color: theme.muted }, direction]}>{labels.reopenHint}</Text>}
      <View style={[styles.actions, rtl && styles.rowReverse]}>
        {step > 0 && (
          <Pressable testID="mushaf-guide-back" accessibilityRole="button" accessibilityLabel={labels.back} onPress={props.onBack} hitSlop={6} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
            <Text style={[styles.secondaryText, { color: theme.text }]}>{labels.back}</Text>
          </Pressable>
        )}
        <Pressable testID="mushaf-guide-close" accessibilityRole="button" accessibilityLabel={labels.close} onPress={props.onClose} hitSlop={6} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}>
          <Text style={[styles.secondaryText, { color: theme.muted }]}>{labels.close}</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          testID={last ? 'mushaf-guide-start' : 'mushaf-guide-next'}
          accessibilityRole="button"
          accessibilityLabel={last ? labels.start : labels.next}
          onPress={last ? props.onFinish : props.onNext}
          hitSlop={6}
          style={({ pressed }) => [styles.primary, theme.go, pressed && styles.pressed]}>
          <Text style={[styles.primaryText, { color: theme.onGo }]}>{last ? labels.start : labels.next}</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="fade" onRequestClose={() => { if (step > 0) props.onBack(); }}>
      {/* Catches every tap outside the card: nothing beneath can be touched, and nothing closes the guide. */}
      <View testID="mushaf-guide" style={[StyleSheet.absoluteFill, !placement && styles.centred]} onStartShouldSetResponder={() => true}>
        {placement ? (
          <>
            {/* The dimmed screen around the highlighted control: four panes leave it uncovered. */}
            <View pointerEvents="none" style={[styles.pane, { backgroundColor: theme.backdrop, left: 0, right: 0, top: 0, height: Math.max(0, placement.hole.y) }]} />
            <View pointerEvents="none" style={[styles.pane, { backgroundColor: theme.backdrop, left: 0, right: 0, top: placement.hole.y + placement.hole.height, bottom: 0 }]} />
            <View pointerEvents="none" style={[styles.pane, { backgroundColor: theme.backdrop, left: 0, width: Math.max(0, placement.hole.x), top: placement.hole.y, height: placement.hole.height }]} />
            <View pointerEvents="none" style={[styles.pane, { backgroundColor: theme.backdrop, left: placement.hole.x + placement.hole.width, right: 0, top: placement.hole.y, height: placement.hole.height }]} />
            <View
              testID="mushaf-guide-highlight"
              pointerEvents="none"
              style={[styles.highlight, { borderColor: theme.accent, left: placement.hole.x, top: placement.hole.y, width: placement.hole.width, height: placement.hole.height }]}
            />
            <GuideArrow testID="mushaf-guide-arrow" x={placement.arrow.x} fromY={placement.arrow.fromY} toY={placement.arrow.toY} color={theme.accent} />
          </>
        ) : (
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: theme.backdrop }]} />
        )}
        {card}
      </View>
    </Modal>
  );
}

/** A straight arrow from the card's edge (fromY) to the highlighted control (toY), its head at the control. */
function GuideArrow({ testID, x, fromY, toY, color }: { testID: string; x: number; fromY: number; toY: number; color: string }) {
  const top = Math.min(fromY, toY);
  const length = Math.abs(toY - fromY);
  const width = 16;
  const head = toY < fromY ? 0 : length; // the head's end: at the control
  const dir = toY < fromY ? 1 : -1;
  return (
    <View testID={testID} pointerEvents="none" style={[styles.pane, { left: x - width / 2, top, width, height: length }]}>
      <Svg width={width} height={length}>
        <Line x1={width / 2} y1={toY < fromY ? 3 : 0} x2={width / 2} y2={toY < fromY ? length : length - 3} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        <Path d={`M${width / 2 - 6} ${head + dir * 8} L${width / 2} ${head + dir * 1} L${width / 2 + 6} ${head + dir * 8}`} stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pane: {
    position: 'absolute',
  },
  highlight: {
    borderRadius: 10,
    borderWidth: 2,
    position: 'absolute',
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  counter: {
    fontSize: 12,
    fontWeight: '700',
  },
  text: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 23,
  },
  note: {
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  spacer: {
    flex: 1,
  },
  secondary: {
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 8,
  },
  secondaryText: {
    fontSize: 15,
    fontWeight: '700',
  },
  primary: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 18,
  },
  primaryText: {
    fontSize: 15,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
});
