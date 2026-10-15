import { Check, ChevronDown } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDropdownMotion } from '@/components/useDropdownMotion';
import { MushafIcon } from './MushafIcon';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { fill, localNumber } from '@/localization/fill';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { openMushafFor } from '@/mushaf/continueWird';
import { loadReadingData, type Wird } from '@/mushaf/khatmas';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { setActiveReadingStopId, subscribeToReadingData } from '@/mushaf/readingStops';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { DROPDOWN_GAP, resolveDropdownPlacement } from '@/utils/dropdownPlacement';

/** The menu's width at most, and its rows' height (a 44-pt touch target), title and padding: its full height. */
const MENU_WIDTH = 300;
const menuHeight = (rows: number) => 2 * spacing.sm + 24 + rows * 44;
/** At least this far from the screen's sides. */
const EDGE = spacing.md;

type Box = { x: number; y: number; width: number; height: number };
/** A view's box in window coordinates (measureInWindow); null until it has a size. */
const measure = (node: View | null, done: (box: Box) => void) => {
  node?.measureInWindow?.((x, y, width, height) => {
    if (width > 0 && height > 0) done({ x, y, width, height });
  });
};

/** The ورد Home continues: the active one, else the most recently saved; null when there is none. */
export function continueTarget(wirds: readonly Wird[], activeStopId: string | null): { wird: Wird; active: boolean } | null {
  const active = wirds.find((w) => w.stop.id === activeStopId);
  if (active) return { wird: active, active: true };
  // Wirds are in saved order, most recent first.
  return wirds[0] ? { wird: wirds[0], active: false } : null;
}

/**
 * Home's first section, متابعة التلاوة / Continue Reciting: the ورد being read (its name, saved
 * page and progress) with one action, المصحف, opening the reader at that saved
 * page (أورادي وختماتي is its own bottom tab). With no ورد yet, a first-reading state
 * opens the Mushaf at page 1; no progress is shown or invented.
 *
 * With two or more Wirds, the name carries a chevron and opens a compact list
 * of them (name, saved page, a check on the one shown), anchored just under
 * the name (above it where there is no room below), aligned with the name's
 * side, floating over the card; its chevron points up while the list is
 * open and down while it is closed. Tapping the name again, or outside, closes
 * it. Choosing one makes it
 * the active ورد (setActiveReadingStopId: stored, synced, and followed by the
 * reader); it changes no ورد's page, cycle or Khatmas.
 */
