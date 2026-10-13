import * as Font from 'expo-font';
import { useFonts } from 'expo-font';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Maximize, Minimize } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MushafControlPanel, MUSHAF_PANEL_HEIGHT, MUSHAF_PANEL_MARGIN, type MushafPopup } from '@/components/MushafControlPanel';
import { MushafPageView } from '@/components/MushafPageView';
import { MushafSearchSheet } from '@/components/MushafSearchSheet';
import { MushafSvgText } from '@/components/MushafSvgText';
import { MushafWirdSelector, WIRD_PILL_HEIGHT } from '@/components/MushafWirdSelector';
import { MushafZoomView, type MushafZoomHandle } from '@/components/MushafZoomView';
import { QpcV1PageText } from '@/components/QpcV1PageText';
import { ReflectionSheet } from '@/components/ReflectionSheet';
import { MUSHAF_PANEL_COLORS, MUSHAF_PAPER } from '@/constants/mushafTheme';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { MUSHAF_BACKGROUNDS, MUSHAF_BORDER_STYLES, MUSHAF_INKS, MUSHAF_PAGE_FURNITURE, resolveMushafAppearance } from '@/mushaf/appearance';
import { QCF_V1_NORMAL_BOX_MARGIN_EM } from '@/mushaf/ayahMarkers';
import { HAFS_KFQC_PAGE_061 } from '@/mushaf/generated/hafsKfqcPage061';
import { KHATM_DUA } from '@/mushaf/khatmDua';
import { MUSHAF_HEADER_FONT_FAMILY, MUSHAF_HEADER_FONTS } from '@/mushaf/headerFonts';
import { MUSHAF_PAGE_COUNT, parseMushafPage, tintAyahMarkers, tintSvgInk, toArabicIndicDigits } from '@/mushaf/mushafPage';
import { offlineMushaf, OfflineMushafError, type DownloadProgress, type OfflineStatus } from '@/mushaf/offline';
import { readRelayPageForDev } from '@/mushaf/offline/devRelayPage';
import { qcfFontUrl } from '@/mushaf/offline/fonts';
import { hizbLabelsForPage } from '@/mushaf/hizbQuarters';
import { BORDER_TILES_DOWN, computePageLayout } from '@/mushaf/pageGeometry';
import { QPC_V1_FONTS } from '@/mushaf/qpcV1Fonts';
import { checkAgainstTanzil, loadQpcV1PageLayout, type QpcV1PageLayout } from '@/mushaf/qpcV1Layout';
import {
  activeReadingStop,
  loadActiveReadingStopId,
  loadReadingStops,
  ReadingStopError,
  saveReadingStop,
  setActiveReadingStopId,
  type ReadingStop,
} from '@/mushaf/readingStops';
import { BASMALA_FONT_PAGE, surahOpeningSlots } from '@/mushaf/surahOpenings';
import { getVerseByKey } from '@/services/quran';
import { useThemedStyles, useThemeName } from '@/theme/useTheme';
import { devLog } from '@/utils/devLog';
import { goBackOrHome } from '@/utils/goBackOrHome';

/**
 * The Mushaf reader (/mushaf): a plain Back arrow in a slim row under the
 * status bar, then the printed QPC V1 page as large as the screen allows,
 * with one floating, icon-only action bar at the bottom (previous page,
 * reflection, search, save a reading stop, next page). Swiping the page
 * turns it too, in step with the arrows; pinching zooms it (MushafZoomView).
 * The active reading stop (ورد) sits between the page and the bar
 * (MushafWirdSelector); search opens a sheet for a page number or a Surah
 * (MushafSearchSheet). The sources are credited on Home and in /credits.
 *
 * Navigating (arrows, swipes, search) only shows a page: no stop is ever
 * saved or moved except by the bookmark's explicit save.
 *
 * Full-screen reading (the top-right Expand / Collapse icon): only the page
 * and the Collapse icon stay; the Back arrow, the bar and the ورد pill hide,
 * and the whole page is refitted into the space they used (fitMushafPage)
 * and centred in it: never zoomed to fill, never cropped. The
 * page, the selected ayah and the active ورد are kept; zoom, swipes and ayah
 * taps work as in Normal Mode. Leaving it: the Collapse icon (at any zoom), a
 * swipe down at 1×, or Android's Back. Not remembered across restarts: the
 * reader always opens in Normal Mode.
 *
 * The whole screen is the page's own paper colour (the appearance preset's
 * `paper`), so the page has no visible edge against it.
 *
 * Taller (Mobile-Optimized; approved for full-screen reading on all 604
 * pages, in every build): in full screen, the same page with a taller frame —
 * more of the same border tiles down its sides — and the lines spaced evenly
 * further apart, filling the height the device has to spare, up to
 * TALLER_MAX_LINE_SPACING (none to spare: the Traditional page). Normal Mode
 * is always Traditional. It is automatic: there is no layout choice or
 * setting.
 *
 * Pages: every page comes from the offline Mushaf when it is installed (its
 * layout and page font); page 61 also works online (our backend's layout and
 * the bundled font), with the Quran SVG page as its fallback. A page is drawn
 * only after its layout passes the check against the verified Tanzil text.
 * A page that isn't downloaded shows the offline download instead.
 *
 * Not linked from the rest of the app yet (open it as /mushaf, or
 * /mushaf?page=N). Khatma and statistics are out of scope.
 */

