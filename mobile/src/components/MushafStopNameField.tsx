import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { READING_STOP_NAME_MAX_LENGTH } from '@/mushaf/readingStops';

/** How long the "Saved" confirmation stays (as the retired bar's, SAVED_TOAST_MS). */
export const SAVED_TOAST_MS = 1800;
/** Above the bottom safe area, where the retired bar's name field sat (its margin). */
const DOCK_MARGIN = 8;

type Labels = { stopName: string; confirmStop: string };

type Props = {
  visible: boolean;
  labels: Labels;
  dark: boolean;
  bottomInset: number;
  /** The name the field starts with: the active ورد's, so saving updates it unless renamed. */
  defaultStopName?: string;
  /** Saves this page to the ورد of that name (created when new); returns the message to show. */
  onSave: (name: string) => Promise<{ tone: 'info' | 'error'; text: string }>;
  onClose: () => void;
};

/**
 * The ورد name field: the existing way to create a ورد (or save this page to one by name) from the reader, opened by the
 * ورد list's Add. Kept exactly as it was inside the retired navigation bar (design-archive/mushaf-navigation-v1/:
 * MushafControlPanel's 'save' popup): the same field, Check button, error notice and brief "Saved". Saved: the field
 * closes and "Saved" shows; not saved: it stays open with the reason. A tap outside closes it (the bar's bookmark,
 * which used to, is gone).
 */
export function MushafStopNameField({ visible, labels, dark, bottomInset, defaultStopName, onSave, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const [stopName, setStopName] = useState('');
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  // Each opening starts from the active ورد's name.
  const [openedFor, setOpenedFor] = useState(false);
  if (visible !== openedFor) {
    setOpenedFor(visible);
    if (visible) {
      setStopName(defaultStopName ?? '');
      setNotice(null);
    }
  }
  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => {
      toastTimer.current = null;
      setToast(null);
    }, SAVED_TOAST_MS);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await onSave(stopName);
      if (result.tone === 'info') {
        setNotice(null);
        setStopName('');
        Keyboard.dismiss();
        onClose();
        showToast(result.text);
      } else {
        setNotice(result);
      }
    } finally {
      setSaving(false);
    }
  };
  const close = () => {
    Keyboard.dismiss();
    onClose();
  };

  if (!visible && toast === null) return null;
  return (
    <>
      {visible && <Pressable testID="mushaf-stop-name-backdrop" accessible={false} style={StyleSheet.absoluteFill} onPress={close} />}
      <KeyboardAvoidingView
        pointerEvents="box-none"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.dock, { bottom: bottomInset + DOCK_MARGIN }]}>
        {toast !== null && !visible && (
          <View testID="mushaf-saved-toast" pointerEvents="none" style={[styles.toast, theme.surface]}>
            <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.toastText, { color: theme.text }]}>{toast}</Text>
          </View>
        )}
        {visible && (
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
      </KeyboardAvoidingView>
    </>
  );
}

/** The row's order is fixed left to right in every app language, as the retired bar's. */
const FIXED_LTR = Platform.OS === 'web' ? {} : { direction: 'ltr' as const };

const styles = StyleSheet.create({
  dock: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
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