export function ContinueReadingCard() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.continueReading;
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  const [target, setTarget] = useState<ReturnType<typeof continueTarget> | undefined>(undefined);
  const [wirds, setWirds] = useState<readonly Wird[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // The name's box when the menu opened, and the menu's overlay's own box, both measured the same way (window
  // coordinates): the menu is placed at their difference, in the overlay's own space. The overlay is a separate native
  // window (Modal) whose origin need not be the app's (Android's status bar, a dialog window), so nothing is assumed.
  const [anchor, setAnchor] = useState<Box | null>(null);
  const [overlay, setOverlay] = useState<Box | null>(null);
  const selectorRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const screen = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      void loadReadingData()
        .then((data) => {
          if (cancelled) return;
          setWirds(data.wirds);
          setTarget(continueTarget(data.wirds, data.activeStopId));
        })
        .catch(() => {
          if (cancelled) return;
          setWirds([]);
          setTarget(null);
        });
    };
    reload();
    const unsubscribeData = subscribeToReadingData(reload);
    const unsubscribeOwner = subscribeToLocalDataOwner(() => {
      setTarget(undefined);
      reload();
    });
    return () => {
      cancelled = true;
      unsubscribeData();
      unsubscribeOwner();
    };
  }, []);

  const wird = target?.wird ?? null;
  const openMushaf = () => void openMushafFor(wird ? wird.stop : null);
  const canSwitch = wird !== null && wirds.length > 1;
  // Measured at each opening, so the menu follows the card wherever Home has scrolled it. Not measurable: it stays closed
  // (never shown anywhere but at the name).
  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    measure(selectorRef.current, (box) => {
      setAnchor(box);
      setOverlay(null);
      setMenuOpen(true);
    });
  };
  // The overlay's box: as soon as it is mounted, and again whenever it is laid out.
  const measureOverlay = () => measure(overlayRef.current, setOverlay);
  useLayoutEffect(() => {
    if (menuOpen) measure(overlayRef.current, setOverlay);
  }, [menuOpen]);
  const menuWidth = Math.min(MENU_WIDTH, (overlay?.width ?? screen.width) - 2 * EDGE);
  // The name in the overlay's coordinates.
  const at = anchor && overlay ? { x: anchor.x - overlay.x, y: anchor.y - overlay.y, width: anchor.width, height: anchor.height } : null;
  const space = overlay ?? { x: 0, y: 0, width: screen.width, height: screen.height };
  const { placement, maxHeight } = resolveDropdownPlacement({
    anchorTop: at?.y ?? 0,
    anchorBottom: (at?.y ?? 0) + (at?.height ?? 0),
    menuHeight: menuHeight(wirds.length),
    maxHeight: Math.min(320, space.height * 0.45),
    windowHeight: space.height,
    // The safe areas are the screen's: only the part of them the overlay covers.
    safeTop: Math.max(0, insets.top - space.y),
    safeBottom: Math.max(0, insets.bottom - Math.max(0, screen.height - (space.y + space.height))),
    preferred: 'below',
  });
  // Aligned with the name's own side (its right edge in Arabic, its left in English), kept inside the overlay.
  const menuLeft = at ? Math.max(EDGE, Math.min(space.width - EDGE - menuWidth, rtl ? at.x + at.width - menuWidth : at.x)) : 0;
  // The chevron shows whether the list is open (up) or closed (down), wherever the list opens.
  const motion = useDropdownMotion(menuOpen, placement, { chevron: 'state' });
  // Shown at once; the stored choice (and the reload it triggers) follows.
  const choose = (next: Wird) => {
    setMenuOpen(false);
    setTarget({ wird: next, active: true });
    void setActiveReadingStopId(next.stop.id).catch(() => undefined);
  };

  return (
    <View testID="home-continue-reading" style={styles.card}>
      <Text accessibilityRole="header" style={[styles.title, direction]}>{copy.title}</Text>
      {wird ? (
        <View testID="home-continue-wird" style={styles.info}>
          <Text style={[styles.caption, direction]}>{target?.active ? copy.activeWird : copy.lastSaved}</Text>
          {canSwitch ? (
            <Pressable
              ref={selectorRef}
              testID="home-wird-selector"
              accessibilityRole="button"
              accessibilityLabel={`${target?.active ? copy.activeWird : copy.lastSaved}: ${wird.stop.name}`}
              accessibilityHint={copy.switchHint}
              accessibilityState={{ expanded: menuOpen }}
              hitSlop={8}
              onPress={toggleMenu}
              style={({ pressed }) => [styles.nameRow, rtl ? styles.nameRowRtl : styles.nameRowLtr, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={[styles.wirdName, styles.nameShrink, direction]}>{wird.stop.name}</Text>
              <Animated.View testID="home-wird-chevron" style={motion.chevronStyle}>
                <ChevronDown size={20} color={colors.accent} />
              </Animated.View>
            </Pressable>
          ) : (
            <Text numberOfLines={1} style={[styles.wirdName, direction]}>{wird.stop.name}</Text>
          )}
          <View style={[styles.metaRow, rtl && styles.rowRtl]}>
            <Text style={[styles.meta, { writingDirection: direction.writingDirection }]}>
              {fill(copy.pageOf, { page: localNumber(locale, wird.stop.page), total: localNumber(locale, MUSHAF_PAGE_COUNT) })}
            </Text>
            <Text style={styles.metaStrong}>{fill(messages.myReading.percent, { percent: localNumber(locale, wird.percent) })}</Text>
          </View>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={messages.myReading.positionLabel}
            accessibilityValue={{ min: 0, max: 100, now: wird.percent }}
            style={[styles.track, rtl && styles.rowRtl]}>
            <View style={[styles.fill, { width: `${wird.percent}%` }]} />
          </View>
        </View>
      ) : target === null ? (
        <View testID="home-continue-first" style={styles.info}>
          <Text style={[styles.wirdName, direction]}>{copy.firstTitle}</Text>
          <Text style={[styles.caption, direction]}>{copy.firstBody}</Text>
        </View>
      ) : null}
      <View style={[styles.actions, rtl && styles.rowRtl]}>
        <Pressable
          testID="home-open-mushaf"
          accessibilityRole="button"
          accessibilityLabel={copy.mushaf}
          onPress={openMushaf}
          style={({ pressed }) => [styles.primary, rtl && styles.rowRtl, pressed && styles.pressed]}>
          <MushafIcon size={20} color={colors.onAccentFill} />
          <Text style={styles.primaryText}>{copy.mushaf}</Text>
        </Pressable>
      </View>

      {canSwitch && (
        <Modal visible={motion.mounted} transparent statusBarTranslucent animationType="none" onRequestClose={() => setMenuOpen(false)}>
          <View ref={overlayRef} testID="home-wird-overlay" collapsable={false} pointerEvents="box-none" style={styles.backdrop} onLayout={measureOverlay}>
            {/* A tap anywhere outside the list (the name included) closes it; nothing behind it is dimmed. */}
            <Pressable testID="home-wird-backdrop" accessibilityLabel={messages.mushaf.wirdClose} style={styles.backdrop} onPress={() => setMenuOpen(false)} />
            {at && (
              <Animated.View
                testID="home-wird-menu"
                accessibilityViewIsModal
                style={[
                  styles.menu,
                  { left: menuLeft, maxHeight, width: menuWidth },
                  placement === 'below' ? { top: at.y + at.height + DROPDOWN_GAP } : { bottom: space.height - at.y + DROPDOWN_GAP },
                  motion.menuStyle,
                ]}>
                <Text accessibilityRole="header" style={[styles.menuTitle, direction]}>{copy.chooseWird}</Text>
                <ScrollView style={styles.menuList}>
                  {wirds.map((item) => {
                    const selected = item.stop.id === wird.stop.id;
                    const page = `${messages.mushaf.pageShort} ${localNumber(locale, item.stop.page)}`;
                    return (
                      <Pressable
                        key={item.stop.id}
                        testID={`home-wird-option-${item.stop.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`${item.stop.name}, ${page}`}
                        accessibilityState={{ selected }}
                        onPress={() => choose(item)}
                        style={({ pressed }) => [styles.option, rtl && styles.rowRtl, selected && styles.optionSelected, pressed && styles.pressed]}>
                        <View style={styles.check}>{selected && <Check size={16} color={colors.accent} />}</View>
                        <Text numberOfLines={1} style={[styles.optionName, direction]}>{item.stop.name}</Text>
                        <Text style={styles.optionPage}>{page}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            )}
          </View>
        </Modal>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  card: {
    backgroundColor: colors.sageSurface,
    borderColor: colors.sageBorder,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadows.soft,
  },
  title: { color: colors.accent, fontSize: typography.body, fontWeight: '800' },
  info: { gap: spacing.xs },
  caption: { color: colors.textSecondary, fontSize: typography.caption, lineHeight: 19 },
  wirdName: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  // Two or more Wirds: the name and its chevron, hugging the name at the language's side.
  nameRow: { alignItems: 'center', gap: spacing.xs, maxWidth: '100%' },
  nameRowLtr: { alignSelf: 'flex-start', flexDirection: 'row' },
  nameRowRtl: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  nameShrink: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  rowRtl: { flexDirection: 'row-reverse' },
  meta: { color: colors.textSecondary, fontSize: typography.caption },
  metaStrong: { color: colors.accent, fontSize: typography.caption, fontWeight: '800' },
  track: { backgroundColor: colors.accentSoft, borderRadius: radii.full, flexDirection: 'row', height: 6, marginTop: spacing.xs, overflow: 'hidden' },
  fill: { backgroundColor: colors.accentFill, borderRadius: radii.full, height: 6 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  primary: {
    alignItems: 'center', backgroundColor: colors.accentFill, borderRadius: radii.full, flex: 1, flexDirection: 'row',
    gap: spacing.sm, justifyContent: 'center', minHeight: 50, paddingHorizontal: spacing.md,
  },
  primaryText: { color: colors.onAccentFill, fontSize: typography.body, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  backdrop: { ...StyleSheet.absoluteFill },
  menu: {
    backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg, borderWidth: 1,
    paddingVertical: spacing.sm, position: 'absolute', ...shadows.soft,
  },
  menuTitle: { color: colors.textSecondary, fontSize: typography.caption, fontWeight: '700', paddingBottom: spacing.xs, paddingHorizontal: spacing.md },
  menuList: { flexGrow: 0 },
  option: {
    alignItems: 'center', borderRadius: radii.md, flexDirection: 'row', gap: spacing.sm, marginHorizontal: spacing.xs,
    minHeight: 44, paddingHorizontal: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.accentSoft },
  check: { alignItems: 'center', width: 18 },
  optionName: { color: colors.textPrimary, flex: 1, fontSize: typography.body, fontWeight: '700' },
  optionPage: { color: colors.textSecondary, fontSize: typography.caption },
});