const DEFAULT_PAGE = 61;
/** Page height ÷ width (headers, frame and page number), from the measured geometry. */
const PAGE_ASPECT = computePageLayout(1000).page.height / 1000;
/**
 * Just enough to keep the frame and the running heads off the screen's edge
 * (curved edges included). On phones the width is what limits the page's size.
 */
const SIDE_MARGIN = 3;
/** The slim row for the Back arrow, under the status bar (its touch target reaches 44 pt upward). */
export const BACK_BAR_HEIGHT = 36;
/** Between the bottom of the page and the floating bar. */
const PAGE_PANEL_GAP = 4;
/** Kept free under the page for the ورد pill: on phones the page is narrower than it could be tall, so this costs nothing there. */
export const WIRD_ROW_HEIGHT = 32;
/** Two taps this close together are a double-tap, which resets the zoom rather than selecting. */
const DOUBLE_TAP_MS = 350;

/** Full screen: between the bottom of the page and the bottom safe area (home indicator, navigation bar). */
const FULL_SCREEN_BOTTOM_GAP = 4;
/**
 * Taller: the most the line spacing may grow over the printed page's (1.25 = 25% more), whatever the
 * screen's height, so very tall phones (and, later, tablets) don't open large gaps between the lines.
 * Approved reference: page 61 on a 393-pt iPhone, about 15% more. Height beyond this is left as paper
 * around the centred page.
 */
export const TALLER_MAX_LINE_SPACING = 1.25;
const PRINTED_LINE_PITCH = computePageLayout(1000).linePitch;
/** The tallest Taller frame, in tiles (the printed page has 29): the last one within TALLER_MAX_LINE_SPACING. */
export const TALLER_MAX_TILES_DOWN = (() => {
  let tiles = BORDER_TILES_DOWN;
  while (computePageLayout(1000, tiles + 1).linePitch / PRINTED_LINE_PITCH <= TALLER_MAX_LINE_SPACING) tiles += 1;
  return tiles;
})();
/** A swipe down starting this close under the top safe area is left to the system (Notification Centre, status bar). */
const SWIPE_DOWN_TOP_GUARD = 24;
/** Development builds only (?source=online, the relay page reader). */
const isDevBuild = () => typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * The largest page that fits the reading area, in its own proportions (never
 * cropped or stretched). Normal Mode leaves at least the ورد row free under
 * it, and the zoom viewport is the whole area above the bar. Full screen
 * has no bar or ورد row: the page and the viewport reach down to the
 * bottom safe area. `taller` (full-screen reading): at that width, the
 * tallest whole-tile frame that fits, up to TALLER_MAX_TILES_DOWN; computed
 * from the actual space, so any phone (or, later, tablet) gets its own.
 */
export function fitMushafPage(area: { width: number; height: number }, bottomInset: number, fullScreen = false, taller = false) {
  const viewportHeight = Math.max(0, area.height - (fullScreen ? FULL_SCREEN_BOTTOM_GAP + bottomInset : PAGE_PANEL_GAP + MUSHAF_PANEL_HEIGHT + MUSHAF_PANEL_MARGIN + bottomInset));
  const available = viewportHeight - (fullScreen ? 0 : WIRD_ROW_HEIGHT);
  const width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, available / PAGE_ASPECT)));
  // Taller: at that same width, the tallest whole-tile frame that still fits.
  let tilesDown = BORDER_TILES_DOWN;
  while (taller && width > 0 && tilesDown < TALLER_MAX_TILES_DOWN && pageHeightFor(width, tilesDown + 1) <= available) tilesDown += 1;
  return {
    viewport: { width: Math.max(0, area.width), height: viewportHeight },
    page: { width, height: width > 0 ? pageHeightFor(width, tilesDown) : 0 },
    tilesDown,
  };
}

/** The page's height at `width` with a `tilesDown`-tile frame (proportional to the width). */
function pageHeightFor(width: number, tilesDown: number) {
  return (computePageLayout(1000, tilesDown).page.height / 1000) * width;
}

