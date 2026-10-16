import { Check, ChevronDown } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { DROPDOWN_GAP, resolveDropdownPlacement } from '@/utils/dropdownPlacement';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

export type CompactDropdownOption<T extends string | number> = { value: T; label: string };

type CompactDropdownProps<T extends string | number> = {
  testID: string;
  /** What is being chosen ("Frequency"), for screen readers: "Frequency, Daily". */
  accessibilityLabel: string;
  accessibilityHint?: string;
  value: T;
  options: readonly CompactDropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  direction: Direction;
  /** `chip`: a small bordered selector (the frequency); `text`: the secondary-text weekday under a reminder's name. */
  variant?: 'chip' | 'text';
};

const MENU_ROW_HEIGHT = 48;
const MENU_WIDTH = 220;

/**
 * A small selector that opens a short menu right beside it (Settings'
 * reminder frequency and weekday): no new screen, no Save or Done — choosing
 * an option applies it and closes the menu; a tap outside or Back closes it
 * unchanged. The menu opens below the selector, or above when there is no
 * room (utils/dropdownPlacement.ts, as the ورد selectors), aligned to the
 * selector's trailing edge in the reading direction and kept on screen.
 */
export function CompactDropdown<T extends string | number>(props: CompactDropdownProps<T>) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const anchorRef = useRef<View>(null);
  const [menu, setMenu] = useState<{ top?: number; bottom?: number; left: number; maxHeight: number } | null>(null);
  const rtl = props.direction.writingDirection === 'rtl';
  const selected = props.options.find((option) => option.value === props.value);
  const variant = props.variant ?? 'chip';

  const open = () => {
    if (props.disabled) return;
    const anchor = anchorRef.current;
    const place = (x: number, y: number, anchorWidth: number, anchorHeight: number) => {
      const { placement, maxHeight } = resolveDropdownPlacement({
        anchorTop: y,
        anchorBottom: y + anchorHeight,
        menuHeight: props.options.length * MENU_ROW_HEIGHT + spacing.sm,
        maxHeight: window.height * 0.6,
        windowHeight: window.height,
        safeTop: insets.top,
        safeBottom: insets.bottom,
        preferred: 'below',
      });
      const menuWidth = Math.min(MENU_WIDTH, window.width - spacing.lg * 2);
      // Trailing-aligned: under the selector's right edge in English, its left edge in Arabic; always on screen.
      const preferredLeft = rtl ? x : x + anchorWidth - menuWidth;
      const left = Math.max(spacing.lg, Math.min(preferredLeft, window.width - spacing.lg - menuWidth));
      setMenu(placement === 'below'
        ? { top: y + anchorHeight + DROPDOWN_GAP, left, maxHeight }
        : { bottom: window.height - y + DROPDOWN_GAP, left, maxHeight });
    };
    if (anchor && typeof anchor.measureInWindow === 'function') {
      anchor.measureInWindow((x, y, width, height) => place(x, y, width, height));
    } else {
      place(spacing.lg, window.height / 3, MENU_WIDTH, MENU_ROW_HEIGHT);
    }
  };

  const close = () => setMenu(null);

  // The window rotated or was resized while the menu is open (tablets, split screen): placed again beside its selector.
  const windowSize = `${window.width}x${window.height}`;
  const placedFor = useRef(windowSize);
  const isOpen = menu !== null;
  useEffect(() => {
    if (placedFor.current === windowSize) return;
    placedFor.current = windowSize;
    if (isOpen) open();
    // Only when the window changes; open() reads the current window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowSize, isOpen]);

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable
          testID={props.testID}
          accessibilityRole="button"
          accessibilityLabel={`${props.accessibilityLabel}, ${selected?.label ?? ''}`}
          accessibilityHint={props.accessibilityHint}
          accessibilityState={{ disabled: !!props.disabled, expanded: menu !== null }}
          disabled={props.disabled}
          hitSlop={variant === 'text' ? { top: 12, bottom: 12, left: 8, right: 8 } : { top: 6, bottom: 6 }}
          onPress={open}
          style={({ pressed }) => [
            variant === 'chip' ? styles.chip : styles.textTrigger,
            rtl && styles.rowRtl,
            props.disabled && styles.disabled,
            pressed && styles.pressed,
          ]}>
          <Text style={[variant === 'chip' ? styles.chipLabel : styles.textLabel, props.direction, props.disabled && styles.disabledText]}>{selected?.label}</Text>
          <ChevronDown size={variant === 'chip' ? 16 : 14} color={props.disabled ? colors.textMuted : colors.accent} strokeWidth={2.5} />
        </Pressable>
      </View>
      {/* statusBarTranslucent (Android): the modal starts at the window's top, as measureInWindow does, so the menu sits beside its selector (as ContinueReadingCard's menu). */}
      <Modal visible={menu !== null} transparent statusBarTranslucent animationType="fade" onRequestClose={close}>
        <Pressable testID={`${props.testID}-backdrop`} accessibilityLabel={props.accessibilityLabel} style={styles.backdrop} onPress={close} />
        {menu && (
          <View
            testID={`${props.testID}-menu`}
            accessibilityViewIsModal
            style={[styles.menu, { top: menu.top, bottom: menu.bottom, left: menu.left, maxHeight: menu.maxHeight, width: Math.min(MENU_WIDTH, window.width - spacing.lg * 2) }]}>
            {props.options.map((option) => {
              const isSelected = option.value === props.value;
              return (
                <Pressable
                  key={String(option.value)}
                  testID={`${props.testID}-option-${option.value}`}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected }}
                  onPress={() => {
                    close();
                    if (!isSelected) props.onChange(option.value);
                  }}
                  style={({ pressed }) => [styles.menuRow, rtl && styles.rowRtl, isSelected && styles.menuRowSelected, pressed && styles.pressed]}>
                  <Text style={[styles.menuLabel, props.direction]}>{option.label}</Text>
                  {isSelected && <Check size={18} color={colors.accent} strokeWidth={2.5} />}
                </Pressable>
              );
            })}
          </View>
        )}
      </Modal>
    </>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  textTrigger: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    minHeight: 24,
  },
  textLabel: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  disabled: {
    opacity: 0.5,
  },
  disabledText: {
    color: colors.textMuted,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  menu: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: spacing.xs,
    position: 'absolute',
    ...shadows.soft,
  },
  menuRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: MENU_ROW_HEIGHT,
    paddingHorizontal: spacing.md,
  },
  menuRowSelected: {
    backgroundColor: colors.accentSoft,
  },
  menuLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.78,
  },
});
