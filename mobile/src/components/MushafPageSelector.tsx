import { ArrowLeft, ArrowRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { InputAccessoryView, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';

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
  /** The Go button shown beside the arrow while a page is typed ("Go"). */
  go: string;
  /** The bar above the iOS number pad: hides the keyboard ("Done"). */
  keyboardDone: string;
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
export const PAGE_SELECTOR_BOTTOM_MARGIN = 8;
const BOTTOM_MARGIN = PAGE_SELECTOR_BOTTOM_MARGIN;
/** The iOS number pad's Done bar (InputAccessoryView), tied to the field by this id. */
const KEYBOARD_BAR_ID = 'mushaf-page-selector-keyboard';
/** iOS reports the keyboard before it moves (so the card moves with it); Android only once it has. */
const KEYBOARD_SHOW = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const KEYBOARD_HIDE = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
/**
 * The card's height (padding 8 + the 44-pt row + the slider row + padding 4, and its two hairline borders, rounded up):
 * the reader keeps Normal Mode's Quran text clear of it (fitMushafPage). An out-of-range typed page adds a line while the
 * keyboard is open.
 */
export const PAGE_SELECTOR_CARD_HEIGHT = 8 + 44 + SLIDER_TOUCH + 4 + 2;

/**
 * The compact page selector, opened by tapping the page number under the frame: a slim card near the bottom of the
 * screen, nearly full width, with
 *  - a top row, physically fixed in every language: the selected page's Surah on the LEFT, the selected page number in
 *    the CENTRE (tap it to type one), its juz' on the RIGHT; both from the page's first ayah (mushaf/navigation.ts);
 *  - one RTL slider: page 1 at the right, 604 at the left, a small circular thumb in the reader's accent (olive).
 * Moving the thumb or typing only previews: the Mushaf stays where it is. The one way to go is the arrow beside the
 * number (mushaf/pageSelector.ts navigationArrow): a later page, a left arrow on the number's left; an earlier one, a
 * right arrow on its right; the same page, none. A tap outside (or Back) closes it and changes nothing.
 *
 * Typing a page (tap the number): the card rides above the keyboard (it sits at the bottom of a KeyboardAvoidingView,
 * in the layout, so the space the keyboard takes is subtracted from it; an absolutely positioned card would stay behind
 * the keyboard on iOS, where the view makes room with padding, which absolute positions ignore). While a whole, valid
 * page other than the current one is typed (or slid to: Go shows for the slider too), a labelled Go button joins the
 * arrow on its outer side ("Go ← 200", "45 → Go"). The keyboard closes with the Done bar above the iOS number pad, a tap anywhere outside the field (the card
 * or the dimmed screen: only the keyboard closes then, never the selector) or Android's own keys; the typed number stays
 * in the field. Going (Go, the arrow, or Android's Go key) closes the keyboard and the selector.
 */
export function MushafPageSelector({ visible, currentPage, labels, dark, bottomInset, formatNumber, surahName, juzLabel, onGo, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const [selected, setSelected] = useState(currentPage);
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [trackWidth, setTrackWidth] = useState(0);
  const [keyboardShown, setKeyboardShown] = useState(false);
  useEffect(() => {
    if (!visible) return undefined;
    const shown = Keyboard.addListener(KEYBOARD_SHOW, () => setKeyboardShown(true));
    const hidden = Keyboard.addListener(KEYBOARD_HIDE, () => setKeyboardShown(false));
    return () => {
      shown.remove();
      hidden.remove();
      setKeyboardShown(false);
    };
  }, [visible]);
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
  // Outside the field while the keyboard is up: only the keyboard closes (the typed number stays).
  const outside = () => (keyboardShown ? Keyboard.dismiss() : close());
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

  const goButton = (
    <Pressable
      testID="mushaf-page-go-button"
      accessibilityRole="button"
      accessibilityLabel={fill(labels.goToSelected, { page: formatNumber(selected) })}
      onPress={go}
      hitSlop={6}
      style={({ pressed }) => [styles.goButton, { backgroundColor: theme.accent }, pressed && styles.pressed]}>
      <Text numberOfLines={1} style={[styles.goText, { color: theme.sheet.backgroundColor }]}>{labels.go}</Text>
    </Pressable>
  );
  // Whenever there is somewhere to go — a page typed or slid to that is not the one being read — beside the arrow, on
  // its outer side. Never for the current page or a typed number that is not a page (no arrow then either).
  const showGo = arrow !== null;

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
        <Pressable testID="mushaf-page-selector-backdrop" accessibilityLabel={labels.close} style={StyleSheet.absoluteFill} onPress={outside} />
        {/* In the layout (not absolute), at the bottom: lifted above the keyboard with the space it takes. A tap on the card outside its controls closes only the keyboard. */}
        <View
          testID="mushaf-page-selector"
          onStartShouldSetResponder={() => keyboardShown}
          onResponderRelease={() => Keyboard.dismiss()}
          style={[styles.card, theme.sheet, { marginBottom: keyboardShown ? BOTTOM_MARGIN : bottomInset + BOTTOM_MARGIN }]}>
          <View style={[styles.topRow, FIXED_LTR]}>
            <Text testID="mushaf-page-selector-surah" numberOfLines={1} style={[styles.side, styles.left, { color: theme.text }]}>{surahName(info.surah)}</Text>
            <View style={[styles.centre, FIXED_LTR]}>
              {showGo && arrow === 'left' && goButton}
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
                  inputAccessoryViewID={Platform.OS === 'ios' ? KEYBOARD_BAR_ID : undefined}
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
              {showGo && arrow === 'right' && goButton}
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
      {/* The iOS number pad has no return key: this bar's Done closes the keyboard (the typed number stays; Go goes). */}
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID={KEYBOARD_BAR_ID} backgroundColor={theme.sheet.backgroundColor}>
          <View style={[styles.keyboardBar, { borderTopColor: theme.divider }]}>
            <Pressable
              testID="mushaf-page-selector-done"
              accessibilityRole="button"
              accessibilityLabel={labels.keyboardDone}
              onPress={() => Keyboard.dismiss()}
              hitSlop={8}
              style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}>
              <Text style={[styles.doneText, { color: theme.accent }]}>{labels.keyboardDone}</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </Modal>
  );
}

/** Physical left-to-right in every language: the row and the slider never mirror (react-native-web needs no style). */
const FIXED_LTR = Platform.OS === 'web' ? {} : { direction: 'ltr' as const };

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 2,
    marginHorizontal: SIDE_MARGIN,
    paddingBottom: 4,
    paddingHorizontal: 12 + THUMB / 2,
    paddingTop: 8,
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
  // A fixed width, with room for Go beside the arrow on either side: the arrow and Go appearing, moving or going
  // never shift the Surah or juz'.
  centre: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    width: 184,
  },
  goButton: {
    alignItems: 'center',
    borderRadius: 14,
    height: 32,
    justifyContent: 'center',
    marginHorizontal: 2,
    minWidth: 44,
    paddingHorizontal: 10,
  },
  goText: {
    fontSize: 14,
    fontWeight: '800',
  },
  keyboardBar: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    minHeight: 44,
    paddingHorizontal: 16,
  },
  doneButton: {
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 8,
  },
  doneText: {
    fontSize: 17,
    fontWeight: '700',
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