type PageState =
  | { status: 'loading' }
  | { status: 'qpc'; layout: QpcV1PageLayout; source: 'offline' | 'api'; basmalaFont: string | null }
  | { status: 'svg' }
  | { status: 'missing' }
  | { status: 'unavailable' };

// Page 61's Quran SVG fallback: parsed and validated once; bundled, never fetched.
let svgCache: { page: ReturnType<typeof parseMushafPage>; svg: string } | null | undefined;
function svgPage61() {
  if (svgCache === undefined) {
    try {
      svgCache = { page: parseMushafPage(HAFS_KFQC_PAGE_061), svg: tintAyahMarkers(HAFS_KFQC_PAGE_061.svg, MUSHAF_PAPER.marker) };
    } catch {
      svgCache = null;
    }
  }
  return svgCache;
}
/** The SVG page with its ink recoloured for a dark page (cached per colour). */
const inkedSvgCache = new Map<string, string>();
function inkedSvg(svg: string, ink: string) {
  let tinted = inkedSvgCache.get(ink);
  if (!tinted) {
    tinted = tintSvgInk(svg, ink);
    inkedSvgCache.set(ink, tinted);
  }
  return tinted;
}

/** Western or Arabic-Indic digits → a page number, or null. */
export function parsePageNumber(input: string): number | null {
  const western = input.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,3}$/.test(western)) return null;
  const page = Number(western);
  return page >= 1 && page <= MUSHAF_PAGE_COUNT ? page : null;
}

/** Registers a page's QCF V1 font: the bundled one for page 61, a verified offline file, or Quran Foundation's CDN. */
async function ensurePageFont(page: number, family: string): Promise<boolean> {
  if (Font.isLoaded(family)) return true;
  const stored = await offlineMushaf.pageFont(page).catch(() => null);
  if (stored === 'bundled') return false; // registered by useFonts below
  try {
    await Font.loadAsync({ [family]: stored ? stored.uri : qcfFontUrl(page) });
    return true;
  } catch {
    return false;
  }
}

