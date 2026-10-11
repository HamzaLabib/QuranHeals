import { useFonts } from 'expo-font';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ArrowRight, BookmarkPlus, Pencil, PenLine, Trash2, X } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MushafPageView } from '@/components/MushafPageView';
import { MushafSvgText } from '@/components/MushafSvgText';
import { QpcV1PageText } from '@/components/QpcV1PageText';
import { ReflectionSheet } from '@/components/ReflectionSheet';
import { MUSHAF_PAPER } from '@/constants/mushafTheme';
import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { MUSHAF_BACKGROUNDS, MUSHAF_BORDER_STYLES, MUSHAF_INKS, MUSHAF_PAGE_FURNITURE, resolveMushafAppearance } from '@/mushaf/appearance';
import { HAFS_KFQC_PAGE_061 } from '@/mushaf/generated/hafsKfqcPage061';
import { parseMushafPage, tintAyahMarkers, tintSvgInk } from '@/mushaf/mushafPage';
import { MUSHAF_HEADER_FONT_FAMILY, MUSHAF_HEADER_FONTS } from '@/mushaf/headerFonts';
import { QPC_V1_FONTS } from '@/mushaf/qpcV1Fonts';
import { offlineMushaf, OfflineMushafError, type DownloadProgress, type OfflineStatus } from '@/mushaf/offline';
import { checkAgainstTanzil, loadQpcV1PageLayout, type QpcV1PageLayout } from '@/mushaf/qpcV1Layout';
import {
  loadReadingStops,
  READING_STOP_NAME_MAX_LENGTH,
  ReadingStopError,
  removeReadingStop,
  renameReadingStop,
  saveReadingStop,
  type ReadingStop,
} from '@/mushaf/readingStops';
import { getVerseByKey } from '@/services/quran';
import { usePalette, useThemedStyles, useThemeName } from '@/theme/useTheme';
import { devLog } from '@/utils/devLog';
import { formatAyahReference } from '@/utils/ayahReference';

/**
 * Mushaf prototype, page 61 only: ayah selection, the existing Add
 * Reflection sheet, and named page-based reading stops. Isolated: nothing
 * links here yet (open it as /mushaf). No 604-page navigation, Khatma or
 * statistics.
 *
 * Two interchangeable renderers inside the same measured page:
 *  - QPC V1 (default): the 1405 AH Madani print's QCF V1 page font (bundled
 *    for this page) and its line layout from our backend (Quran Foundation
 *    Content API). Used only once the font is loaded and the layout has
 *    passed the check against the verified Tanzil text.
 *  - Quran SVG (fallback, and selectable): quran-ws/quran-svg v1.1.1.
 */

type Renderer = 'qpc-v1' | 'svg';
type QpcState =
  | { status: 'loading' }
  | { status: 'ready'; layout: QpcV1PageLayout }
  | { status: 'unavailable' };

// Parsed and validated once; the page is bundled, never fetched.
const PAGE_SOURCE = HAFS_KFQC_PAGE_061;
let pageCache: { page: ReturnType<typeof parseMushafPage>; svg: string } | null | undefined;
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

function loadPage() {
  if (pageCache === undefined) {
    try {
      pageCache = { page: parseMushafPage(PAGE_SOURCE), svg: tintAyahMarkers(PAGE_SOURCE.svg, MUSHAF_PAPER.marker) };
    } catch {
      pageCache = null;
    }
  }
  return pageCache;
}

