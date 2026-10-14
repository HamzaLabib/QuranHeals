import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import { useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { fill } from '@/localization/fill';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { pageInfo, parseTypedPage } from '@/mushaf/navigation';
import { navigationArrow, pageAtTrackX, trackXOfPage } from '@/mushaf/pageSelector';

type Labels = {
  /** The slider's spoken name ("Page"). */
  pageSlider: string;
  /** The arrow's spoken label, with {page}. */
  goToSelected: string;
  /** The number's spoken hint and the field's label. */
  editPage: string;
  /** Shown under a typed number that is not a page. */
  pageOutOfRange: string;
  close: string;
};

type Props = {
  visible: boolean;
  /** The page being read: where the selection starts, and what the arrow compares with. */
  currentPage: number;
  labels: Labels;
  dark: boolean;
  bottomInset: number;
  formatNumber: (n: number) => string;
  /** The Surah's name as shown in the app's language. */
  surahName: (surah: number) => string;
  /** "Juz' 12" / "الجزء ١٢". */
  juzLabel: (juz: number) => string;
  /** The arrow: go to this page (validated, 1–604, not the current page). */
  onGo: (page: number) => void;
  onClose: () => void;
};

/** The thumb's diameter, and the touch height of the slider row around it. */
const THUMB = 22;
const SLIDER_TOUCH = 36;
/** Side margins: nearly the phone's full width. */
const SIDE_MARGIN = 14;
/** Above the bottom safe area. */
const BOTTOM_MARGIN = 8;

/**
 * The compact page selector, opened by tapping the page number under the frame: a slim card near the bottom of the
 * screen, nearly full width, with
 *  - a top row, physically fixed in every language: the selected page's Surah on the LEFT, the selected page number in
 *    the CENTRE (tap it to type one), its juz' on the RIGHT; both from the page's first ayah (mushaf/navigation.ts);
 *  - one RTL slider: page 1 at the right, 604 at the left, a small circular thumb in the reader's accent (olive).
 * Moving the thumb or typing only previews: the Mushaf stays where it is. The one way to go is the arrow beside the
 * number (mushaf/pageSelector.ts navigationArrow): a later page, a left arrow on the number's left; an earlier one, a
 * right arrow on its right; the same page, none. A tap outside (or Back) closes it and changes nothing.
 */
export function MushafPageSelector({ visible, currentPage, labels, dark, bottomInset, formatNumber, surahName, juzLabel, onGo, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const [selected, setSelected] = useState(currentPage);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [trackWidth, setTrackWidth] = useState(0);
  // Each opening starts at the page being read.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const opening = visible ? currentPage : null;
  if (opening !== openedAt) {
    setOpenedAt(opening);
    if (opening !== null) {
      setSelected(opening);
      setEditing(false);
      setTyped('');
    }
  }

  const info = pageInfo(selected) ?? pageInfo(1)!;
  const typedPage = editing ? parseTypedPage(typed) : selected;
  const typedInvalid = editing && typed.trim() !== '' && typedPage === null;
  // Typing: only a whole, valid page may be gone to; nothing (or something else) typed shows no arrow.
  const arrow = editing && typedPage === null ? null : navigationArrow(selected, currentPage);

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const go = () => {
    const target = editing ? parseTypedPage(typed) : selected;
    if (target === null || target === currentPage) return;
    Keyboard.dismiss();
    onGo(target);
  };
  const fromTouch = (event: GestureResponderEvent) => {
    if (editing) {
      setEditing(false);
      Keyboard.dismiss();
    }
    setSelected(pageAtTrackX(event.nativeEvent.locationX, trackWidth));
  };
  const step = (delta: 1 | -1) => setSelected((page) => Math.min(MUSHAF_PAGE_COUNT, Math.max(1, page + delta)));

  const arrowButton = (side: 'left' | 'right') => (
    <Pressable
      testID={`mushaf-page-go-${side}`}
      accessibilityRole="button"
      accessibilityLabel={fill(labels.goToSelected, { page: formatNumber(selected) })}
      onPress={go}
      hitSlop={10}
      style={({ pressed }) => [styles.arrow, pressed && styles.pressed]}>
      {side === 'left' ? <ArrowLeft size={22} strokeWidth={2.4} color={theme.accent} /> : <ArrowRight size={22} strokeWidth={2.4} color={theme.accent} />}
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable testID="mushaf-page-selector-backdrop" accessibilityLabel={labels.close} style={StyleSheet.absoluteFill} onPress={close} />
        <View testID="mushaf-page-selector" style={[styles.card, theme.sheet, { bottom: bottomInset + BOTTOM_MARGIN }]}>
          <View style={[styles.topRow, FIXED_LTR]}>
            <Text testID="mushaf-page-selector-surah" numberOfLines={1} style={[styles.side, styles.left, { color: theme.text }]}>{surahName(info.surah)}</Text>
            <View style={[styles.centre, FIXED_LTR]}>
              {arrow === 'left' && arrowButton('left')}
              {editing ? (
                <TextInput
                  testID="mushaf-page-selector-input"
                  value={typed}
                  onChangeText={(text) => {
                    setTyped(text);
                    const page = parseTypedPage(text);
                    if (page !== null) setSelected(page);
                  }}
                  placeholder={formatNumber(selected)}
                  placeholderTextColor={theme.placeholder}
                  accessibilityLabel={labels.editPage}
                  keyboardType="number-pad"
                  returnKeyType={Platform.OS === 'ios' ? 'none' : 'go'}
                  maxLength={3}
                  autoFocus
                  onSubmitEditing={go}
                  style={[styles.input, theme.input, typedInvalid && { borderColor: theme.error }]}
                />
              ) : (
                <Pressable
                  testID="mushaf-page-selector-number"
                  accessibilityRole="button"
                  accessibilityLabel={formatNumber(selected)}
                  accessibilityHint={labels.editPage}
                  onPress={() => {
                    setTyped('');
                    setEditing(true);
                  }}
                  hitSlop={6}
                  style={({ pressed }) => [styles.number, pressed && styles.pressed]}>
                  <Text style={[styles.numberText, { color: theme.text }]}>{formatNumber(selected)}</Text>
                </Pressable>
              )}
              {arrow === 'right' && arrowButton('right')}
            </View>
            <Text testID="mushaf-page-selector-juz" numberOfLines={1} style={[styles.side, styles.right, { color: theme.text }]}>{juzLabel(info.juz)}</Text>
          </View>
          {typedInvalid && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error }]}>{labels.pageOutOfRange}</Text>}
          <View
            testID="mushaf-page-slider"
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
            onResponderGrant={fromTouch}
            onResponderMove={fromTouch}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={labels.pageSlider}
            accessibilityValue={{ min: 1, max: MUSHAF_PAGE_COUNT, now: selected, text: formatNumber(selected) }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={(event) => step(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
            style={[styles.slider, FIXED_LTR]}>
            <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.divider }]} />
            <View
              testID="mushaf-page-slider-thumb"
              pointerEvents="none"
              style={[styles.thumb, { backgroundColor: theme.accent, borderColor: theme.sheet.backgroundColor, left: trackXOfPage(selected, trackWidth) - THUMB / 2 }]}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Physical left-to-right in every language: the row and the slider never mirror (react-native-web needs no style). */
const FIXED_LTR = Platform.OS === 'web' ? {} : { direction: 'ltr' as const };

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    left: SIDE_MARGIN,
    paddingBottom: 4,
    paddingHorizontal: 12 + THUMB / 2,
    paddingTop: 8,
    position: 'absolute',
    right: SIDE_MARGIN,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minHeight: 44,
  },
  side: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  left: {
    textAlign: 'left',
  },
  right: {
    textAlign: 'right',
  },
  // A fixed width: the arrow appearing or moving never shifts the Surah or juz'.
  centre: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    width: 128,
  },
  number: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 56,
    paddingHorizontal: 6,
  },
  numberText: {
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    fontSize: 18,
    fontWeight: '700',
    height: 40,
    paddingHorizontal: 8,
    textAlign: 'center',
    width: 64,
  },
  arrow: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 32,
  },
  error: {
    fontSize: 12,
    textAlign: 'center',
  },
  slider: {
    height: SLIDER_TOUCH,
    justifyContent: 'center',
  },
  track: {
    borderRadius: 2,
    height: 3,
  },
  thumb: {
    borderRadius: THUMB / 2,
    borderWidth: 2,
    height: THUMB,
    position: 'absolute',
    top: (SLIDER_TOUCH - THUMB) / 2,
    width: THUMB,
  },
  pressed: {
    opacity: 0.6,
  },
});
