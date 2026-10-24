import * as Clipboard from 'expo-clipboard';
import * as Font from 'expo-font';
import { useFonts } from 'expo-font';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, CircleHelp, Headphones, Maximize2, Minimize2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View, type LayoutRectangle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet } from '@/components/ConfirmSheet';
import { KhatmaReachedSheet } from '@/components/KhatmaReachedSheet';
import { OfflineMushafPanel } from '@/components/OfflineMushafPanel';
import { isAudioActive, MushafAudioPlayer } from '@/components/MushafAudioPlayer';
import { MushafAyahActions, MushafWirdApply, type PopupAnchor } from '@/components/MushafAyahPopups';
import { MushafIndexSheet, type MushafIndexMode } from '@/components/MushafIndexSheet';
import { MushafGuide } from '@/components/MushafGuide';
import { MushafPageSelector, PAGE_SELECTOR_BOTTOM_MARGIN, PAGE_SELECTOR_CARD_HEIGHT } from '@/components/MushafPageSelector';
import { MushafPageView } from '@/components/MushafPageView';
import { MushafStopNameField } from '@/components/MushafStopNameField';
import { MushafSvgText } from '@/components/MushafSvgText';
import { MushafWirdSelector, WIRD_PILL_HEIGHT } from '@/components/MushafWirdSelector';
import { MushafZoomView, type MushafZoomHandle } from '@/components/MushafZoomView';
import { QpcV1PageText } from '@/components/QpcV1PageText';
import { ReflectionSheet } from '@/components/ReflectionSheet';
import { ShareAyahSheet } from '@/components/ShareAyahSheet';
import { MUSHAF_PANEL_COLORS, MUSHAF_PAPER } from '@/constants/mushafTheme';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { isRtlLocale } from '@/localization/locales';
import { fill } from '@/localization/fill';
import { useAppLocale } from '@/localization/useAppLocale';
import { useFavorites } from '@/hooks/useFavorites';
import { MUSHAF_BACKGROUNDS, MUSHAF_BORDER_STYLES, MUSHAF_INKS, MUSHAF_PAGE_FURNITURE, MUSHAF_WIRD_MARKER, resolveMushafAppearance } from '@/mushaf/appearance';
import { QCF_V1_NORMAL_BOX_MARGIN_EM } from '@/mushaf/ayahMarkers';
import { HAFS_KFQC_PAGE_061 } from '@/mushaf/generated/hafsKfqcPage061';
import { KHATM_DUA } from '@/mushaf/khatmDua';
import { MUSHAF_HEADER_FONT_FAMILY, MUSHAF_HEADER_FONTS } from '@/mushaf/headerFonts';
import { MUSHAF_PAGE_COUNT, parseMushafPage, tintAyahMarkers, tintSvgInk, toArabicIndicDigits } from '@/mushaf/mushafPage';
import { HIZB_START_PAGES, pageInfo } from '@/mushaf/navigation';
import { GuideTargetsProvider, type GuideTarget } from '@/mushaf/guideTargets';
import { GUIDE_STEPS, isGuideFinished, loadGuideProgress, saveGuideProgress, type GuideProgress } from '@/mushaf/mushafGuide';
import { useMushafKeepAwake } from '@/mushaf/useMushafKeepAwake';
import { useQuietRemindersWhileReading } from '@/notifications/foreground';
import type { Ayah } from '@/types/domain';
import { applyToWirdLabel } from '@/mushaf/pageSelector';
import { requestedAyahOnPage } from '@/mushaf/ayahInMushaf';
import { offlineMushaf } from '@/mushaf/offline';
import { readRelayPageForDev } from '@/mushaf/offline/devRelayPage';
import { useMushafAutoDownload } from '@/mushaf/offline/useMushafAutoDownload';
import { qcfFontUrl } from '@/mushaf/offline/fonts';
import { resolveDecorations } from '@/mushaf/decorations';
import { hizbLabelsForPage } from '@/mushaf/hizbQuarters';
import { BORDER_TILES_DOWN, computePageLayout, MIN_TILES_DOWN, MUSHAF_TEXT_LIFT_PT } from '@/mushaf/pageGeometry';
import { pageBoxOnScreen, remapAnchor, sameBox } from '@/mushaf/popupAnchor';
import { createResizeSettler } from '@/layout/resizeSettler';
import { windowClassFor } from '@/layout/windowClass';
import { QPC_V1_FONTS } from '@/mushaf/qpcV1Fonts';
import { checkAgainstTanzil, loadQpcV1PageLayout, type QpcV1PageLayout } from '@/mushaf/qpcV1Layout';
import { confirmKhatma, loadReadingData, saveWirdPage, type ReadingCycle } from '@/mushaf/khatmas';
import { parsePageNumber } from '@/mushaf/pageNumber';
import { loadLastBrowsedPage, openingPage, saveLastBrowsedPage } from '@/mushaf/lastBrowsedPage';
import {
  activeReadingStop,
  loadActiveReadingStopId,
  loadReadingStops,
  normalizeReadingStopName,
  ReadingStopError,
  setActiveReadingStopId,
  subscribeToReadingData,
  type ReadingStop,
} from '@/mushaf/readingStops';
import { subscribeToLocalDataOwner } from '@/storage/localDataOwner';
import { BASMALA_FONT_PAGE, surahOpeningSlots } from '@/mushaf/surahOpenings';
import { isWirdAyahOnPage, wirdAyahOnPage } from '@/mushaf/wirdAyah';
import { mushafCopyText } from '@/mushaf/ayahCopyText';
import { audioEngine } from '@/audio/index';
import { pageOfPosition, positionOfVerseKey, verseKeyOf } from '@/audio/quranSequence';
import { useFavoriteReciter } from '@/audio/useFavoriteReciter';
import { usePlayback } from '@/audio/usePlayback';
import { getApiErrorMessage } from '@/services/api';
import { getAyahForAction } from '@/services/ayahForAction';
import { getVerseByKey } from '@/services/quran';
import { getSurahName } from '@/services/surahNames';
import { useThemedStyles, useThemeName } from '@/theme/useTheme';
import { devLog } from '@/utils/devLog';
import { goBackOrHome } from '@/utils/goBackOrHome';
import { MushafFeatureLayer } from '@/mushafFeatures/MushafFeatureLayer';

/**
 * The Mushaf reader (/mushaf): a plain Back arrow in a slim row under the
 * status bar, then the printed QPC V1 page as large as the screen allows.
 * Swiping turns the page, following the finger with its neighbour beside it
 * (both drawn ahead); pinching zooms it (MushafZoomView). The active reading
 * stop (ورد) sits under the page (MushafWirdSelector, unchanged). The sources
 * are credited on Home and in /credits.
 *
 * Navigation and actions live on the page itself (2026-10-14 redesign; the
 * earlier floating bar is preserved in design-archive/mushaf-navigation-v1/):
 *  - the Surah name, juz' and Hizb label in the running heads open searchable
 *    lists (MushafIndexSheet);
 *  - the page number under the frame opens the compact page selector, an RTL
 *    slider with a contextual arrow (MushafPageSelector);
 *  - a tap on an ayah's words: Reflection, Save (to Favorites), Copy (its verified
 *    Arabic text) or Share, nothing else;
 *  - a tap on its number (the separator medallion): Apply to the active ورد,
 *    saving this page and that ayah to it (MushafAyahPopups). The active
 *    ورد's saved ayah is then drawn with a gold medallion (MUSHAF_WIRD_MARKER)
 *    for as long as it is that ورد's position: another Apply moves it, a
 *    page-only save, a Khatma or deleting the ورد clears it, and choosing
 *    another ورد shows that one's (or none).
 * Screen readers turn pages with the page's own next / previous actions.
 *
 * Listening (audio/, 2026-10-17): the headphones icon in the top bar plays from the first ayah of the page shown; while
 * playing, the player's chip (Pause, the Sheikh, the ayah) takes its place, and paused, stopped or finished the
 * headphones are back (a tap resumes); an ayah's Listen plays from that ayah. Either goes on ayah after ayah, surah after surah, and the page turns by itself
 * when the recitation reaches the next page (every page begins with a whole ayah, so ayah timing is exact enough). The
 * ayah being recited is highlighted like a selection. While playing, the player is a chip in the same top bar
 * (MushafAudioPlayer): the page keeps its size and place. Swiping away stops the page following the recitation until
 * Follow recitation (or a swipe back to that page). Listening never saves or moves a ورد, a Khatma or the last browsed
 * page: reading and listening positions are separate.
 *
 * Navigating (swipes, the lists, the selector) only shows a page: no stop is
 * ever saved or moved except by an explicit save (Apply, or the ورد list's
 * Add and its name field).
 *
 * Full-screen reading (the top-right Expand / Collapse icon): only the page,
 * the audio control (headphones, or the player's chip while playing) and the
 * Collapse icon stay; the Back arrow, Help, the bar and the ورد pill hide,
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
 * pages, in every build, and with the larger text (candidate C, 2026-10-14) in
 * Normal Mode too): the same page with a taller frame — more of the same
 * border tiles down its sides — and the lines spaced evenly further apart,
 * filling the height the device has to spare, up to TALLER_MAX_LINE_SPACING
 * (none to spare: the Traditional page). It is automatic: there is no layout
 * choice or setting.
 *
 * Pages: every page comes from the offline Mushaf when it is installed (its
 * layout and page font); page 61 also works online (our backend's layout and
 * the bundled font), with the Quran SVG page as its fallback. A page is drawn
 * only after its layout passes the check against the verified Tanzil text.
 * A page that isn't downloaded shows the offline download instead.
 *
 * The Mushaf tab (app/(tabs)/_layout.tsx): it stays mounted while other
 * tabs show, so returning shows the same page and active ورد. The tab bar is
 * hidden on this tab in both modes (declared in the tabs layout), so the
 * reader has the whole screen and the page keeps its approved size; Back
 * returns to the tab it came from (Home when opened directly). /mushaf?page=N&at=<time> (Home, أورادي
 * وختماتي) opens page N even when the reader is already open.
 *
 * Khatma (mushaf/khatmas.ts): saving the active ورد from an earlier page to
 * page 604 offers «ما شاء الله، أتممت ختم القرآن» with إتمام الختمة / ليس الآن.
 * Nothing is counted unless confirmed; declined, it stays pending in
 * أورادي وختماتي. Showing page 604 never offers or counts anything.
 */