export default function MushafScreen() {
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { locale, messages } = useAppLocale();
  const copy = messages.mushaf;
  const rtl = isRtlLocale(locale);
  const formatNumber = (n: number) => (rtl ? toArabicIndicDigits(n) : String(n));
  const params = useLocalSearchParams();
  const theme = useThemeName();
  // Paper, medallions, ink and border follow the app's Appearance setting
  // (mushaf/appearance.ts); the URL can preview a preset (?scheme=dark).
  const appearance = resolveMushafAppearance(params, theme);
  const dark = appearance.background === 'midnight';
  const furniture = MUSHAF_PAGE_FURNITURE[appearance.background];
  const ink = MUSHAF_INKS[appearance.ink].color;
  const highlight = { color: furniture.highlight, opacity: furniture.highlightOpacity };

  const requestedPage = parsePageNumber(String(Array.isArray(params.page) ? params.page[0] : params.page ?? ''));
  const initialPage = requestedPage ?? DEFAULT_PAGE;
  const [page, setPage] = useState(initialPage);
  // What was loaded, for which page: any other page is still loading.
  const [loaded, setLoaded] = useState<{ page: number; reload: number; state: PageState } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [fontsLoaded, fontError] = useFonts(QPC_V1_FONTS);
  // Separate, so the heads' font can never hold back or disable the Quran text.
  const [headerFontLoaded] = useFonts(MUSHAF_HEADER_FONTS);
  const [selectedVerseKey, setSelectedVerseKey] = useState<string | null>(null);
  const [isReflectionVisible, setIsReflectionVisible] = useState(false);
  const [popup, setPopup] = useState<MushafPopup>(null);
  // Measured, not the window size: right on tablets, split screen and web.
  const [area, setArea] = useState({ width: 0, height: 0 });
  // The selection before the latest tap, so a double-tap (zoom reset) can put it back.
  const lastTap = useRef<{ before: string | null; at: number; ignoreUntil: number }>({ before: null, at: 0, ignoreUntil: 0 });
  const [zoomed, setZoomed] = useState(false);
  // Development builds only: read any page straight from the relay (?source=online), to check it without installing.
  const onlineInDev = isDevBuild() && params.source === 'online';
  const zoomView = useRef<MushafZoomHandle>(null);
  // Full-screen reading: off whenever the reader opens.
  const [fullScreen, setFullScreen] = useState(false);
  // Reading stops (ورد): the list and the active one, as stored on the device.
  const [stops, setStops] = useState<ReadingStop[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [isWirdOpen, setIsWirdOpen] = useState(false);
  const activeStop = activeReadingStop(stops, activeStopId);
  // Set once the reader moves: the active stop's page then no longer replaces the opening page.
  const hasNavigated = useRef(false);

  // On opening: the stops and the active one. Without ?page=, the active stop's saved page opens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [list, id] = await Promise.all([loadReadingStops(), loadActiveReadingStopId()]);
      if (cancelled) return;
      setStops(list);
      setActiveStopId(id);
      const active = activeReadingStop(list, id);
      if (active && requestedPage === null && !hasNavigated.current) setPage(active.page);
    })();
    return () => {
      cancelled = true;
    };
    // Only on opening: later changes come from this screen's own actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page's layout and font, checked against the verified Tanzil text before it may be drawn.
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    const setContent = (state: PageState) => setLoaded({ page, reload: reloadKey, state });
    void (async () => {
      try {
        const offline = await offlineMushaf.readPage(page).catch(() => null);
        // Online: page 61 from the page API; in development builds with ?source=online, any page straight from the relay.
        const devRelay = !offline && onlineInDev && page !== DEFAULT_PAGE
          ? await readRelayPageForDev(page).catch(() => null)
          : null;
        const layout = offline ?? devRelay ?? (page === DEFAULT_PAGE ? await loadQpcV1PageLayout(page).catch(() => null) : null);
        if (!layout) {
          if (!cancelled) setContent(page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'missing' });
          return;
        }
        const tanzil: Record<string, string> = {};
        for (const verseKey of layout.verseKeys) tanzil[verseKey] = (await getVerseByKey(verseKey)).arabicText;
        const basmala = (await getVerseByKey('1:1')).arabicText;
        const check = checkAgainstTanzil(layout, layout.verseKeys, tanzil, basmala);
        const fontReady = page === DEFAULT_PAGE ? true : await ensurePageFont(page, layout.fontFamily);
        devLog('mushaf', 'page', { page, source: offline ? 'offline' : 'api', ms: Date.now() - startedAt, ok: check.ok, fontReady, problems: check.problems });
        if (cancelled) return;
        // A Basmala line is drawn in page 1's font; without it the line stays empty (never another font).
        const needsBasmala = surahOpeningSlots(layout).some((slot) => slot.kind === 'basmala');
        const basmalaFont = needsBasmala && (await ensurePageFont(BASMALA_FONT_PAGE, 'QCF_P001')) ? 'QCF_P001' : null;
        if (cancelled) return;
        if (check.ok && fontReady) setContent({ status: 'qpc', layout, source: offline ? 'offline' : 'api', basmalaFont });
        else setContent(page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'unavailable' });
      } catch {
        if (!cancelled) setContent(page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, reloadKey, onlineInDev]);

  /** Shows a page — and only that: nothing is saved (search, stops and links all use it). */
  const goTo = useCallback((next: number) => {
    if (next < 1 || next > MUSHAF_PAGE_COUNT) return;
    hasNavigated.current = true;
    setPage(next);
    setSelectedVerseKey(null);
    setPopup(null);
    setZoomed(false); // a new page opens at 1×
  }, []);
  /** One page back (-1) or forward (+1); the arrows and swipes share it. */
  const turn = useCallback((delta: -1 | 1) => {
    hasNavigated.current = true;
    setPage((current) => Math.min(MUSHAF_PAGE_COUNT, Math.max(1, current + delta)));
    setSelectedVerseKey(null);
    setPopup(null);
    setZoomed(false);
  }, []);
  // Left arrow = next page, right arrow = previous; a finger swipe left to right = next, right to left = previous
  // (the same in every language; swipes at 1× only — mushaf/pageZoom.ts swipeTurn).

  /** A tap on an ayah selects it; a tap on the selected ayah clears the selection. */
  const selectVerse = (verseKey: string) => {
    const now = Date.now();
    // A tap of a double-tap that arrives after the double-tap itself (the web's click comes late).
    if (now < lastTap.current.ignoreUntil) return;
    if (now - lastTap.current.at > DOUBLE_TAP_MS) lastTap.current.before = selectedVerseKey;
    lastTap.current.at = now;
    setSelectedVerseKey(verseKey === selectedVerseKey ? null : verseKey);
  };
  /** A double-tap resets the zoom; its two taps leave the selection as it was. */
  const onDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current.at <= DOUBLE_TAP_MS * 2) setSelectedVerseKey(lastTap.current.before);
    lastTap.current.ignoreUntil = now + DOUBLE_TAP_MS;
  };

  const onGoToPage = (input: string) => {
    const target = parsePageNumber(input);
    if (target === null) return copy.pageOutOfRange;
    goTo(target);
    return null;
  };
  const onSaveStop = async (name: string) => {
    try {
      // The whole page — never the selected ayah. The stop just saved is the one being read.
      const next = await saveReadingStop({ name, page });
      setStops(next);
      setActiveStopId(next[0].id);
      await setActiveReadingStopId(next[0].id).catch(() => undefined);
      return { tone: 'info' as const, text: copy.stopSaved };
    } catch (error) {
      const kind = error instanceof ReadingStopError ? error.kind : null;
      return { tone: 'error' as const, text: kind === 'invalid_name' ? copy.stopNameInvalid : kind === 'too_many' ? copy.tooManyStops : copy.stopSaveFailed };
    }
  };

  /**
   * Normal ⇄ full-screen reading. The page is refitted, so the zoom first
   * returns to 1×; the page, the selection and the active ورد stay as they are.
   */
  const switchReadingMode = useCallback((next: boolean) => {
    zoomView.current?.reset();
    setPopup(null);
    setIsWirdOpen(false);
    setFullScreen(next);
  }, []);
  // Android Back in full screen returns to Normal Mode; the next Back navigates as usual.
  useEffect(() => {
    if (!fullScreen) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      switchReadingMode(false);
      return true;
    });
    return () => subscription.remove();
  }, [fullScreen, switchReadingMode]);

  /** Opens the ورد list, re-read from storage so renamed or removed stops show as they are now. */
  const openWird = async () => {
    setPopup(null);
    const [list, id] = await Promise.all([loadReadingStops(), loadActiveReadingStopId()]);
    setStops(list);
    setActiveStopId(id);
    setIsWirdOpen(true);
  };
  /** Switching ورد: that stop becomes the active one and its saved page opens. No stop's page changes. */
  const selectStop = (stop: ReadingStop) => {
    setIsWirdOpen(false);
    setActiveStopId(stop.id);
    void setActiveReadingStopId(stop.id).catch(() => undefined);
    goTo(stop.page);
  };
  /** The existing way to create a stop: the bookmark's name field. */
  const addStop = () => {
    setIsWirdOpen(false);
    setPopup('save');
  };

  const content: PageState = loaded && loaded.page === page && loaded.reload === reloadKey ? loaded.state : { status: 'loading' };
  const svg = svgPage61();
  const showQpc = content.status === 'qpc' && (content.layout.page !== DEFAULT_PAGE || (fontsLoaded && !fontError));
  // Automatic, on every page: Taller in full screen wherever the whole page fits (fitMushafPage falls back to
  // Traditional otherwise); Normal Mode is always Traditional. It needs the QPC lines (the Quran SVG page keeps
  // its own fixed line positions). There is no layout choice anywhere.
  const taller = fullScreen && showQpc;
  // The largest page that fits between the Back row and the floating bar, never cropped.
  const fit = fitMushafPage(area, insets.bottom, fullScreen, taller);
  const { width: pageWidth, height: pageHeight } = fit.page;
  const showSvg = page === DEFAULT_PAGE && svg && (content.status === 'svg' || (content.status === 'qpc' && !showQpc));
  const firstAyah = showQpc && content.status === 'qpc'
    ? (() => { const [surah, ayah] = content.layout.verseKeys[0].split(':').map(Number); return { surah, ayah }; })()
    : svg?.page.ayahs[0];
  const pageLabel = `${copy.pageLabel} ${page}`;

  const drawn = pageWidth > 0 && (showQpc || showSvg) && firstAyah;
  const iconColor = (dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light).icon;
  return (
    <GestureHandlerRootView style={[styles.reader, { backgroundColor: MUSHAF_BACKGROUNDS[appearance.background].paper, paddingTop: insets.top }]}>
      {/*
        Plain icons, no circle, background, border or label, fixed left and right in every language
        (like the bar's order): Back on the left (Normal Mode only), Expand / Collapse on the right (always).
      */}
      <View testID="mushaf-back-bar" style={styles.backBar}>
        {fullScreen ? <View /> : (
          <Pressable
            testID="mushaf-back"
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={goBackOrHome}
            hitSlop={{ top: 44 - BACK_BAR_HEIGHT, bottom: 0, left: 0, right: 0 }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <ArrowLeft size={24} color={iconColor} />
          </Pressable>
        )}
        <Pressable
          testID="mushaf-fullscreen-toggle"
          accessibilityRole="button"
          accessibilityLabel={fullScreen ? copy.exitFullScreen : copy.enterFullScreen}
          accessibilityState={{ expanded: fullScreen }}
          onPress={() => switchReadingMode(!fullScreen)}
          hitSlop={{ top: 44 - BACK_BAR_HEIGHT, bottom: 0, left: 0, right: 0 }}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          {fullScreen ? <Minimize size={22} color={iconColor} /> : <Maximize size={22} color={iconColor} />}
        </Pressable>
      </View>

      <View
        testID="mushaf-page-area"
        style={styles.pageArea}
        onLayout={(event) => setArea({ width: Math.floor(event.nativeEvent.layout.width), height: Math.floor(event.nativeEvent.layout.height) })}>
        {pageWidth > 0 && (
          <MushafZoomView ref={zoomView} key={page} viewport={fit.viewport} page={fit.page} centered={fullScreen} zoomable={Boolean(drawn)} onSwipe={turn}
            onSwipeDown={fullScreen && !isReflectionVisible ? () => switchReadingMode(false) : undefined}
            swipeDownFromY={insets.top + SWIPE_DOWN_TOP_GUARD}
            onDoubleTap={onDoubleTap}
            onZoomChange={setZoomed}>
            {drawn ? (
              <MushafPageView
                pageNumber={page}
                firstAyah={firstAyah}
                width={pageWidth}
                tilesDown={fit.tilesDown === BORDER_TILES_DOWN ? undefined : fit.tilesDown}
                hizbLabels={fullScreen ? undefined : hizbLabelsForPage(page)}
                openingOrnament={showQpc && page <= 2}
                headerFontFamily={headerFontLoaded ? MUSHAF_HEADER_FONT_FAMILY : undefined}
                paperColor={MUSHAF_BACKGROUNDS[appearance.background].paper}
                headerColor={furniture.header}
                borderInks={MUSHAF_BORDER_STYLES[appearance.border ?? 'original'].inks}
                renderText={(textArea, { printedLinePitch }) => (showQpc && content.status === 'qpc' ? (
                  <QpcV1PageText
                    key={`qpc-${page}-${textArea.width}`}
                    layout={content.layout}
                    width={textArea.width}
                    height={textArea.height}
                    selectedVerseKey={selectedVerseKey}
                    onSelectVerse={selectVerse}
                    accessibilityLabel={pageLabel}
                    accessibilityHint={copy.tapHint}
                    markerStyle={appearance.markers}
                    printedPitch={printedLinePitch}
                    boxMarginEm={fullScreen ? 0 : QCF_V1_NORMAL_BOX_MARGIN_EM}
                    basmalaFontFamily={content.basmalaFont}
                    headingFontFamily={headerFontLoaded ? MUSHAF_HEADER_FONT_FAMILY : undefined}
                    headingColor={furniture.header}
                    ink={ink}
                    highlight={highlight}
                  />
                ) : (
                  <MushafSvgText
                    page={svg!.page}
                    svg={ink === MUSHAF_INKS.original.color ? svg!.svg : inkedSvg(svg!.svg, ink)}
                    highlight={highlight}
                    area={textArea}
                    selectedVerseKey={selectedVerseKey}
                    onSelectVerse={selectVerse}
                    accessibilityLabel={pageLabel}
                    accessibilityHint={copy.tapHint}
                  />
                ))}
              />
            ) : content.status === 'missing' || content.status === 'unavailable' ? (
              <View testID="mushaf-page-missing" style={[styles.missingPage, { width: pageWidth, height: pageHeight, backgroundColor: MUSHAF_BACKGROUNDS[appearance.background].paper }]}>
                <Text style={[styles.missingNumber, { color: furniture.header }]}>{String(page)}</Text>
                <Text style={[styles.missingText, { color: furniture.header }]}>
                  {content.status === 'missing' ? copy.pageNotDownloaded : copy.pageUnavailable}
                </Text>
                <OfflineMushafPanel onChange={() => setReloadKey((key) => key + 1)} />
              </View>
            ) : (
              <View style={{ height: pageHeight }} accessibilityLabel={copy.qpcLoading} />
            )}
          </MushafZoomView>
        )}
        {pageWidth > 0 && !fullScreen && (
          <View
            testID="mushaf-wird-row"
            pointerEvents={zoomed ? 'none' : 'box-none'}
            style={[styles.wirdRow, { top: pageHeight, height: fit.viewport.height - pageHeight, opacity: zoomed ? 0 : 1 }]}>
            <MushafWirdSelector
              labels={{
                choose: copy.wirdChoose,
                selectorLabel: copy.wirdSelectorLabel,
                selectorHint: copy.wirdSelectorHint,
                add: copy.wirdAdd,
                addNew: copy.wirdNew,
                close: copy.wirdClose,
                page: copy.pageShort,
              }}
              dark={dark}
              rtl={rtl}
              formatNumber={formatNumber}
              stops={stops}
              active={activeStop}
              open={isWirdOpen}
              onOpen={() => void openWird()}
              onClose={() => setIsWirdOpen(false)}
              onSelect={selectStop}
              onAdd={addStop}
              anchorBottom={insets.bottom + MUSHAF_PANEL_MARGIN + MUSHAF_PANEL_HEIGHT + PAGE_PANEL_GAP + (fit.viewport.height - pageHeight + WIRD_PILL_HEIGHT) / 2}
            />
            {/* After the last page: the optional دعاء ختم القرآن (its own screen, not a page 605), once a verified text is approved. */}
            {page === MUSHAF_PAGE_COUNT && KHATM_DUA && (
              <Pressable
                testID="mushaf-khatm-dua"
                accessibilityRole="button"
                accessibilityLabel={messages.khatmDua.open}
                onPress={() => router.push('/khatm-dua')}
                hitSlop={8}
                style={({ pressed }) => [styles.duaLink, rtl ? { left: spacing.md } : { right: spacing.md }, pressed && styles.pressed]}>
                <Text style={[styles.duaLinkText, { color: iconColor }]}>{messages.khatmDua.open}</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {!fullScreen && (
      <MushafControlPanel
        dark={dark}
        bottomInset={insets.bottom}
        labels={{
          previousPage: copy.previousPage,
          nextPage: copy.nextPage,
          reflect: messages.reflection.writeAction,
          searchPage: copy.searchPage,
          saveStop: copy.saveStopAction,
          stopName: copy.stopNameLabel,
          confirmStop: copy.confirmStop,
        }}
        canGoPrevious={page > 1}
        canGoNext={page < MUSHAF_PAGE_COUNT}
        onPrevious={() => turn(-1)}
        onNext={() => turn(1)}
        reflectionEnabled={selectedVerseKey !== null}
        onReflect={() => setIsReflectionVisible(true)}
        popup={popup}
        onPopup={setPopup}
        defaultStopName={activeStop?.name}
        onSaveStop={onSaveStop}
      />
      )}

      <MushafSearchSheet
        visible={popup === 'search'}
        labels={{
          title: copy.searchTitle,
          close: copy.wirdClose,
          byPage: copy.searchByPage,
          bySurah: copy.searchBySurah,
          pageNumber: copy.pageNumberPlaceholder,
          go: copy.goAction,
          goToPage: copy.goToPage,
          surahSearch: copy.surahSearchPlaceholder,
          noResults: copy.surahNoResults,
          page: copy.pageShort,
        }}
        dark={dark}
        rtl={rtl}
        formatNumber={formatNumber}
        onClose={() => setPopup(null)}
        onGoToPage={onGoToPage}
        onSelectSurah={(surah) => goTo(surah.startPage)}
      />

      <ReflectionSheet
        visible={isReflectionVisible}
        verseKey={selectedVerseKey}
        onClose={() => setIsReflectionVisible(false)}
      />
    </GestureHandlerRootView>
  );
}

/**
 * "Download Mushaf for offline reading": all 604 pages' layout (not the page
 * fonts yet), with progress, cancel (a later download continues where it
 * stopped), update check and removal. See mushaf/offline/offlineMushaf.ts.
 */
function OfflineMushafPanel({ onChange }: { onChange?: () => void } = {}) {
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.mushaf;
  const direction = getDirectionStyle(locale);
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(() => offlineMushaf.status().then(setStatus, () => setStatus(null)), []);
  useEffect(() => {
    void refresh();
    return () => controller.current?.abort();
  }, [refresh]);

  const explain = (error: unknown) => {
    const kind = error instanceof OfflineMushafError ? error.kind : null;
    const text = kind === 'cancelled' ? copy.offlineCancelled
      : kind === 'offline' ? copy.offlineErrorOffline
      : kind === 'unavailable' ? copy.offlineErrorUnavailable
      : kind === 'insufficient_storage' ? copy.offlineErrorStorage
      : kind === 'integrity' ? copy.offlineErrorIntegrity
      : copy.offlineErrorGeneric;
    setNotice({ tone: kind === 'cancelled' ? 'info' : 'error', text });
  };

  const download = async () => {
    if (controller.current) return;
    controller.current = new AbortController();
    setNotice(null);
    try {
      const result = await offlineMushaf.download({ signal: controller.current.signal, onProgress: setProgress });
      const after = await offlineMushaf.status().catch(() => null);
      setNotice({ tone: 'info', text: after?.complete ? copy.offlineComplete : result.status === 'up-to-date' ? copy.offlineUpToDate : status?.installed ? copy.offlineUpdated : copy.offlineReady });
    } catch (error) {
      explain(error);
    } finally {
      controller.current = null;
      setProgress(null);
      void refresh();
      onChange?.();
    }
  };

  const remove = async () => {
    try {
      await offlineMushaf.remove();
      setNotice(null);
    } catch (error) {
      explain(error);
    }
    void refresh();
  };

  // Two steps: the layout (by bytes), then the page fonts (by count).
  const inFonts = progress?.phase === 'fonts';
  const percent = !progress ? 0
    : inFonts ? (progress.fontsReady ?? 0) / (progress.fontsTotal || 604)
    : progress.bytesTotal > 0 ? progress.bytesReady / progress.bytesTotal : 0;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const busy = progress !== null && progress.phase !== 'done';
  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
    } catch {
      return iso.slice(0, 10);
    }
  };
  const fontsIncomplete = status?.installed && status.fonts && status.fonts.ready < status.fonts.total;
  const action = fontsIncomplete ? copy.offlineResume
    : status?.installed ? copy.offlineCheckUpdate
    : status && status.stagedChunks > 0 ? copy.offlineResume
    : copy.offlineDownload;

  return (
    <View testID="offline-mushaf" style={styles.panel}>
      <Text style={[styles.label, direction]}>{copy.offlineTitle}</Text>
      {status?.installed ? (
        <>
          <Text style={[styles.muted, direction]}>{`${status.complete === false ? copy.offlineReady : status.fonts ? copy.offlineComplete : copy.offlineReady} · ${copy.offlineUpdatedFrom}: ${formatDate(status.syncedAt)}`}</Text>
          {status.fonts && (
            <Text style={[styles.muted, direction]}>{`${copy.offlineFontsCount}: ${number(status.fonts.ready)} / ${number(status.fonts.total)}`}</Text>
          )}
        </>
      ) : (
        <Text style={[styles.muted, direction]}>{copy.offlineIntro}</Text>
      )}
      {busy ? (
        <>
          <Text accessibilityLiveRegion="polite" style={[styles.status, direction]}>
            {inFonts
              ? `${copy.offlineFonts} ${number(progress.fontsReady ?? 0)} / ${number(progress.fontsTotal ?? 604)}`
              : `${progress.phase === 'downloading' || progress.phase === 'checking' ? copy.offlineDownloading : copy.offlineVerifying} ${new Intl.NumberFormat(locale, { style: 'percent' }).format(percent)}`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copy.offlineCancel}
            onPress={() => controller.current?.abort()}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{copy.offlineCancel}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={action}
            disabled={status === null}
            onPress={() => void download()}
            style={({ pressed }) => [styles.secondaryButton, status === null && styles.disabled, pressed && styles.pressed]}>
            <Text style={styles.secondaryButtonText}>{action}</Text>
          </Pressable>
          {status?.installed && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copy.offlineRemove}
              onPress={() => void remove()}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>{copy.offlineRemove}</Text>
            </Pressable>
          )}
        </>
      )}
      {notice && (
        <Text accessibilityLiveRegion="polite" style={[styles.status, direction, notice.tone === 'error' && styles.statusError]}>{notice.text}</Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  // Full-screen reader: the page starts right under the status bar.
  reader: {
    backgroundColor: colors.background,
    flex: 1,
  },
  backBar: {
    alignItems: 'center',
    // Back on the left, Expand / Collapse on the right, whatever the app language
    // (native only mirrors rows under RTL layout; react-native-web has no `direction` style).
    ...(Platform.OS === 'web' ? {} : { direction: 'ltr' as const }),
    flexDirection: 'row',
    height: BACK_BAR_HEIGHT,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  backButton: {
    alignItems: 'center',
    height: BACK_BAR_HEIGHT,
    justifyContent: 'center',
    width: 44,
  },
  pageArea: {
    alignItems: 'center',
    flex: 1,
  },
  duaLink: {
    position: 'absolute',
  },
  duaLinkText: {
    fontSize: typography.body,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  wirdRow: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
  },
  missingPage: {
    alignItems: 'center',
    borderRadius: radii.md,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  missingNumber: {
    fontSize: 28,
    fontWeight: '600',
  },
  missingText: {
    fontSize: typography.body,
    lineHeight: typography.body * 1.4,
    textAlign: 'center',
  },
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 25,
    fontWeight: '700',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  hint: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '700',
  },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panelTitle: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  reference: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '800',
    writingDirection: 'ltr',
  },
  smallIconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '800',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  input: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.inputBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  status: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  statusError: {
    color: colors.danger,
  },
  muted: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  stopRow: {
    alignItems: 'center',
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  stopText: {
    flex: 1,
    gap: 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  renameRow: {
    borderTopColor: colors.divider,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  renameActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  stopName: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  segmented: {
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  segment: {
    alignItems: 'center',
    borderRadius: radii.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.xs,
  },
  segmentSelected: {
    backgroundColor: colors.primaryButton,
  },
  segmentText: {
    color: colors.textPrimary,
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'center',
  },
  segmentTextSelected: {
    color: colors.onPrimaryButton,
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.78,
  },
});
