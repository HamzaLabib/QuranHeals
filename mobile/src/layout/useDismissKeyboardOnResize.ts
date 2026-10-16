import { useEffect, useRef } from 'react';
import { Keyboard, Platform, useWindowDimensions } from 'react-native';

/**
 * Android: closes the keyboard when the window's width changes (a tablet rotated, a split-screen or freeform window
 * resized) while a form is open. Android's KeyboardAvoidingView keeps the keyboard's position from before the change
 * and receives no new keyboard event, so the sheet was left squeezed into the old space with its buttons cut off
 * (Android 17 tablet emulator, 2026-10-16). Closed, the sheet lays itself out whole, the typed text is kept, and a tap
 * on the field brings the keyboard back, measured afresh.
 *
 * Only the width counts: the keyboard itself never changes the window's width, so opening it can't close it. iOS sends
 * a keyboard event on rotation and is left alone. Phones (portrait only) never get here. `active` false (a form that
 * is mounted but not shown) never touches the keyboard.
 */
export function useDismissKeyboardOnResize(active = true) {
  const { width } = useWindowDimensions();
  const seenWidth = useRef(width);
  useEffect(() => {
    if (seenWidth.current === width) return;
    seenWidth.current = width;
    if (active && Platform.OS === 'android') Keyboard.dismiss();
    // Only when the width changes; active is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);
}

/**
 * A key for a KeyboardAvoidingView (behavior 'height' on Android) that changes with the window's width: Android's
 * KeyboardAvoidingView sizes itself from the height it measured first, so after a rotation it kept the old orientation's
 * height (a portrait sheet ended ~1000 px above the keyboard, measured on the Android 17 tablet emulator). Re-created
 * with this key, it measures again. Its text stays: the forms keep it in their own state. Also closes the keyboard then
 * (useDismissKeyboardOnResize). Width only, as there: the keyboard never changes it.
 */
export function useKeyboardAvoidingKey(active = true): string {
  useDismissKeyboardOnResize(active);
  const { width } = useWindowDimensions();
  return `keyboard-avoiding-${Math.round(width)}`;
}