/** Page 61: bundled (its font, its online layout and the Quran SVG fallback), so it is drawn even before the offline download. */
const DEFAULT_PAGE = 61;
/** Where a reader with no saved position starts: the first page of the Mushaf. */
const FIRST_PAGE = 1;
/**
 * Just enough to keep the frame and the running heads off the screen's edge
 * (curved edges included). On phones the width is what limits the page's size.
 */
const SIDE_MARGIN = 3;
/** The slim row for the Back arrow, under the status bar (its touch target reaches 44 pt upward). */
export const BACK_BAR_HEIGHT = 36;
/**
 * Normal Mode: between the ورد row and the bottom safe area. The retired floating bar's reserved 56 + 8 pt
 * (design-archive/mushaf-navigation-v1/) was reclaimed for the larger text (candidate C, 2026-10-14): the page takes
 * that height (a taller frame; on height-limited phones a wider page), and the ورد pill stays directly under it.
 */
const PAGE_PANEL_GAP = 4;
/**
 * Normal Mode: the Quran text ends at least this far above the page-number selector's card when it opens (its top:
 * PAGE_SELECTOR_CARD_HEIGHT + PAGE_SELECTOR_BOTTOM_MARGIN above the bottom safe area), so the card never covers it, as
 * when the retired bar's space was reserved. Where the reclaimed height would bring the text lower, the frame has a tile
 * less, or on the shortest screens the page is a little narrower. Full screen is unchanged (its card has always opened
 * over the page's last lines).
 */
const SELECTOR_TEXT_CLEARANCE = 4;
/** Kept free under the page for the ورد pill: on phones the page is narrower than it could be tall, so this costs nothing there. */
export const WIRD_ROW_HEIGHT = 32;
/**
 * A cycle a confirmed Khatma has just restarted, with no reading progress saved in it since (its persisted, synced
 * startedByKhatmaId and savedSinceStart): page 604 never completes it — neither إتمام الختمة nor the bookmark.
 */
export const restartedWithoutProgress = (cycle: ReadingCycle) => cycle.startedByKhatmaId !== null && !cycle.savedSinceStart;
/**
 * Page 604's row: إتمام الختمة | ورد name | دعاء ختم القرآن. Each link at most 29% of the row (inset spacing.md), the
 * name at most 30%, centred: on a 320 pt phone that leaves about 5 pt between each link and the name.
 */
export const END_LINK_MAX_WIDTH = '29%';
export const PAGE_604_PILL_MAX_WIDTH = '30%';
/** Page 604's links on the page number's line: half their band's height (room for their text and its touch target). */
const END_LINK_BAND_HALF = 28;
/** About half a link's height at the default text size (27 pt on the Android emulator), for its touch target's top. */
const END_LINK_HALF_HEIGHT = 14;
/** How long Copy reads "Copied" after it succeeds (as the ayah card's copy icon). */
const COPY_CONFIRMATION_MS = 1300;
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
 * it, and the zoom viewport reaches down to PAGE_PANEL_GAP above the bottom
 * safe area. Full screen has no ورد row: the page and the viewport reach down
 * to the bottom safe area. `taller` (QPC pages, both modes): at that width,
 * the tallest whole-tile frame that fits, up to TALLER_MAX_TILES_DOWN; computed
 * from the actual space, so any phone (or, later, tablet) gets its own.
 */
export function fitMushafPage(area: { width: number; height: number }, bottomInset: number, fullScreen = false, taller = false) {
  const viewportHeight = Math.max(0, area.height - (fullScreen ? FULL_SCREEN_BOTTOM_GAP : PAGE_PANEL_GAP) - bottomInset);
  const available = viewportHeight - (fullScreen ? 0 : WIRD_ROW_HEIGHT);
  // The page width (and so the Quran glyphs' size) is Normal Mode's in both modes: full screen never enlarges the
  // text, its extra height goes to a taller frame and wider line spacing (Taller) instead.
  // Its height is that of the shortest frame the larger text allows (MIN_TILES_DOWN), and Normal Mode's text ends above
  // the page selector's card (SELECTOR_TEXT_CLEARANCE).
  const normalViewport = Math.max(0, area.height - PAGE_PANEL_GAP - bottomInset);
  const normalAvailable = normalViewport - WIRD_ROW_HEIGHT;
  const textBottomLimit = normalViewport + PAGE_PANEL_GAP - PAGE_SELECTOR_BOTTOM_MARGIN - PAGE_SELECTOR_CARD_HEIGHT - SELECTOR_TEXT_CLEARANCE;
  const clearOfSelector = (w: number, tiles: number) => textBottomFor(w, tiles) <= textBottomLimit;
  let width = Math.floor(Math.max(0, Math.min(area.width - SIDE_MARGIN * 2, normalAvailable / (pageHeightFor(1000, MIN_TILES_DOWN) / 1000))));
  while (width > 0 && !clearOfSelector(width, MIN_TILES_DOWN)) width -= 1;
  // Taller: at that same width, the tallest whole-tile frame that still fits, from the shortest one allowed.
  let tilesDown = taller && width > 0 ? MIN_TILES_DOWN : BORDER_TILES_DOWN;
  while (taller && width > 0 && tilesDown < TALLER_MAX_TILES_DOWN && pageHeightFor(width, tilesDown + 1) <= available && (fullScreen || clearOfSelector(width, tilesDown + 1))) tilesDown += 1;
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

/**
 * Where the Quran text ends on that page (from its top), for choosing the frame: the text area, MUSHAF_TEXT_LIFT_PT up.
 * Deliberately the approved fixed lift on every platform, so the page width and tile count stay exactly as approved; on
 * iOS and Android the text is drawn higher still (mushafTextLift), so it ends even further above the selector's card.
 */
function textBottomFor(width: number, tilesDown: number) {
  const { text } = computePageLayout(width, tilesDown);
  return text.y + text.height - MUSHAF_TEXT_LIFT_PT;
}

/** The reader's one open popup (or none). */
type Overlay =
  /** `ayahKey`: opened from an ayah's number with no ورد selected, so the new (or named) ورد takes that ayah too. */
  | { kind: 'stopName'; ayahKey?: string | null }
  | { kind: 'index'; mode: MushafIndexMode }
  | { kind: 'pageSelector' }
  | { kind: 'ayah'; verseKey: string; anchor: PopupAnchor }
  | { kind: 'wird'; verseKey: string; anchor: PopupAnchor }
  | null;

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

/** Western or Arabic-Indic digits → a page number, or null (shared with أورادي وختماتي). */
export { parsePageNumber };

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

/** One page's layout and font, checked against the verified Tanzil text before it may be drawn. Never throws. */
async function loadPageState(page: number, onlineInDev: boolean): Promise<PageState> {
  const startedAt = Date.now();
  try {
    const offline = await offlineMushaf.readPage(page).catch(() => null);
    // Online: page 61 from the page API; in development builds with ?source=online, any page straight from the relay.
    const devRelay = !offline && onlineInDev && page !== DEFAULT_PAGE
      ? await readRelayPageForDev(page).catch(() => null)
      : null;
    const layout = offline ?? devRelay ?? (page === DEFAULT_PAGE ? await loadQpcV1PageLayout(page).catch(() => null) : null);
    if (!layout) return page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'missing' };
    const tanzil: Record<string, string> = {};
    for (const verseKey of layout.verseKeys) tanzil[verseKey] = (await getVerseByKey(verseKey)).arabicText;
    const basmala = (await getVerseByKey('1:1')).arabicText;
    const check = checkAgainstTanzil(layout, layout.verseKeys, tanzil, basmala);
    const fontReady = page === DEFAULT_PAGE ? true : await ensurePageFont(page, layout.fontFamily);
    devLog('mushaf', 'page', { page, source: offline ? 'offline' : 'api', ms: Date.now() - startedAt, ok: check.ok, fontReady, problems: check.problems });
    // A Basmala line is drawn in page 1's font; without it the line stays empty (never another font).
    const needsBasmala = surahOpeningSlots(layout).some((slot) => slot.kind === 'basmala');
    const basmalaFont = needsBasmala && (await ensurePageFont(BASMALA_FONT_PAGE, 'QCF_P001')) ? 'QCF_P001' : null;
    if (check.ok && fontReady) return { status: 'qpc', layout, source: offline ? 'offline' : 'api', basmalaFont };
    return page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'unavailable' };
  } catch {
    return page === DEFAULT_PAGE ? { status: 'svg' } : { status: 'unavailable' };
  }
}

const LOADING: PageState = { status: 'loading' };
/** A neighbour page's ayahs can't be chosen: it is only seen sliding in. */
const ignoreVerse = () => undefined;

