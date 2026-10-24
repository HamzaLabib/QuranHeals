import { X } from 'lucide-react-native';
import { useMemo, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';

/** Outside the sheet, a touch that moves less than this is a tap (which closes it); a swipe or drag never does. */
const TAP_SLOP = 10;

type Props = {
  /** The testID prefix of every part (`${id}-sheet`, `-backdrop`, `-close`, `-title`, `-subtitle`, `-body`). */
  id: string;
  visible: boolean;
  title: string;
  subtitle?: string;
  closeLabel: string;
  dark: boolean;
  /** The App Language's direction, for the header. */
  rtl: boolean;
  onClose: () => void;
  /** Between the header and the body (Surah Preview's surah choice). */
  header?: ReactNode;
  children: ReactNode;
};

/**
 * The bottom sheet of the reader's feature buttons (المعاني, عن السورة), in the reader's sheet design: up from the
 * bottom over part of the screen, the page still visible, dimmed, above it. It closes by its X button, a tap anywhere
 * outside it, or Android's Back (owner's decision, 2026-10-24); the modal takes Back, so it never leaves the Mushaf.
 * No swipe or drag ever closes it, on it or outside it. A touch inside never closes it, and its content scrolls as usual. While it is open nothing under it receives a touch (a modal window), so a tap outside only closes
 * it, never reaching the Mushaf or its controls; once closed it is not drawn at all. It changes no reading data.
 */
export function FeatureSheet({ id, visible, title, subtitle, closeLabel, dark, rtl, onClose, header, children }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const { height: windowHeight } = useWindowDimensions();

  // Outside the sheet: it takes every touch there (so none reaches the page), and only a tap closes the sheet.
  const outside = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderRelease: (_event, g) => {
      if (Math.abs(g.dx) < TAP_SLOP && Math.abs(g.dy) < TAP_SLOP) onClose();
    },
  }), [onClose]);
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;

  return (
    // Android's Back closes the sheet (and only the sheet: the modal takes it, so the reader stays open).
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.backdrop }]}>
        <View
          testID={`${id}-backdrop`}
          accessible
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onAccessibilityTap={onClose}
          style={styles.dismissArea}
          {...outside.panHandlers}
        />
        <View style={[styles.sheetFrame, { height: Math.min(560, windowHeight * 0.62) }]}>
          <SafeAreaView edges={['bottom', 'left', 'right']} testID={`${id}-sheet`} style={[styles.sheet, theme.sheet]}>
            <View>
              <View style={[styles.handle, { backgroundColor: theme.divider }]} />
              <View style={[styles.headerRow, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
                <View style={styles.titles}>
                  <Text testID={`${id}-title`} accessibilityRole="header" style={[styles.title, { color: theme.text }, align]}>{title}</Text>
                  {subtitle ? <Text testID={`${id}-subtitle`} style={[styles.subtitle, { color: theme.muted }, align]}>{subtitle}</Text> : null}
                </View>
                <Pressable testID={`${id}-close`} accessibilityRole="button" accessibilityLabel={closeLabel} onPress={onClose} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                  <X size={20} color={theme.icon} />
                </Pressable>
              </View>
              {header}
            </View>
            <View testID={`${id}-body`} style={styles.body}>
              {children}
            </View>
          </SafeAreaView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheetFrame: {
    alignSelf: 'center',
    maxWidth: 560,
    width: '100%',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flex: 1,
    paddingBottom: 8,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center',
    borderRadius: 2,
    height: 4,
    marginBottom: 2,
    marginTop: 8,
    width: 36,
  },
  headerRow: {
    alignItems: 'center',
    minHeight: 48,
  },
  titles: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  body: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
