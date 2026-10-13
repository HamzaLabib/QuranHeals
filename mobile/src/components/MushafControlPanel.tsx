import { ArrowLeft, ArrowRight, Bookmark, Check, Search } from 'lucide-react-native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ReflectionBulbIcon } from '@/components/ReflectionBulbIcon';
import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { READING_STOP_NAME_MAX_LENGTH } from '@/mushaf/readingStops';

export type MushafPopup = 'search' | 'save' | null;

type Labels = {
  previousPage: string;
  nextPage: string;
  reflect: string;
  searchPage: string;
  saveStop: string;
  stopName: string;
  confirmStop: string;
  /** The brief confirmation after a save, and the bookmark's spoken state when the page is saved. */
  saved: string;
};

type MushafControlPanelProps = {
  labels: Labels;
  dark: boolean;
  /** Bottom safe-area inset (home indicator, Android navigation bar). */
  bottomInset: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  /** Active only while an ayah is selected. */
  reflectionEnabled: boolean;
  onReflect: () => void;
  /** 'search' opens the reader's search sheet (MushafSearchSheet); 'save' the name field above the bar. */
  popup: MushafPopup;
  onPopup: (popup: MushafPopup) => void;
  /** The name the save field starts with: the active reading stop's, so saving updates it unless renamed. */
  defaultStopName?: string;
  /** Saves a page-based stop with this name; returns the message to show. */
  onSaveStop: (name: string) => Promise<{ tone: 'info' | 'error'; text: string }>;
  /**
   * This page is the selected ورد's saved page (from the stored stops, never
   * a visual toggle): the bookmark is drawn filled, in green. Says nothing
   * about cloud sync, which has its own status (أورادي وختماتي).
   */
  pageSaved: boolean;
};

/** How long the "Saved" confirmation stays. */
export const SAVED_TOAST_MS = 1800;

/** Height of the floating bar itself (without its bottom margin and the inset). */
export const MUSHAF_PANEL_HEIGHT = 56;
/** Between the bar and the bottom safe area (home indicator, navigation bar). */
export const MUSHAF_PANEL_MARGIN = 8;

/**
 * The reader's floating action bar: a rounded, translucent, icon-only bar
 * above the bottom safe area, in this fixed order from left to right:
 * next page (arrow-left), reflection (lightbulb), save a reading stop
 * (bookmark, in the centre), page search (search), previous page
 * (arrow-right) — the arrows as the Mushaf is read, right to left.
 * The bookmark is an outline, or filled green when this page is the
 * selected ورد's saved page; a successful save shows a brief "Saved".
 * Only the lightbulb changes with the selection: grey and without rays until
 * an ayah is selected, then lit with rays. Each button keeps a spoken label
 * for screen readers. Search opens the reader's search sheet; the bookmark,
 * a compact name field just above the bar.
 */