export default function MushafScreen() {
  // Keep Screen Awake (Settings): held only while this reader is focused, the app active and the setting ON.
  useMushafKeepAwake();
  // A reminder arriving while reading is listed, without a banner or sound (notifications/foreground.ts).
  useQuietRemindersWhileReading();
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
  // An ayah's reference on its card (AyahCard → mushaf/ayahInMushaf.ts): that ayah selected on its page, as a tap would.
  const requestedAyah = requestedAyahOnPage(params.ayah, requestedPage);
  // No ?page=: page 1 until the saved ورد (if any) is read from storage just below.
  const initialPage = requestedPage ?? FIRST_PAGE;
  const [page, setPage] = useState(initialPage);
  // What was loaded for the page and its two neighbours (drawn beside it for a swipe), and for which reload: any other
  // page is still loading. The loads themselves, by page, reload and source, so a neighbour already loading or loaded
  // is never read twice when it becomes the page.
  const [loadedPages, setLoadedPages] = useState<Record<number, { reload: number; state: PageState }>>({});
  const pageLoads = useRef(new Map<string, { page: number; load: Promise<PageState> }>());
  const [reloadKey, setReloadKey] = useState(0);
  // The offline Mushaf changed (a download, update or removal ended, automatic or from the panel): read the pages again.
  const { runs: offlineRuns } = useMushafAutoDownload();
  const seenOfflineRuns = useRef(offlineRuns);
  useEffect(() => {
    if (seenOfflineRuns.current === offlineRuns) return;
    seenOfflineRuns.current = offlineRuns;
    setReloadKey((key) => key + 1);
  }, [offlineRuns]);
  const [fontsLoaded, fontError] = useFonts(QPC_V1_FONTS);
  // Separate, so the heads' font can never hold back or disable the Quran text.
  const [headerFontLoaded] = useFonts(MUSHAF_HEADER_FONTS);
  const [selectedVerseKey, setSelectedVerseKey] = useState<string | null>(requestedAyah);
  const [isReflectionVisible, setIsReflectionVisible] = useState(false);
  // At most one of the reader's popups at a time: the ورد name field, a Surah / juz' / Hizb list, the page selector,
  // an ayah's actions (its words) or its Apply-to-ورد (its separator). Closing it never changes the page or a ورد.
  const [overlay, setOverlay] = useState<Overlay>(null);
  // The first-time guide (mushaf/mushafGuide.ts): the controls it points at, as the page being read registers them.
  const guideTargetViews = useRef(new Map<GuideTarget, View>());
  /** Which controls are registered now (and a count of changes, so a moved or replaced control is measured again). */
  const [guideTargets, setGuideTargets] = useState({ names: '', changes: 0 });
  const registerGuideTarget = useCallback((target: GuideTarget, view: View | null) => {
    const views = guideTargetViews.current;
    if (view ? views.get(target) === view : !views.has(target)) return;
    if (view) views.set(target, view);
    else views.delete(target);
    setGuideTargets((current) => ({ names: [...views.keys()].sort().join(','), changes: current.changes + 1 }));
  }, []);
  const [guideProgress, setGuideProgress] = useState<GuideProgress | null>(null);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const guideAutoShown = useRef(false);
  // Settings → Quran → Mushaf Guide: /mushaf?guide=<time> opens the guide at step 1, once per request (applied while
  // rendering, like ?page= below). It records nothing: what was saved about the guide stays as it was.
  const guideRequest = typeof params.guide === 'string' ? params.guide : '';
  const [handledGuideRequest, setHandledGuideRequest] = useState('');
  if (guideRequest && guideRequest !== handledGuideRequest) {
    setHandledGuideRequest(guideRequest);
    setOverlay(null);
    setGuideStep(0);
    setGuideVisible(true);
  }
  // An ayah tap waits DOUBLE_TAP_MS before its popup opens, so a double-tap (the zoom reset) never opens one.
  const pendingAyahPopup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ayahBusy, setAyahBusy] = useState(false);
  const [ayahError, setAyahError] = useState<string | null>(null);
  // Copy: the ayah just copied ("Copied" for COPY_CONFIRMATION_MS), and its timer.
  const [copiedVerseKey, setCopiedVerseKey] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);
  const { favorites, isFavorite, toggleFavorite } = useFavorites();
  // Quran audio: the app's one player (audio/engine.ts) and the Favorite Reciter (Settings).
  const playback = usePlayback();
  const { reciterId: favoriteReciterId } = useFavoriteReciter();
  /**
   * The page of the ayah being recited in the Mushaf's playback (continuous or Full Surah; null when nothing is, or for an ayah
   * screen's single ayah): shown while following, highlighted wherever it is drawn. Whole-surah playback (no verified
   * ayah timing) has no known ayah: nothing is highlighted and no page is turned to.
   */
  // Nor does a stop that is waiting for the whole-surah choice: that recording cannot recite the ayah asked for.
  const knownAyah = playback.phase !== 'idle' && playback.granularity === 'ayah' && playback.error?.kind !== 'surah-only' ? playback.position : null;
  const playingPosition = knownAyah && playback.mode !== 'single' ? knownAyah : null;
  const playingPage = playingPosition ? pageOfPosition(playingPosition) : null;
  const playingVerseKey = knownAyah ? verseKeyOf(knownAyah) : null;
  // Whether the page shown follows the recitation. Set by the reader's own page moves (goTo, turn, a link): false away
  // from the recited page, true on it; true again for every new listening session, Follow recitation, and when the
  // recitation reaches the page being read.
  const [following, setFollowing] = useState(true);
  const [followSession, setFollowSession] = useState(playback.session);
  if (followSession !== playback.session) {
    setFollowSession(playback.session);
    setFollowing(true);
  }
  const [seenPlayingPage, setSeenPlayingPage] = useState(playingPage);
  if (seenPlayingPage !== playingPage) {
    setSeenPlayingPage(playingPage);
    if (playingPage !== null && playingPage === page && !following) setFollowing(true);
  }
  // The page the recitation itself last turned to: not a browse (the last browsed page is never moved by listening).
  const [autoTurnedPage, setAutoTurnedPage] = useState<number | null>(null);
  // Share: the ayah being shared in the existing Share Ayah sheet (the same one as the ayah screens), or none.
  const [sharing, setSharing] = useState<Ayah | null>(null);
  // Measured, not the window size: right on tablets, split screen and web. On tablet-sized windows a rotation's layouts,
  // or a window being dragged, are applied once they stop, so the page's text is refitted once, at the final size
  // (layout/resizeSettler.ts). Phone-sized windows apply every change at once, as before.
  const [area, setArea] = useState({ width: 0, height: 0 });
  const [areaSettler] = useState(() => createResizeSettler(setArea, {
    settle: (next, applied) => windowClassFor(next.width) !== 'compact' || windowClassFor(applied.width) !== 'compact',
  }));
  useEffect(() => () => areaSettler.cancel(), [areaSettler]);
  // The selection before the latest tap, so a double-tap (zoom reset) can put it back.
  const lastTap = useRef<{ before: string | null; at: number; ignoreUntil: number }>({ before: null, at: 0, ignoreUntil: 0 });
  // The fit (viewport and page size) the page was zoomed in at, or null at 1×: zoomed only while that fit is current, so
  // a rotation or resize (which refits the page and returns it to 1×, MushafZoomView) ends it without an extra update.
  const [zoomedAt, setZoomedAt] = useState<string | null>(null);
  // Development builds only: read any page straight from the relay (?source=online), to check it without installing.
  const onlineInDev = isDevBuild() && params.source === 'online';
  // Which design each decoration draws (mushaf/decorations.ts): the constants; previews in development builds.
  const decorations = resolveDecorations(params, isDevBuild());
  const zoomView = useRef<MushafZoomHandle>(null);
  // Full-screen reading: off whenever the reader opens.
  const [fullScreen, setFullScreen] = useState(false);
  // Reading stops (ورد): the list and the active one, as stored on the device.
  const [stops, setStops] = useState<ReadingStop[]>([]);
  const [activeStopId, setActiveStopId] = useState<string | null>(null);
  const [isWirdOpen, setIsWirdOpen] = useState(false);
  // The feature sheets (mushafFeatures/: المعاني, عن السورة): whether one is open (they keep their own state; Normal Mode only).
  const [featureSheetOpen, setFeatureSheetOpen] = useState(false);
  // The widest the ورد pill may be so those buttons fit beside it (a long name then ends in “…” sooner); null: no limit.
  const [featurePillRoom, setFeaturePillRoom] = useState<number | null>(null);
  // The ورد pill as laid out in its row: المعاني sits on its line when there is room beside it.
  const [wirdPill, setWirdPill] = useState<LayoutRectangle | null>(null);
  // Page 604: إتمام الختمة's lower edge as laid out (in the page area), the highest المعاني may reach under it.
  const [endLinkBottom, setEndLinkBottom] = useState<number | null>(null);
  const activeStop = activeReadingStop(stops, activeStopId);
  // Set once the reader moves: the active stop's page then no longer replaces the opening page.
  const hasNavigated = useRef(false);
  const initialRequest = useRef(`${String(params.page ?? '')}|${String(params.at ?? '')}|${String(params.ayah ?? '')}`);
  // «ما شاء الله، أتممت ختم القرآن»: after a save took this ورد's cycle to page 604.
  const [reached, setReached] = useState<{ stopId: string; cycleId: string; name: string } | null>(null);
  // Page 604's إتمام الختمة when it cannot open the confirmation: why (nothing recorded).
  const [khatmaNotice, setKhatmaNotice] = useState<'noWird' | 'newCycle' | 'notReady' | 'saveFailed' | null>(null);
  // One إتمام الختمة at a time: a second tap while it saves does nothing (a ref: it is seen in the same frame).
  const completingRef = useRef(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmingRef = useRef(false);
  const [confirmFailed, setConfirmFailed] = useState(false);

  // On opening: the stops and the active one. Without ?page=, the active stop's saved page opens.
  // Afterwards the list follows every change to reading data (أورادي وختماتي, Home) and the account, without moving the page.
  useEffect(() => {
    let cancelled = false;
    const reload = async (opening: boolean) => {
      const [list, id, lastBrowsed] = await Promise.all([loadReadingStops(), loadActiveReadingStopId(), opening ? loadLastBrowsedPage() : null]);
      if (cancelled) return;
      setStops(list);
      setActiveStopId(id);
      // The saved position: the active ورد's page, else the most recently saved ورد's (as Home's متابعة التلاوة) —
      // unless this device browsed elsewhere after that save (mushaf/lastBrowsedPage.ts); none: page 1.
      const saved = activeReadingStop(list, id) ?? list[0] ?? null;
      const start = opening ? openingPage(lastBrowsed, saved) : null;
      if (start !== null && requestedPage === null && !hasNavigated.current) setPage(start);
    };
    void reload(true);
    const unsubscribeData = subscribeToReadingData(() => void reload(false));
    const unsubscribeOwner = subscribeToLocalDataOwner(() => void reload(false));
    return () => {
      cancelled = true;
      unsubscribeData();
      unsubscribeOwner();
    };
    // Only on opening: later changes arrive through the subscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page's layout and font (loadPageState), then its neighbours', so a swipe finds them drawn.
  useEffect(() => {
    let cancelled = false;
    const near = (n: number) => Math.abs(n - page) <= 1;
    for (const [key, entry] of pageLoads.current) if (!near(entry.page) || !key.endsWith(`|${reloadKey}|${onlineInDev}`)) pageLoads.current.delete(key);
    void (async () => {
      for (const n of [page, page + 1, page - 1]) {
        if (n < 1 || n > MUSHAF_PAGE_COUNT) continue;
        const key = `${n}|${reloadKey}|${onlineInDev}`;
        let entry = pageLoads.current.get(key);
        if (!entry) {
          entry = { page: n, load: loadPageState(n, onlineInDev) };
          pageLoads.current.set(key, entry);
        }
        const state = await entry.load;
        // A newer page takes over (and finds this load already done).
        if (cancelled) return;
        setLoadedPages((previous) => {
          if (previous[n]?.reload === reloadKey && previous[n].state === state) return previous;
          const next: Record<number, { reload: number; state: PageState }> = {};
          for (const [kept, value] of Object.entries(previous)) if (near(Number(kept))) next[Number(kept)] = value;
          next[n] = { reload: reloadKey, state };
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, reloadKey, onlineInDev]);

  /** Closes whatever popup is open, and an ayah popup still waiting to open. Changes nothing else. */
  const closeOverlay = useCallback(() => {
    if (pendingAyahPopup.current) {
      clearTimeout(pendingAyahPopup.current);
      pendingAyahPopup.current = null;
    }
    setOverlay(null);
    setAyahError(null);
  }, []);
  useEffect(() => () => {
    if (pendingAyahPopup.current) clearTimeout(pendingAyahPopup.current);
  }, []);
  // The page shown, for a waiting ayah popup: it never opens over another page.
  const pageRef = useRef(page);
  useEffect(() => {
    pageRef.current = page;
  }, [page]);
  // A page the reader was moved to (a swipe, the selector, the index, a link) is remembered on this device only, so
  // browsing survives a restart. Never a save: no ورد, Khatma cycle or medallion changes (mushaf/lastBrowsedPage.ts).
  // The page the reader opens on by itself (a ورد's saved page) is not a browse.
  useEffect(() => {
    // A page the recitation turned to is not a browse (listening never moves the reading position).
    if (autoTurnedPage === page) return;
    if (hasNavigated.current || requestedPage !== null) void saveLastBrowsedPage(page);
  }, [page, requestedPage, autoTurnedPage]);

  /** Shows a page — and only that: nothing is saved (the lists, the selector, stops and links all use it). */
  const goTo = useCallback((next: number) => {
    if (next < 1 || next > MUSHAF_PAGE_COUNT) return;
    hasNavigated.current = true;
    setAutoTurnedPage(null);
    setPage(next);
    setSelectedVerseKey(null);
    closeOverlay();
    setZoomedAt(null); // a new page opens at 1×
    // While listening: moving away stops the page following the recitation; landing on its page follows it again.
    if (playingPage !== null) setFollowing(next === playingPage);
  }, [closeOverlay, playingPage]);
  /** One page back (-1) or forward (+1): swipes, and the page's screen-reader actions. */
  const turn = useCallback((delta: -1 | 1) => {
    hasNavigated.current = true;
    setAutoTurnedPage(null);
    setPage((current) => Math.min(MUSHAF_PAGE_COUNT, Math.max(1, current + delta)));
    setSelectedVerseKey(null);
    closeOverlay();
    setZoomedAt(null);
    if (playingPage !== null) setFollowing(Math.min(MUSHAF_PAGE_COUNT, Math.max(1, pageRef.current + delta)) === playingPage);
  }, [closeOverlay, playingPage]);
  // A finger swipe left to right = next, right to left = previous (the same in every language; swipes at 1× only —
  // mushaf/pageZoom.ts swipeTurn).

  // A later /mushaf?page=N&at=… (Home's Continue Reciting, أورادي وختماتي) while the reader is already open:
  // applied while rendering (React's "adjust state when a prop changes"), once per request.
  const requestToken = `${String(params.page ?? '')}|${String(params.at ?? '')}|${String(params.ayah ?? '')}`;
  const [handledRequest, setHandledRequest] = useState(requestToken);
  if (handledRequest !== requestToken) {
    setHandledRequest(requestToken);
    if (requestedPage !== null) {
      setPage(requestedPage);
      setSelectedVerseKey(requestedAyah);
      setOverlay(null);
      setZoomedAt(null);
      if (playingPage !== null) setFollowing(requestedPage === playingPage);
    }
  }
  // Such a page is a navigation: the active ورد's saved page no longer replaces it on opening.
  useEffect(() => {
    if (handledRequest !== initialRequest.current) hasNavigated.current = true;
  }, [handledRequest]);

  /** Where a popup goes when a tap's position isn't known (the web): the middle of the reading area. */
  const middle = (): PopupAnchor => ({ x: insets.left + area.width / 2, y: insets.top + BACK_BAR_HEIGHT + area.height / 2 });
  /**
   * A tap on an ayah: it is selected (highlighted) at once, and its popup opens DOUBLE_TAP_MS later, unless the tap
   * turns out to be half of a double-tap (onDoubleTap cancels it) or the page has changed meanwhile.
   */
  const tapAyah = (kind: 'ayah' | 'wird', verseKey: string, at?: PopupAnchor) => {
    const now = Date.now();
    // A tap of a double-tap that arrives after the double-tap itself (the web's click comes late).
    if (now < lastTap.current.ignoreUntil) return;
    if (now - lastTap.current.at > DOUBLE_TAP_MS) lastTap.current.before = selectedVerseKey;
    lastTap.current.at = now;
    setSelectedVerseKey(verseKey);
    if (pendingAyahPopup.current) clearTimeout(pendingAyahPopup.current);
    const forPage = page;
    const anchor = at ?? middle();
    pendingAyahPopup.current = setTimeout(() => {
      pendingAyahPopup.current = null;
      if (pageRef.current !== forPage) return;
      setAyahError(null);
      setOverlay({ kind, verseKey, anchor });
    }, DOUBLE_TAP_MS);
  };
  /** A tap on an ayah's words: Reflection or Save. */
  const selectVerse = (verseKey: string, at?: PopupAnchor) => tapAyah('ayah', verseKey, at);
  /** A tap on an ayah's number (the separator medallion): Apply to the active ورد. */
  const pressMarker = (verseKey: string, at?: PopupAnchor) => tapAyah('wird', verseKey, at);
  /** A double-tap resets the zoom; its two taps leave the selection as it was and open no popup. */
  const onDoubleTap = () => {
    const now = Date.now();
    if (pendingAyahPopup.current) {
      clearTimeout(pendingAyahPopup.current);
      pendingAyahPopup.current = null;
    }
    if (now - lastTap.current.at <= DOUBLE_TAP_MS * 2) setSelectedVerseKey(lastTap.current.before);
    lastTap.current.ignoreUntil = now + DOUBLE_TAP_MS;
  };
  /** An ayah popup dismissed without an action: its ayah is no longer selected. */
  const dismissAyahPopup = () => {
    closeOverlay();
    setSelectedVerseKey(null);
  };
  /** Reflection: the existing Reflection editor for the selected ayah (it stays selected). */
  const openReflection = () => {
    closeOverlay();
    setIsReflectionVisible(true);
  };
  /**
   * Save: the existing Favorites toggle for this ayah (as on the ayah screens: the full ayah, then the toggle). Offline
   * too: removing uses the saved favorite itself (no network), and saving falls back to the device's own ayah — the
   * verified local Arabic, its translation fetched later (services/ayahForAction.ts).
   */
  const toggleSaved = async () => {
    if (overlay?.kind !== 'ayah' || ayahBusy) return;
    setAyahBusy(true);
    setAyahError(null);
    try {
      // The popup stays open: its heart follows Favorites (isFavorite), so it fills or empties as soon as this succeeds.
      const saved = favorites.find((favorite) => favorite.verseKey === overlay.verseKey);
      await toggleFavorite(saved ?? (await getAyahForAction(overlay.verseKey)));
    } catch (error) {
      setAyahError(getApiErrorMessage(error, messages.ayah.genericError));
    } finally {
      setAyahBusy(false);
    }
  };
  /**
   * Copy: the ayah's verified Arabic, complete with its marks, from the device (the same Tanzil text the page is checked
   * against; works offline), without the Basmala Tanzil prefixes to some first ayahs, then a blank line and its
   * reference, as AyahCard copies it: never a translation or the page's QCF glyph codes (mushaf/ayahCopyText.ts). The
   * popup stays open; "Copied" shows only once it succeeded.
   */
  const copySelected = async () => {
    if (overlay?.kind !== 'ayah' || ayahBusy) return;
    const { verseKey } = overlay;
    setAyahError(null);
    try {
      const [verse, basmala] = await Promise.all([getVerseByKey(verseKey), getVerseByKey('1:1')]);
      const text = mushafCopyText(verseKey, verse.arabicText, basmala.arabicText);
      if (!text || !(await Clipboard.setStringAsync(text))) throw new Error('not copied');
      setCopiedVerseKey(verseKey);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedVerseKey(null), COPY_CONFIRMATION_MS);
    } catch {
      setCopiedVerseKey(null);
      setAyahError(copy.actionCopyFailed);
    }
  };
  /**
   * Share: the existing Share Ayah sheet for exactly this ayah, as the ayah screens open it (getAyah, then the sheet,
   * which takes only the ayah: no emotion reaches the card). It stays selected while the sheet is open. Offline: the
   * device's own ayah (the verified local Arabic, no translation), which the sheet already shares without one.
   */
  const shareSelected = async () => {
    if (overlay?.kind !== 'ayah' || ayahBusy) return;
    setAyahBusy(true);
    setAyahError(null);
    try {
      const ayah = await getAyahForAction(overlay.verseKey);
      closeOverlay();
      setSharing(ayah);
    } catch (error) {
      setAyahError(getApiErrorMessage(error, messages.ayah.genericError));
    } finally {
      setAyahBusy(false);
    }
  };
  /**
   * Apply: this page and this ayah saved to the active ورد, read from storage now (the ورد list's own source of
   * truth, so never a stale one), through the reader's one save path (onSaveStop: page 604's Khatma rules included).
   * No active ورد: the ورد name field instead (the existing way to create one), carrying this ayah, so the ورد it
   * saves — a new one, or an existing one typed by name — takes this page and ayah as Apply would. Saved: the popup
   * closes and the ayah's medallion turns gold (the stops just saved, so at once).
   */
  const applyToWird = async () => {
    if (overlay?.kind !== 'wird' || ayahBusy) return;
    setAyahBusy(true);
    setAyahError(null);
    try {
      const [list, id] = await Promise.all([loadReadingStops(), loadActiveReadingStopId()]);
      const target = activeReadingStop(list, id);
      if (!target) {
        // The name field, carrying this ayah: the ورد it saves (new, or an existing one named) takes this page and ayah.
        setSelectedVerseKey(null);
        setOverlay({ kind: 'stopName', ayahKey: isWirdAyahOnPage(overlay.verseKey, page) ? overlay.verseKey : null });
        return;
      }
      const result = await onSaveStop(target.name, isWirdAyahOnPage(overlay.verseKey, page) ? overlay.verseKey : null);
      if (result.tone === 'info') dismissAyahPopup();
      else setAyahError(result.text);
    } catch {
      setAyahError(copy.stopSaveFailed);
    } finally {
      setAyahBusy(false);
    }
  };
  /** The voice for a new Play / Listen: the player's current (or up-next) reciter, else the Favorite Reciter. */
  // The reciter asked for, never the fallback voice heard in its place (Al-Minshawi where it has no recording).
  const listeningReciter = () => (playback.phase !== 'idle' && playback.mode !== 'single' ? playback.pendingReciterId ?? playback.preferredReciterId ?? playback.reciterId : null) ?? favoriteReciterId;
  // Following: the page turns by itself to the recited ayah's page — after any popup, sheet or the guide is closed,
  // so nothing open is ever moved from under the reader. No ورد, Khatma or last browsed page changes.
  const blockingOverlay = overlay !== null || isReflectionVisible || sharing !== null || guideVisible || isWirdOpen || reached !== null || khatmaNotice !== null || featureSheetOpen;
  // Applied while rendering (React's "adjust state when a prop changes", as for ?page= above): no extra commit.
  if (following && playingPage !== null && playingPage !== page && !blockingOverlay) {
    setAutoTurnedPage(playingPage);
    setPage(playingPage);
    setSelectedVerseKey(null);
    setZoomedAt(null);
  }
  /** Follow recitation: back to the recited page (turned to while rendering), which then turns with the recitation. */
  const followRecitation = () => {
    closeOverlay();
    setFollowing(true);
  };
  /** The top bar's headphones: recitation from the first ayah of the page shown. */
  const playPage = () => {
    closeOverlay();
    setSelectedVerseKey(null);
    audioEngine.startPage(page, listeningReciter());
  };
  /**
   * The top bar's headphones, always following the engine: shown whenever nothing is actively playing (nothing yet,
   * paused, stopped, finished, stopped by an error) and replaced by the player's chip while playing (its own Pause, the
   * Sheikh and the ayah: MushafAudioPlayer). A tap resumes a pause from its position, retries after an error, or else
   * plays from this page. Touch and hold (or the screen reader's Stop action) stops a paused recitation for good.
   */
  const audioActive = isAudioActive(playback);
  const onAudioButton = () => {
    if (audioActive) audioEngine.pause();
    else if (playback.phase === 'paused' || playback.phase === 'error') audioEngine.resume();
    else playPage();
  };
  const stopAudio = () => {
    if (playback.phase !== 'idle') audioEngine.stop();
  };
  /** An ayah's Listen: recitation from that ayah onward (the popup closes so the recited ayah's highlight shows). */
  const listenFromSelected = () => {
    if (overlay?.kind !== 'ayah') return;
    const from = positionOfVerseKey(overlay.verseKey);
    if (!from) return;
    const reciterId = listeningReciter();
    dismissAyahPopup();
    audioEngine.start(from, { mode: 'continuous', reciterId });
  };
  /** The highlighted ayah on page `n`: the reader's selection on the page being read, else the ayah being recited. */
  const highlightedOn = (n: number, isCurrent: boolean) => (isCurrent && selectedVerseKey) || (playingPage === n ? playingVerseKey : null);
  /** The Hizb holding the top of this page (its list's current row). */
  const currentHizb = HIZB_START_PAGES.filter((start) => start <= page).length;
  /** The running heads and the page number of the page being read: the lists and the page selector. */
  const pageNavigation = {
    onSurah: () => setOverlay({ kind: 'index', mode: 'surah' }),
    onJuz: () => setOverlay({ kind: 'index', mode: 'juz' }),
    onHizb: () => setOverlay({ kind: 'index', mode: 'hizb' }),
    onPageNumber: () => setOverlay({ kind: 'pageSelector' }),
    labels: { surah: copy.openSurahs, juz: copy.openJuz, hizb: copy.openHizb, page: copy.openPageSelector },
  } as const;
  /** Screen readers: next / previous page, as the retired bar's arrows were (swipes need sight). */
  const pageActions = [{ name: 'nextPage', label: copy.nextPage }, { name: 'previousPage', label: copy.previousPage }] as const;
  const onPageAction = (name: string) => {
    if (name === 'nextPage') turn(1);
    else if (name === 'previousPage') turn(-1);
  };
  /**
   * The reader's explicit save of this whole page to the ورد named `name` — the bookmark's save, also used by page
   * 604's إتمام الختمة. Never the selected ayah; an ayah only when Apply passes the one whose number was tapped
   * (`ayahKey`). The stop just saved is the one being read (saveWirdPage makes it
   * active). Only a save that took this ورد from an earlier page to 604 offers the Khatma; showing 604 never does.
   */
  const savePage = async (name: string, ayahKey: string | null = null) => {
    const result = await saveWirdPage({ name, page, ayahKey });
    setStops(result.stops);
    setActiveStopId(result.stop.id);
    if (result.reachedEnd) {
      setConfirmFailed(false);
      setReached({ stopId: result.stop.id, cycleId: result.cycleId, name: result.stop.name });
    }
    return result;
  };
  /** `ayahKey`: Apply from that ayah's number; otherwise (the ورد name field) the page alone. */
  const onSaveStop = async (name: string, ayahKey: string | null = null) => {
    try {
      // Page 604: never for a ورد whose cycle a confirmed Khatma has just restarted (checked before saving, so the
      // save itself cannot count as its progress). The field closes and the new-cycle notice explains why.
      if (page === MUSHAF_PAGE_COUNT) {
        const target = normalizeReadingStopName(name)?.toLocaleLowerCase();
        const wird = (await loadReadingData()).wirds.find((w) => w.stop.name.toLocaleLowerCase() === target);
        if (wird && restartedWithoutProgress(wird.cycle)) {
          closeOverlay();
          setKhatmaNotice('newCycle');
          return { tone: 'error' as const, text: messages.khatma.newCycleTitle };
        }
      }
      await savePage(name, ayahKey);
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
    closeOverlay();
    setIsWirdOpen(false);
    setFullScreen(next);
  }, [closeOverlay]);
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
    closeOverlay();
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
    setOverlay({ kind: 'stopName' });
  };
  /** أورادي وختماتي: create, rename, delete and follow every ورد. */
  const manageWirds = () => {
    setIsWirdOpen(false);
    router.navigate('/my-reading');
  };

  /** إتمام الختمة: records this cycle once (a repeated tap finds it already recorded), then the completion screen. */
  const onConfirmKhatma = async () => {
    // A ref, not only state: a second tap in the same frame sees it at once (state updates after the render).
    if (!reached || confirmingRef.current) return;
    confirmingRef.current = true;
    setIsConfirming(true);
    setConfirmFailed(false);
    try {
      const { record } = await confirmKhatma(reached.stopId, reached.cycleId);
      setReached(null);
      router.push({ pathname: '/khatma-complete', params: { id: record.id } });
    } catch {
      setConfirmFailed(true);
    } finally {
      confirmingRef.current = false;
      setIsConfirming(false);
    }
  };

  /**
   * Page 604's إتمام الختمة (left of the ورد name), for the ورد selected below the page — never another:
   *  - already awaiting confirmation (saved through to 604 in its recorded cycle): the confirmation sheet at once;
   *  - not yet at 604: first the bookmark's own save of this page (savePage), which, exactly as when saved by hand,
   *    opens that sheet when it takes the ورد to 604;
   *  - a cycle just restarted by a confirmed Khatma, with nothing saved in it since (its persisted, synced
   *    `startedByKhatmaId` and `savedSinceStart`): blocked — no save, no confirmation — so staying on, reopening or
   *    re-tapping page 604 can never complete it; any save of reading progress in the new cycle lifts this;
   *  - no ورد selected: asks for one; the save failing: says so; anything else (e.g. a ورد saved at 604 before
   *    Khatmas were tracked, whose own wording is in أورادي وختماتي): explains.
   * Nothing is ever recorded here: only the sheet's confirmation does (onConfirmKhatma, once). Cancelling it keeps
   * the saved page and the pending completion.
   */
  const completeKhatma = async () => {
    if (reached || confirmingRef.current || completingRef.current) return;
    completingRef.current = true;
    try {
      if (!activeStop) {
        setKhatmaNotice('noWird');
        return;
      }
      const wird = (await loadReadingData()).wirds.find((w) => w.stop.id === activeStop.id);
      if (!wird) {
        setKhatmaNotice('noWird');
        return;
      }
      if (wird.status === 'pending') {
        setConfirmFailed(false);
        setReached({ stopId: wird.stop.id, cycleId: wird.cycle.id, name: wird.stop.name });
        return;
      }
      if (restartedWithoutProgress(wird.cycle)) {
        setKhatmaNotice('newCycle');
        return;
      }
      if (wird.stop.page < MUSHAF_PAGE_COUNT) {
        const result = await savePage(wird.stop.name);
        if (result.reachedEnd) return; // savePage has opened the confirmation
      }
      setKhatmaNotice('notReady');
    } catch {
      setKhatmaNotice('saveFailed');
    } finally {
      completingRef.current = false;
    }
  };

  const stateOf = (n: number): PageState => (loadedPages[n]?.reload === reloadKey ? loadedPages[n].state : LOADING);
  const content = stateOf(page);
  const svg = svgPage61();
  const qpcShown = (state: PageState) => state.status === 'qpc' && (state.layout.page !== DEFAULT_PAGE || (fontsLoaded && !fontError));
  const showQpc = qpcShown(content);
  // Automatic, on every page and in both modes (with the larger text, candidate C): Taller wherever the whole page
  // fits (fitMushafPage falls back to Traditional otherwise). It needs the QPC lines (the Quran SVG page keeps its own
  // fixed line positions). There is no layout choice anywhere.
  const taller = showQpc;
  // The largest page that fits between the Back row and the ورد row (Normal Mode), never cropped. No tab bar on this tab.
  const fit = fitMushafPage(area, insets.bottom, fullScreen, taller);
  const { width: pageWidth, height: pageHeight } = fit.page;
  const fitKey = `${fit.viewport.width}x${fit.viewport.height}|${pageWidth}x${pageHeight}`;
  const zoomed = zoomedAt === fitKey;
  // An open ayah or ورد popup follows its ayah when the page is refitted (a rotation, a resized window): the tapped
  // point is moved with the page, which scales as one picture. Zoomed in, the point isn't known at 1×: the middle.
  const pageBox = pageBoxOnScreen({ area, insets, barHeight: BACK_BAR_HEIGHT, page: fit.page, viewportHeight: fit.viewport.height, fullScreen });
  const placedOn = useRef(pageBox);
  // Tablets: the ورد row (and page 604's links) spans the page, not the whole window, so the links stay beside the
  // page in landscape. Centred on the area as laid out now and exactly the page's width, never insets worked out from a
  // size the area may already have left (a rotation): page 604's fitted link labels must never be squeezed (Android
  // keeps a shrunk adjustsFontSizeToFit label). Phones (the page is the window's width less 6 pt): the full width.
  const wirdRowSpan = windowClassFor(area.width) === 'compact' ? null : { left: '50%' as const, marginLeft: -pageWidth / 2, right: undefined, width: pageWidth };
  // Page 604's two links, on the page number's line (the page's strip under the frame, above the ورد row): centred on
  // that line at their own size, in a band that lets every other touch through. Their touch targets reach up at most
  // 8 pt as before (never into the Quran text) and not below them: المعاني, under إتمام الختمة, stays below its measured
  // lower edge.
  const endLinks = page === MUSHAF_PAGE_COUNT && pageWidth > 0 ? (() => {
    const { pageNumber, text } = computePageLayout(pageWidth, fit.tilesDown);
    const centre = pageNumber.y + pageNumber.height / 2;
    return { band: { top: centre - END_LINK_BAND_HALF, height: 2 * END_LINK_BAND_HALF }, slopTop: Math.max(0, Math.min(8, centre - END_LINK_HALF_HEIGHT - (text.y + text.height + 2))) };
  })() : null;
  useEffect(() => {
    const before = placedOn.current;
    placedOn.current = pageBox;
    // No ayah or ورد popup open: nothing to move, and no state update (each one would redraw the pages).
    if (sameBox(before, pageBox) || (overlay?.kind !== 'ayah' && overlay?.kind !== 'wird')) return;
    setOverlay({ ...overlay, anchor: (zoomed ? null : remapAnchor(overlay.anchor, before, pageBox)) ?? middle() });
    // Only when the page's box changes; overlay, zoomed and middle() are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageBox.x, pageBox.y, pageBox.width, pageBox.height]);
  /** What a page shows: its QPC lines, page 61's Quran SVG, or neither (yet); and its first ayah (the page's heads). */
  const partsOf = (n: number, state: PageState) => {
    const qpc = qpcShown(state);
    const svgShown = n === DEFAULT_PAGE && svg && (state.status === 'svg' || (state.status === 'qpc' && !qpc));
    const first = qpc && state.status === 'qpc'
      ? (() => { const [surah, ayah] = state.layout.verseKeys[0].split(':').map(Number); return { surah, ayah }; })()
      : svg?.page.ayahs[0];
    return { qpc, svgShown, first, drawn: pageWidth > 0 && (qpc || svgShown) && first };
  };
  const drawn = partsOf(page, content).drawn;

  // The first-time guide: read whether it was seen; show it by itself once the page and its controls are drawn
  // (the Surah head registered), at the step reached before, and keep it until the user closes or finishes it.
  useEffect(() => {
    let cancelled = false;
    void loadGuideProgress().then((progress) => { if (!cancelled) setGuideProgress(progress); });
    return () => { cancelled = true; };
  }, []);
  const guideReady = Boolean(drawn) && guideTargets.names.split(',').includes('surah');
  useEffect(() => {
    // Already open (from Settings): it is not opened over itself at another step.
    if (guideVisible) guideAutoShown.current = true;
    if (guideAutoShown.current || guideProgress?.status !== 'unseen' || !guideReady) return;
    guideAutoShown.current = true;
    closeOverlay();
    setGuideStep(guideProgress.step);
    setGuideVisible(true);
  }, [guideProgress, guideReady, guideVisible, closeOverlay]);
  const showGuideStep = (step: number) => {
    setGuideStep(step);
    // Progress survives a reload: reopened at this step until the guide is closed or finished.
    if (guideProgress?.status !== 'done') void saveGuideProgress({ status: 'unseen', step });
  };
  /**
   * Close (`finished` false) or Start Reading on the last step (true). Either records the guide as seen; only finishing
   * hides the Help icon, and a guide finished before stays finished (closing it after reopening never brings the icon
   * back).
   */
  const endGuide = (finished: boolean) => {
    const done: GuideProgress = { status: 'done', finished: finished || isGuideFinished(guideProgress) };
    setGuideVisible(false);
    setGuideProgress(done);
    void saveGuideProgress(done);
  };
  const openGuide = () => {
    closeOverlay();
    setGuideStep(0);
    setGuideVisible(true);
  };
  // Each step's own text (mushaf/mushafGuide.ts), in the guide's order.
  const guideTexts = GUIDE_STEPS.map((step) => copy[step.text]);
  const iconColor = (dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light).icon;
  return (
    <GestureHandlerRootView style={[styles.reader, { backgroundColor: MUSHAF_BACKGROUNDS[appearance.background].paper, paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
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
        {/* The audio player while something plays (any mode): a chip in this bar, never over the page. */}
        <View testID="mushaf-audio-slot" style={styles.barMiddle} pointerEvents="box-none">
          <MushafAudioPlayer
            dark={dark}
            rtl={rtl}
            copy={messages.audio}
            following={following}
            onFollow={followRecitation}
            panelTop={insets.top + BACK_BAR_HEIGHT}
          />
        </View>
        <View style={styles.barEnd}>
        {/* The headphones (onAudioButton): whenever nothing is actively playing, in both modes. Playing: the chip instead. */}
        {!audioActive && (
          <Pressable
            testID="mushaf-play-page"
            accessibilityRole="button"
            accessibilityLabel={playback.phase === 'paused' ? messages.audio.play : messages.audio.playPage}
            accessibilityHint={playback.phase !== 'idle' ? messages.audio.stopHint : undefined}
            accessibilityActions={playback.phase !== 'idle' ? [{ name: 'stop', label: messages.audio.stop }] : undefined}
            onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === 'stop') stopAudio(); }}
            onPress={onAudioButton}
            onLongPress={playback.phase !== 'idle' ? stopAudio : undefined}
            hitSlop={{ top: 44 - BACK_BAR_HEIGHT, bottom: 0, left: 0, right: 0 }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <Headphones testID="mushaf-audio-idle" size={21} color={iconColor} />
          </Pressable>
        )}
        {/*
          Help: the first-time guide again, at its first step. Normal Mode only (full screen keeps just the page and
          Collapse), and only until the guide has been finished: then Settings → Quran → Mushaf Guide reopens it. Not
          shown while the saved state is still being read, so a finished guide's icon never flashes.
        */}
        {!fullScreen && guideProgress !== null && !isGuideFinished(guideProgress) && (
          <Pressable
            testID="mushaf-guide-open"
            accessibilityRole="button"
            accessibilityLabel={copy.guideHelp}
            onPress={openGuide}
            hitSlop={{ top: 44 - BACK_BAR_HEIGHT, bottom: 0, left: 0, right: 0 }}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
            <CircleHelp size={21} color={iconColor} />
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
          {/* The next action: inward arrows to collapse (Minimize2), outward to expand (Maximize2). */}
          {fullScreen ? <Minimize2 size={22} color={iconColor} /> : <Maximize2 size={22} color={iconColor} />}
        </Pressable>
        </View>
      </View>

      <View
        testID="mushaf-page-area"
        style={styles.pageArea}
        onLayout={(event) => areaSettler.measure({ width: Math.floor(event.nativeEvent.layout.width), height: Math.floor(event.nativeEvent.layout.height) })}>
        {pageWidth > 0 && (
          <GuideTargetsProvider register={registerGuideTarget}>
          <MushafZoomView ref={zoomView} viewport={fit.viewport} page={fit.page} centered={fullScreen} zoomable={Boolean(drawn)} onSwipe={turn}
            current={page}
            lastPage={MUSHAF_PAGE_COUNT}
            onSwipeDown={fullScreen && !isReflectionVisible ? () => switchReadingMode(false) : undefined}
            swipeDownFromY={insets.top + SWIPE_DOWN_TOP_GUARD}
            onDoubleTap={onDoubleTap}
            onZoomChange={(next) => setZoomedAt(next ? fitKey : null)}
            renderPage={(n, isCurrent) => {
              const state = isCurrent ? content : stateOf(n);
              const parts = partsOf(n, state);
              return parts.drawn ? (
                <MushafPageView
                  pageNumber={n}
                  firstAyah={parts.first!}
                  width={pageWidth}
                  tilesDown={fit.tilesDown === BORDER_TILES_DOWN ? undefined : fit.tilesDown}
                  hizbLabels={hizbLabelsForPage(n)}
                  openingOrnament={parts.qpc && n <= 2}
                  openingDecoration={decorations.opening}
                  headerFontFamily={headerFontLoaded ? MUSHAF_HEADER_FONT_FAMILY : undefined}
                  paperColor={MUSHAF_BACKGROUNDS[appearance.background].paper}
                  headerColor={furniture.header}
                  borderInks={MUSHAF_BORDER_STYLES[appearance.border ?? 'original'].inks}
                  navigation={isCurrent ? pageNavigation : undefined}
                  renderText={(textArea, { printedLinePitch }) => (parts.qpc && state.status === 'qpc' ? (
                    <QpcV1PageText
                      key={`qpc-${n}-${textArea.width}`}
                      layout={state.layout}
                      width={textArea.width}
                      height={textArea.height}
                      selectedVerseKey={highlightedOn(n, isCurrent)}
                      onSelectVerse={isCurrent ? selectVerse : ignoreVerse}
                      onPressMarker={isCurrent ? pressMarker : undefined}
                      guideTargets={isCurrent}
                      accessibilityLabel={`${copy.pageLabel} ${n}`}
                      accessibilityHint={copy.tapHint}
                      accessibilityActions={isCurrent ? pageActions : undefined}
                      onAccessibilityAction={isCurrent ? onPageAction : undefined}
                      markerStyle={appearance.markers}
                      printedPitch={printedLinePitch}
                      boxMarginEm={fullScreen ? 0 : QCF_V1_NORMAL_BOX_MARGIN_EM}
                      basmalaFontFamily={state.basmalaFont}
                      headingFontFamily={headerFontLoaded ? MUSHAF_HEADER_FONT_FAMILY : undefined}
                      headingColor={furniture.header}
                      ink={ink}
                      highlight={highlight}
                      headingDecoration={decorations.heading}
                      wirdAyahKey={wirdAyahOnPage(activeStop, n)}
                      wirdMarker={MUSHAF_WIRD_MARKER[appearance.background]}
                    />
                  ) : (
                    <MushafSvgText
                      page={svg!.page}
                      svg={ink === MUSHAF_INKS.original.color ? svg!.svg : inkedSvg(svg!.svg, ink)}
                      highlight={highlight}
                      area={textArea}
                      selectedVerseKey={highlightedOn(n, isCurrent)}
                      onSelectVerse={isCurrent ? selectVerse : ignoreVerse}
                      accessibilityLabel={`${copy.pageLabel} ${n}`}
                      accessibilityHint={copy.tapHint}
                      accessibilityActions={isCurrent ? pageActions : undefined}
                      onAccessibilityAction={isCurrent ? onPageAction : undefined}
                    />
                  ))}
                />
              ) : state.status === 'missing' || state.status === 'unavailable' ? (
                <View testID={isCurrent ? 'mushaf-page-missing' : undefined} style={[styles.missingPage, { width: pageWidth, height: pageHeight, backgroundColor: MUSHAF_BACKGROUNDS[appearance.background].paper }]}>
                  {/* The page actions here too: a screen reader can turn past a page that isn't downloaded. */}
                  <Text
                    accessibilityActions={isCurrent ? pageActions : undefined}
                    onAccessibilityAction={isCurrent ? (event) => onPageAction(event.nativeEvent.actionName) : undefined}
                    style={[styles.missingNumber, { color: furniture.header }]}>
                    {String(n)}
                  </Text>
                  <Text style={[styles.missingText, { color: furniture.header }]}>
                    {state.status === 'missing' ? copy.pageNotDownloaded : copy.pageUnavailable}
                  </Text>
                  {isCurrent && <OfflineMushafPanel />}
                </View>
              ) : (
                <View
                  style={{ height: pageHeight }}
                  accessibilityLabel={copy.qpcLoading}
                  accessibilityActions={isCurrent ? pageActions : undefined}
                  onAccessibilityAction={isCurrent ? (event) => onPageAction(event.nativeEvent.actionName) : undefined}
                />
              );
            }}
          />
          </GuideTargetsProvider>
        )}
        {pageWidth > 0 && !fullScreen && (
          <View
            testID="mushaf-wird-row"
            pointerEvents={zoomed ? 'none' : 'box-none'}
            style={[styles.wirdRow, wirdRowSpan, { top: pageHeight, height: fit.viewport.height - pageHeight, opacity: zoomed ? 0 : 1 }]}>
            <MushafWirdSelector
              labels={{
                choose: copy.wirdChoose,
                selectorLabel: copy.wirdSelectorLabel,
                selectorHint: copy.wirdSelectorHint,
                add: copy.wirdAdd,
                addNew: copy.wirdNew,
                close: copy.wirdClose,
                page: copy.pageShort,
                manage: messages.myReading.title,
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
              onManage={manageWirds}
              anchorBottom={insets.bottom + PAGE_PANEL_GAP + (fit.viewport.height - pageHeight + WIRD_PILL_HEIGHT) / 2}
              // Page 604: the name keeps the middle of its row, beside المعاني, under إتمام الختمة and the du'a (each at
              // most END_LINK_MAX_WIDTH), never reaching any of them.
              // The feature buttons' room beside it, where that is narrower (only a long name is shortened sooner).
              pillMaxWidth={featurePillRoom !== null
                ? Math.min(featurePillRoom, (page === MUSHAF_PAGE_COUNT ? 0.3 : 0.72) * (wirdRowSpan ? pageWidth : area.width))
                : page === MUSHAF_PAGE_COUNT ? PAGE_604_PILL_MAX_WIDTH : undefined}
              onPillLayout={setWirdPill}
            />
          </View>
        )}
        {/*
          Page 604 only, on the page number's line above the ورد row, in every language (it never mirrors) and always in
          Standard Arabic: on the left إتمام الختمة (above المعاني), on the right the optional دعاء ختم القرآن (its own
          screen, not a page 605, once a verified text is approved). The same link design; each at most
          END_LINK_MAX_WIDTH of the row's width, one line, its text shrinking slightly rather than clipping.
        */}
        {endLinks && !fullScreen && (
          <View
            testID="mushaf-604-links"
            pointerEvents={zoomed ? 'none' : 'box-none'}
            style={[styles.wirdRow, wirdRowSpan, { ...endLinks.band, opacity: zoomed ? 0 : 1 }]}>
            {KHATM_DUA && (
              <Pressable
                testID="mushaf-khatm-dua"
                accessibilityRole="button"
                accessibilityLabel={messages.khatmDua.open}
                onPress={() => router.push('/khatm-dua')}
                hitSlop={{ top: endLinks.slopTop, bottom: 0, left: 8, right: 8 }}
                style={({ pressed }) => [styles.duaLink, styles.endLink, { right: spacing.md }, pressed && styles.pressed]}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.duaLinkText, styles.textRight, { color: iconColor }]}>{messages.khatmDua.open}</Text>
              </Pressable>
            )}
            <Pressable
              testID="mushaf-complete-khatma"
              accessibilityRole="button"
              accessibilityLabel={messages.khatma.completeAction}
              onPress={() => void completeKhatma()}
              hitSlop={{ top: endLinks.slopTop, bottom: 0, left: 8, right: 8 }}
              onLayout={(event) => setEndLinkBottom(endLinks.band.top + event.nativeEvent.layout.y + event.nativeEvent.layout.height)}
              style={({ pressed }) => [styles.duaLink, styles.endLink, { left: spacing.md }, pressed && styles.pressed]}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.duaLinkText, styles.textLeft, { color: iconColor }]}>{messages.khatma.completeAction}</Text>
            </Pressable>
          </View>
        )}
        {/*
          The feature buttons, Meanings (المعاني) and Surah Preview (عن السورة, where a Surah begins), and their sheets:
          Normal Mode only. In full screen they are not mounted at all (no button, sheet or touch target), and switching
          to full screen closes an open sheet. One row beside the ورد pill, or beneath it where there is no room (page
          604: under إتمام الختمة and the du'a). Nothing of the page moves. Hidden while zoomed, before the page is drawn
          and while another popup is open.
        */}
        {pageWidth > 0 && !fullScreen && (
          <MushafFeatureLayer
            page={page}
            areaWidth={area.width}
            pageWidth={pageWidth}
            tilesDown={fit.tilesDown}
            showControls={!zoomed && Boolean(drawn) && overlay === null}
            dark={dark}
            wirdPill={wirdPill}
            rowLeft={wirdRowSpan ? (area.width - pageWidth) / 2 : 0}
            rowTop={pageHeight}
            // The ورد row is centred on the area on every device (phones: the full width; tablets: the page's).
            rowCentre={area.width / 2}
            minTop={page === MUSHAF_PAGE_COUNT ? endLinkBottom : pageHeight}
            pillText={activeStop ? 'text' : 'accent'}
            onOpenChange={setFeatureSheetOpen}
            onPillRoom={setFeaturePillRoom}
          />
        )}
      </View>

      {/* The ورد list's Add: the ورد name field (kept from the retired bar), docked at the bottom over the ورد row. */}
      <MushafStopNameField
        visible={overlay?.kind === 'stopName'}
        labels={{ stopName: copy.stopNameLabel, confirmStop: copy.confirmStop }}
        dark={dark}
        bottomInset={insets.bottom}
        defaultStopName={activeStop?.name}
        // From an ayah's number: that ayah too; from the ورد list's Add: the page alone, as before.
        onSave={(name) => onSaveStop(name, overlay?.kind === 'stopName' ? overlay.ayahKey ?? null : null)}
        onClose={closeOverlay}
      />

      {/* The running heads' Surah name, juz' and Hizb label: their searchable lists. */}
      <MushafIndexSheet
        mode={overlay?.kind === 'index' ? overlay.mode : null}
        labels={{
          close: copy.wirdClose,
          page: copy.pageShort,
          noResults: copy.surahNoResults,
          surahTitle: copy.navSurahTitle,
          juzTitle: copy.navJuzTitle,
          hizbTitle: copy.navHizbTitle,
          surahSearch: copy.surahSearchPlaceholder,
          juzSearch: copy.juzSearchPlaceholder,
          hizbSearch: copy.hizbSearchPlaceholder,
          juzName: copy.juzName,
          hizbName: copy.hizbName,
        }}
        dark={dark}
        rtl={rtl}
        formatNumber={formatNumber}
        current={overlay?.kind === 'index' ? (overlay.mode === 'surah' ? pageInfo(page)?.surah : overlay.mode === 'juz' ? pageInfo(page)?.juz : currentHizb) : undefined}
        onSelectPage={goTo}
        onClose={closeOverlay}
      />

      {/* The page number under the frame: the compact page selector. */}
      {/* The first-time guide (mushaf/mushafGuide.ts): over everything, only its own buttons close it. */}
      <MushafGuide
        visible={guideVisible}
        step={guideStep}
        total={GUIDE_STEPS.length}
        text={guideTexts[guideStep]}
        labels={{ next: copy.guideNext, back: copy.guideBack, close: copy.guideClose, start: copy.guideStart, stepOf: copy.guideStepOf, notOnPage: copy.guideNotOnPage, reopenHint: copy.guideReopenHint }}
        dark={dark}
        rtl={rtl}
        direction={{ writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }}
        safe={{ top: insets.top, bottom: insets.bottom }}
        getTarget={() => guideTargetViews.current.get(GUIDE_STEPS[guideStep].target)}
        measureKey={`${guideTargets.changes}|${page}|${fullScreen}|${zoomed}|${pageWidth}`}
        onNext={() => showGuideStep(Math.min(GUIDE_STEPS.length - 1, guideStep + 1))}
        onBack={() => showGuideStep(Math.max(0, guideStep - 1))}
        onClose={() => endGuide(false)}
        onFinish={() => endGuide(true)}
      />

      <MushafPageSelector
        visible={overlay?.kind === 'pageSelector'}
        currentPage={page}
        labels={{ pageSlider: copy.pageSlider, goToSelected: copy.goToSelected, editPage: copy.editPage, pageOutOfRange: copy.pageOutOfRange, close: copy.wirdClose, go: copy.goToPageShort, keyboardDone: copy.keyboardDone }}
        dark={dark}
        bottomInset={insets.bottom}
        formatNumber={formatNumber}
        surahName={(surah) => (rtl ? getSurahName(surah).nameArabic : getSurahName(surah).nameEnglish)}
        juzLabel={(juz) => fill(copy.juzName, { n: formatNumber(juz) })}
        onGo={goTo}
        onClose={closeOverlay}
      />

      {/* An ayah's words: Reflection, Save, Copy, Share. */}
      <MushafAyahActions
        anchor={overlay?.kind === 'ayah' ? overlay.anchor : null}
        dark={dark}
        rtl={rtl}
        saved={overlay?.kind === 'ayah' && isFavorite(overlay.verseKey)}
        copied={overlay?.kind === 'ayah' && copiedVerseKey === overlay.verseKey}
        busy={ayahBusy}
        error={overlay?.kind === 'ayah' ? ayahError : null}
        labels={{
          reflection: copy.actionReflection,
          save: copy.actionSave,
          saved: copy.actionSaved,
          saveHint: messages.favoriteButton.saveLabel,
          removeHint: messages.favoriteButton.removeLabel,
          copy: copy.actionCopy,
          copied: copy.actionCopied,
          share: messages.ayah.share,
          shareHint: messages.ayah.shareAyah,
          listen: messages.audio.listen,
          listenHint: messages.audio.listenHint,
          close: copy.wirdClose,
        }}
        onListen={listenFromSelected}
        onReflect={openReflection}
        onToggleSave={() => void toggleSaved()}
        onCopy={() => void copySelected()}
        onShare={() => void shareSelected()}
        onClose={dismissAyahPopup}
      />

      {/* An ayah's number: Apply to the active ورد. */}
      <MushafWirdApply
        anchor={overlay?.kind === 'wird' ? overlay.anchor : null}
        dark={dark}
        rtl={rtl}
        label={activeStop ? applyToWirdLabel(activeStop.name, copy) : copy.wirdNew}
        busy={ayahBusy}
        error={overlay?.kind === 'wird' ? ayahError : null}
        closeLabel={copy.wirdClose}
        onApply={() => void applyToWird()}
        onClose={dismissAyahPopup}
      />

      <ReflectionSheet
        visible={isReflectionVisible}
        verseKey={selectedVerseKey}
        onClose={() => setIsReflectionVisible(false)}
        // In the reader's own window colours, light or dark with the page.
        mushaf={{ dark }}
      />

      {/* Share: the ayah screens' own sheet, unchanged. */}
      <ShareAyahSheet visible={sharing !== null} ayah={sharing} onClose={() => setSharing(null)} />

      <KhatmaReachedSheet
        visible={reached !== null}
        wirdName={reached?.name ?? ''}
        labels={{ title: messages.khatma.reachedTitle, confirm: messages.khatma.confirm, notNow: messages.khatma.notNow, failed: messages.khatma.failed }}
        busy={isConfirming}
        failed={confirmFailed}
        onConfirm={() => void onConfirmKhatma()}
        // ليس الآن: nothing is counted; the completion stays pending in أورادي وختماتي.
        onNotNow={() => setReached(null)}
      />

      {/* إتمام الختمة on page 604 when it cannot open the confirmation: why. Nothing has been recorded. */}
      <ConfirmSheet
        visible={khatmaNotice !== null}
        testID={`mushaf-khatma-${khatmaNotice ?? 'notice'}`}
        title={khatmaNotice === 'noWird' ? messages.khatma.noWirdTitle : khatmaNotice === 'newCycle' ? messages.khatma.newCycleTitle : khatmaNotice === 'saveFailed' ? messages.khatma.saveFailedTitle : messages.khatma.notReadyTitle}
        body={khatmaNotice === 'noWird' ? messages.khatma.noWirdBody : khatmaNotice === 'newCycle' ? messages.khatma.newCycleBody : khatmaNotice === 'saveFailed' ? messages.khatma.saveFailedBody : messages.khatma.notReadyBody}
        cancelLabel={messages.khatma.notReadyOk}
        onCancel={() => setKhatmaNotice(null)}
      />
    </GestureHandlerRootView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  // Full-screen reader: the page starts right under the status bar.
  reader: {
    backgroundColor: colors.background,
    flex: 1,
  },
  /** The audio chip, centred in what Back and the right-hand icons leave. */
  barMiddle: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingHorizontal: 4,
  },
  /** Help and Expand / Collapse, together on the right. */
  barEnd: {
    alignItems: 'center',
    flexDirection: 'row',
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
  // Page 604's two links share the row with the centred ورد name (PAGE_604_PILL_MAX_WIDTH): side by side they never meet.
  endLink: {
    maxWidth: END_LINK_MAX_WIDTH,
  },
  textLeft: {
    textAlign: 'left',
  },
  textRight: {
    textAlign: 'right',
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
  panelHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  panelTitle: {
    flex: 1,
    gap: 2,
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
  pressed: {
    opacity: 0.78,
  },
});