export default function MushafScreen() {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.mushaf;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const BackIcon = isRtl ? ArrowRight : ArrowLeft;
  // Paper, medallions and ink: the defaults in mushaf/appearance.ts, or a
  // preset named in the URL for previews (?background=warm&markers=traditional).
  // The page follows the app's Appearance preference (System, Light or Dark; Light by default).
  const appearance = resolveMushafAppearance(useLocalSearchParams(), useThemeName());
  const furniture = MUSHAF_PAGE_FURNITURE[appearance.background];
  const ink = MUSHAF_INKS[appearance.ink].color;
  const highlight = { color: furniture.highlight, opacity: furniture.highlightOpacity };
  // Measured, not the window size: right on tablets, split screen and web.
  const [availableWidth, setAvailableWidth] = useState(0);
  const loaded = loadPage();
  const [fontsLoaded, fontError] = useFonts(QPC_V1_FONTS);
  // Separate, so the heads' font can never hold back or disable the Quran text.
  const [headerFontLoaded] = useFonts(MUSHAF_HEADER_FONTS);
  const [renderer, setRenderer] = useState<Renderer>('qpc-v1');
  const [qpc, setQpc] = useState<QpcState>({ status: 'loading' });

  const [selectedVerseKey, setSelectedVerseKey] = useState<string | null>(null);
  const [isReflectionVisible, setIsReflectionVisible] = useState(false);
  const [stops, setStops] = useState<ReadingStop[]>([]);
  const [stopName, setStopName] = useState('');
  const [stopStatus, setStopStatus] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Inline rename of one stop at a time.
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadReadingStops().then((loadedStops) => {
      if (!cancelled) setStops(loadedStops);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The 1405 layout: from the offline Mushaf when it is installed (no network
  // needed), otherwise fetched (or a still-valid cached copy); either way
  // checked against the verified Tanzil text before it may be drawn.
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const startedAt = Date.now();
    void (async () => {
      try {
        const offline = await offlineMushaf.readPage(loaded.page.page).catch(() => null);
        const layout = offline ?? await loadQpcV1PageLayout(loaded.page.page);
        const expected = loaded.page.ayahs.map((ayah) => ayah.verseKey);
        const tanzil: Record<string, string> = {};
        for (const verseKey of expected) tanzil[verseKey] = (await getVerseByKey(verseKey)).arabicText;
        const check = checkAgainstTanzil(layout, expected, tanzil);
        devLog('mushaf', 'qpc-v1 layout', { source: offline ? 'offline' : 'api', ms: Date.now() - startedAt, ok: check.ok, problems: check.problems });
        if (!cancelled) setQpc(check.ok ? { status: 'ready', layout } : { status: 'unavailable' });
      } catch {
        if (!cancelled) setQpc({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const saveStop = useCallback(async () => {
    if (!loaded || isSaving) return;
    setIsSaving(true);
    try {
      // The whole page — never the selected ayah.
      setStops(await saveReadingStop({ name: stopName, page: loaded.page.page }));
      setStopName('');
      setStopStatus({ tone: 'info', text: copy.stopSaved });
    } catch (error) {
      const kind = error instanceof ReadingStopError ? error.kind : null;
      setStopStatus({
        tone: 'error',
        text: kind === 'invalid_name' ? copy.stopNameInvalid : kind === 'too_many' ? copy.tooManyStops : copy.stopSaveFailed,
      });
    } finally {
      setIsSaving(false);
    }
  }, [loaded, isSaving, stopName, copy]);

  const removeStop = async (id: string) => {
    try {
      setStops(await removeReadingStop(id));
    } catch {
      setStopStatus({ tone: 'error', text: copy.stopSaveFailed });
    }
  };

  const saveRename = async () => {
    if (!editing) return;
    try {
      setStops(await renameReadingStop(editing.id, editing.name));
      setEditing(null);
      setStopStatus({ tone: 'info', text: copy.stopRenamed });
    } catch (error) {
      const kind = error instanceof ReadingStopError ? error.kind : null;
      setStopStatus({
        tone: 'error',
        text: kind === 'invalid_name' ? copy.stopNameInvalid : kind === 'name_taken' ? copy.stopNameTaken : copy.stopSaveFailed,
      });
    }
  };

  const pageWidth = Math.min(availableWidth, 520);
  const showQpc = renderer === 'qpc-v1' && fontsLoaded && !fontError && qpc.status === 'ready';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.header, isRtl && styles.rowRtl]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.ayah.goBack}
            onPress={goBack}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
            <BackIcon size={22} color={colors.icon} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={[styles.title, direction]}>{copy.title}</Text>
            <Text style={[styles.subtitle, direction]}>{copy.prototypeNote}</Text>
          </View>
        </View>

        {!loaded ? (
          <Text style={[styles.errorText, direction]}>{copy.pageLoadError}</Text>
        ) : (
          <>
            <Text style={[styles.hint, direction]}>{copy.tapHint}</Text>
            <Text style={[styles.label, direction]}>{copy.renderer}</Text>
            <View style={[styles.segmented, isRtl && styles.rowRtl]}>
              {(['qpc-v1', 'svg'] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityLabel={option === 'qpc-v1' ? copy.rendererQpc : copy.rendererSvg}
                  accessibilityState={{ selected: renderer === option }}
                  onPress={() => setRenderer(option)}
                  style={({ pressed }) => [styles.segment, renderer === option && styles.segmentSelected, pressed && styles.pressed]}>
                  <Text style={[styles.segmentText, renderer === option && styles.segmentTextSelected]}>
                    {option === 'qpc-v1' ? copy.rendererQpc : copy.rendererSvg}
                  </Text>
                </Pressable>
              ))}
            </View>
            {renderer === 'qpc-v1' && !showQpc && (
              <Text accessibilityLiveRegion="polite" style={[styles.muted, direction]}>
                {qpc.status === 'unavailable' || fontError ? copy.qpcUnavailable : copy.qpcLoading}
              </Text>
            )}
            <View testID="mushaf-page-area" onLayout={(event) => setAvailableWidth(Math.floor(event.nativeEvent.layout.width))}>
              {pageWidth > 0 && (
                <MushafPageView
                  pageNumber={loaded.page.page}
                  firstAyah={loaded.page.ayahs[0]}
                  width={pageWidth}
                  headerFontFamily={headerFontLoaded ? MUSHAF_HEADER_FONT_FAMILY : undefined}
                  paperColor={MUSHAF_BACKGROUNDS[appearance.background].paper}
                  headerColor={furniture.header}
                  borderInks={MUSHAF_BORDER_STYLES[appearance.border ?? 'original'].inks}
                  renderText={(area) => (showQpc && qpc.status === 'ready' ? (
                    <QpcV1PageText
                      key={`qpc-${area.width}`}
                      layout={qpc.layout}
                      width={area.width}
                      height={area.height}
                      selectedVerseKey={selectedVerseKey}
                      onSelectVerse={setSelectedVerseKey}
                      accessibilityLabel={`${copy.pageLabel} ${loaded.page.page}`}
                      accessibilityHint={copy.tapHint}
                      markerStyle={appearance.markers}
                      ink={ink}
                      highlight={highlight}
                    />
                  ) : (
                    <MushafSvgText
                      page={loaded.page}
                      svg={ink === MUSHAF_INKS.original.color ? loaded.svg : inkedSvg(loaded.svg, ink)}
                      highlight={highlight}
                      area={area}
                      selectedVerseKey={selectedVerseKey}
                      onSelectVerse={setSelectedVerseKey}
                      accessibilityLabel={`${copy.pageLabel} ${loaded.page.page}`}
                      accessibilityHint={copy.tapHint}
                    />
                  ))}
                />
              )}
            </View>
            <Text style={styles.credit}>{showQpc ? copy.qpcCredit : copy.artworkCredit}</Text>

            {selectedVerseKey && (
              <View style={styles.panel} accessibilityLiveRegion="polite">
                <View style={[styles.panelHeader, isRtl && styles.rowRtl]}>
                  <View style={styles.panelTitle}>
                    <Text style={[styles.label, direction]}>{copy.selectedAyah}</Text>
                    <Text style={styles.reference}>{formatAyahReference(...(selectedVerseKey.split(':').map(Number) as [number, number]))}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.clearSelection}
                    onPress={() => setSelectedVerseKey(null)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
                    <X size={18} color={colors.icon} />
                  </Pressable>
                </View>
                {/* The existing Add Reflection action and sheet, for exactly this ayah. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={messages.reflection.writeAction}
                  onPress={() => setIsReflectionVisible(true)}
                  style={({ pressed }) => [styles.primaryButton, isRtl && styles.rowRtl, pressed && styles.pressed]}>
                  <PenLine size={18} color={colors.onPrimaryButton} />
                  <Text style={styles.primaryButtonText}>{messages.reflection.writeAction}</Text>
                </Pressable>
              </View>
            )}

            <View style={styles.panel}>
              <Text style={[styles.label, direction]}>{copy.readingStops}</Text>
              <TextInput
                value={stopName}
                onChangeText={setStopName}
                maxLength={READING_STOP_NAME_MAX_LENGTH}
                placeholder={copy.stopNameLabel}
                placeholderTextColor={colors.placeholder}
                accessibilityLabel={copy.stopNameLabel}
                returnKeyType="done"
                onSubmitEditing={() => void saveStop()}
                style={[styles.input, direction]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.saveStop}
                accessibilityState={{ disabled: isSaving }}
                disabled={isSaving}
                onPress={() => void saveStop()}
                style={({ pressed }) => [styles.secondaryButton, isRtl && styles.rowRtl, isSaving && styles.disabled, pressed && styles.pressed]}>
                <BookmarkPlus size={18} color={colors.textPrimary} />
                <Text style={styles.secondaryButtonText}>{copy.saveStop}</Text>
              </Pressable>
              {stopStatus && (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[styles.status, direction, stopStatus.tone === 'error' && styles.statusError]}>
                  {stopStatus.text}
                </Text>
              )}

              {stops.length === 0 ? (
                <Text style={[styles.muted, direction]}>{copy.noStops}</Text>
              ) : (
                stops.map((stop) => editing?.id === stop.id ? (
                  <View key={stop.id} style={styles.renameRow}>
                    <TextInput
                      value={editing.name}
                      onChangeText={(name) => setEditing({ id: stop.id, name })}
                      maxLength={READING_STOP_NAME_MAX_LENGTH}
                      autoFocus
                      accessibilityLabel={`${copy.renameStop}: ${stop.name}`}
                      returnKeyType="done"
                      onSubmitEditing={() => void saveRename()}
                      style={[styles.input, direction]}
                    />
                    <View style={[styles.renameActions, isRtl && styles.rowRtl]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={copy.saveName}
                        onPress={() => void saveRename()}
                        style={({ pressed }) => [styles.secondaryButton, styles.flex, pressed && styles.pressed]}>
                        <Text style={styles.secondaryButtonText}>{copy.saveName}</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={copy.cancelRename}
                        onPress={() => setEditing(null)}
                        style={({ pressed }) => [styles.secondaryButton, styles.flex, pressed && styles.pressed]}>
                        <Text style={styles.secondaryButtonText}>{copy.cancelRename}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : (
                  <View key={stop.id} style={[styles.stopRow, isRtl && styles.rowRtl]}>
                    <View style={styles.stopText}>
                      <Text style={[styles.stopName, direction]}>{stop.name}</Text>
                      <Text style={[styles.muted, direction]}>{`${copy.page} ${stop.page}`}</Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${copy.renameStop}: ${stop.name}`}
                      onPress={() => { setEditing({ id: stop.id, name: stop.name }); setStopStatus(null); }}
                      hitSlop={8}
                      style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
                      <Pencil size={17} color={colors.icon} />
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${copy.removeStop}: ${stop.name}`}
                      onPress={() => void removeStop(stop.id)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.smallIconButton, pressed && styles.pressed]}>
                      <Trash2 size={17} color={colors.danger} />
                    </Pressable>
                  </View>
                ))
              )}
            </View>
            <OfflineMushafPanel />
          </>
        )}
      </ScrollView>

      <ReflectionSheet
        visible={isReflectionVisible}
        verseKey={selectedVerseKey}
        onClose={() => setIsReflectionVisible(false)}
      />
    </SafeAreaView>
  );
}

/**
 * "Download Mushaf for offline reading": all 604 pages' layout (not the page
 * fonts yet), with progress, cancel (a later download continues where it
 * stopped), update check and removal. See mushaf/offline/offlineMushaf.ts.
 */
function OfflineMushafPanel() {
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
  credit: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
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