export function MushafControlPanel(props: MushafControlPanelProps) {
  const { labels, dark, bottomInset, popup } = props;
  const [stopName, setStopName] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  // The brief confirmation after a save: one at a time (a new save restarts it), never blocking.
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, SAVED_TOAST_MS);
  };
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const iconColor = theme.icon;

  const toggle = (next: Exclude<MushafPopup, null>) => {
    setNotice(null);
    if (next === 'save' && popup !== 'save') setStopName(props.defaultStopName ?? '');
    props.onPopup(popup === next ? null : next);
  };
  /** Saved: the keyboard and the field close, back to the page. Not saved: the field stays open with the reason, to retry. */
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await props.onSaveStop(stopName);
      if (result.tone === 'info') {
        // Only now: the page is saved on this device.
        setNotice(null);
        setStopName('');
        Keyboard.dismiss();
        props.onPopup(null);
        showToast(result.text);
      } else {
        setNotice(result);
      }
    } finally {
      setSaving(false);
    }
  };

  /** `greyed: false`: a disabled button whose icon already shows it (the unlit bulb) isn't faded further. */
  const button = (key: string, label: string, icon: ReactNode, onPress: () => void, options: { disabled?: boolean; selected?: boolean; greyed?: boolean } = {}) => (
    <Pressable
      key={key}
      testID={`mushaf-panel-${key}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(options.disabled), selected: Boolean(options.selected) }}
      disabled={options.disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.button, options.selected && theme.selected, options.disabled && options.greyed !== false && styles.disabled, pressed && styles.pressed]}>
      {icon}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.dock, { bottom: bottomInset + MUSHAF_PANEL_MARGIN }]}>
      {toast !== null && popup !== 'save' && (
        <View testID="mushaf-saved-toast" pointerEvents="none" style={[styles.toast, theme.surface]}>
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toastText, { color: theme.text }]}>{toast}</Text>
        </View>
      )}
      {popup === 'save' && (
        <View testID="mushaf-popup-save" style={[styles.popup, theme.surface]}>
          <View style={styles.popupRow}>
            <TextInput
              value={stopName}
              onChangeText={setStopName}
              placeholder={labels.stopName}
              placeholderTextColor={theme.placeholder}
              accessibilityLabel={labels.stopName}
              maxLength={READING_STOP_NAME_MAX_LENGTH}
              returnKeyType="done"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={() => void save()}
              style={[styles.input, theme.input]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={labels.confirmStop} accessibilityState={{ disabled: saving }} disabled={saving} onPress={() => void save()} hitSlop={6} style={({ pressed }) => [styles.go, theme.go, saving && styles.disabled, pressed && styles.pressed]}>
              <Check size={20} color={theme.onGo} />
            </Pressable>
          </View>
          {notice && (
            <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: notice.tone === 'error' ? theme.error : theme.text }]}>{notice.text}</Text>
          )}
        </View>
      )}

      {/*
        Left to right, whatever the app language: the order is fixed. The Mushaf reads right to left, so
        the left arrow turns to the NEXT page and the right arrow back to the PREVIOUS one (as do swipes).
      */}
      <View testID="mushaf-panel" style={[styles.bar, theme.surface]}>
        {button('next', labels.nextPage, <ArrowLeft size={ICON_SIZE} color={iconColor} />, props.onNext, { disabled: !props.canGoNext })}
        {button('reflect', labels.reflect, <ReflectionBulbIcon lit={props.reflectionEnabled} size={ICON_SIZE} color={props.reflectionEnabled ? theme.bulbOn : theme.bulbOff} />, props.onReflect, { disabled: !props.reflectionEnabled, greyed: false })}
        {button(
          'save',
          props.pageSaved ? `${labels.saveStop}, ${labels.saved}` : labels.saveStop,
          props.pageSaved
            ? <Bookmark testID="mushaf-bookmark-saved" size={ICON_SIZE} color={theme.saved} fill={theme.saved} />
            : <Bookmark testID="mushaf-bookmark-unsaved" size={ICON_SIZE} color={iconColor} fill="none" />,
          () => toggle('save'),
          { selected: popup === 'save' },
        )}
        {button('search', labels.searchPage, <Search size={ICON_SIZE} color={iconColor} />, () => toggle('search'), { selected: popup === 'search' })}
        {button('previous', labels.previousPage, <ArrowRight size={ICON_SIZE} color={iconColor} />, props.onPrevious, { disabled: !props.canGoPrevious })}
      </View>
    </KeyboardAvoidingView>
  );
}

/**
 * The bar's order is fixed left to right in every app language. Native
 * layout would only mirror `row` if RTL layout were ever enabled; `direction`
 * pins it there (react-native-web has no such style, and needs none).
 */
const FIXED_LTR = Platform.OS === 'web' ? {} : { direction: 'ltr' as const };
/** Every toolbar icon: one size, lucide's default stroke. */
const ICON_SIZE = 23;

const styles = StyleSheet.create({
  dock: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
  },
  bar: {
    alignItems: 'center',
    borderRadius: MUSHAF_PANEL_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    ...FIXED_LTR,
    elevation: 1,
    flexDirection: 'row',
    gap: 6,
    height: MUSHAF_PANEL_HEIGHT,
    justifyContent: 'space-between',
    maxWidth: 360,
    paddingHorizontal: 8,
    shadowOffset: { width: 0, height: 2 },
    // Barely there: the bar's colour, not a shadow, sets it apart.
    shadowOpacity: 0.06,
    shadowRadius: 6,
    width: '100%',
  },
  button: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  disabled: {
    opacity: 0.32,
  },
  pressed: {
    opacity: 0.6,
  },
  popup: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 1,
    marginBottom: 8,
    maxWidth: 360,
    padding: 10,
    shadowOffset: { width: 0, height: 2 },
    // Barely there: the bar's colour, not a shadow, sets it apart.
    shadowOpacity: 0.06,
    shadowRadius: 6,
    width: '100%',
  },
  popupRow: {
    alignItems: 'center',
    ...FIXED_LTR,
    flexDirection: 'row',
    gap: 8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    fontSize: 16,
    height: 44,
    paddingHorizontal: 12,
  },
  go: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  // As unobtrusive as the bar itself: a small pill just above it, gone after SAVED_TOAST_MS.
  toast: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
  },
  notice: {
    fontSize: 13,
    marginTop: 8,
    paddingHorizontal: 4,
  },
});
