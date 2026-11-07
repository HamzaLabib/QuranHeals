import { useLocalSearchParams } from 'expo-router';
import { ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TafsirEditionSelector } from '@/components/TafsirEditionSelector';
import { pageHeaderText, radii, spacing, typography, type Palette } from '@/constants/theme';
import { fill } from '@/localization/fill';
import { isRtlLocale } from '@/localization/locales';
import { computeQuranLineHeight } from '@/localization/quranFontSizePreference';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranFontSizePreference } from '@/localization/useQuranFontSizePreference';
import { ayahCopyText } from '@/mushaf/ayahCopyText';
import { getSurahVerses, getVerseByKey } from '@/services/quran';
import { getSurahName } from '@/services/surahNames';
import type { TafsirDataset } from '@/tafsir/dataset';
import { DEFAULT_TAFSIR_EDITION, type TafsirEditionId } from '@/tafsir/editions';
import { tafsirLabels } from '@/tafsir/labels';
import { loadTafsirEditionPreference, saveTafsirEditionPreference } from '@/tafsir/preference';
import { anchorAyahOf, buildSurahRows, commentaryIndexOf, earlierWindowStart, rowIndexOfAyah, type TafsirRow } from '@/tafsir/surahItems';
import { useTafsirLibrary } from '@/tafsir/useTafsirLibrary';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { formatAyahReference } from '@/utils/ayahReference';
import { SURAH_AYAH_COUNTS } from '@/utils/ayahLink';
import { goBackOrHome } from '@/utils/goBackOrHome';

/**
 * The tafsir reader (/tafsir?surah=2&ayah=186), opened from a Mushaf ayah's «التفسير»: the whole Surah, top to bottom,
 * each ayah's verified Arabic (the device's Tanzil text, as Copy uses it) with its reference, then the chosen edition's
 * commentary. It opens ON the chosen ayah — the list's data begins at that ayah's row, so its first frame is that ayah —
 * and earlier rows are added above as the reader scrolls up near the top (the content stays where it is,
 * maintainVisibleContentPosition); nothing is added by itself after opening.
 * A passage commented on as a whole (في ظلال القرآن) shows its ayahs, then its commentary once under its range; an ayah
 * inside it links down to that commentary.
 *
 * Switching edition keeps the ayah being read (the first one on screen). The edition chosen is remembered; one that is
 * not ready on this device opens الميسر instead. Back returns to the Mushaf exactly as it was (its tab stays mounted).
 */
export default function TafsirScreen() {
  const params = useLocalSearchParams();
  const surah = clampInt(params.surah, 1, 114) ?? 1;
  const requestedAyah = clampInt(params.ayah, 1, SURAH_AYAH_COUNTS[surah - 1]) ?? 1;
  // A new ayah is a new reader, opened at that ayah: Expo Router may reuse this screen with new params (a link to
  // /tafsir while one is already in the stack — found on the Android emulator), and nothing of the old one may remain.
  return <TafsirReader key={`${surah}:${requestedAyah}`} surah={surah} requestedAyah={requestedAyah} />;
}

function TafsirReader({ surah, requestedAyah }: { surah: number; requestedAyah: number }) {

  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale } = useAppLocale();
  const labels = tafsirLabels(locale);
  const rtl = isRtlLocale(locale);
  const digits = useCallback((text: string) => (rtl ? arabicIndicText(text) : text), [rtl]);
  const { preferredSize } = useQuranFontSizePreference();
  const { library, states } = useTafsirLibrary();

  const [verses, setVerses] = useState<{ ayah: number; text: string }[] | null>(null);
  const [versesFailed, setVersesFailed] = useState(false);
  // The edition preference as stored (undefined until read), and the edition shown with its text.
  const [preferred, setPreferred] = useState<TafsirEditionId | null | undefined>(undefined);
  const [shown, setShown] = useState<{ id: TafsirEditionId; dataset: TafsirDataset } | null>(null);
  const [noEdition, setNoEdition] = useState(false);
  const [fellBack, setFellBack] = useState(false);
  // The ayah the list opens at: the one chosen in the Mushaf, then the one being read when the edition changes.
  const [anchor, setAnchor] = useState(requestedAyah);
  const readingAyah = useRef(requestedAyah);
  // A download started from this screen: shown as soon as it is verified, unless another edition was chosen meanwhile.
  const pendingSelect = useRef<TafsirEditionId | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getSurahVerses(surah), getVerseByKey('1:1')])
      .then(([list, basmala]) => {
        // The Basmala Tanzil sets before 112 Surahs' first ayah is not part of it, as the Mushaf's Copy has it (mushaf/ayahCopyText.ts).
        if (!cancelled) setVerses(list.map((verse) => ({ ayah: verse.ayah, text: ayahCopyText(verse.verseKey, verse.arabicText, basmala.arabicText) })));
      })
      .catch(() => {
        if (!cancelled) setVersesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [surah]);

  useEffect(() => {
    let cancelled = false;
    void loadTafsirEditionPreference().then((value) => !cancelled && setPreferred(value));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Shows an edition (parsed once, cached by the library); one that cannot be read falls back to الميسر. */
  const show = useCallback(async (id: TafsirEditionId, keepAyah: number) => {
    const dataset = await library.load(id);
    if (dataset) {
      readingAyah.current = keepAyah;
      setAnchor(keepAyah);
      setShown({ id, dataset });
      setNoEdition(false);
      return true;
    }
    if (id !== DEFAULT_TAFSIR_EDITION) {
      const fallback = await library.load(DEFAULT_TAFSIR_EDITION);
      if (fallback) {
        setFellBack(true);
        readingAyah.current = keepAyah;
        setAnchor(keepAyah);
        setShown({ id: DEFAULT_TAFSIR_EDITION, dataset: fallback });
        return false;
      }
    }
    setNoEdition(true);
    return false;
  }, [library]);

  // Opening: the stored edition once the device's downloads are known, else الميسر.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || preferred === undefined) return;
    let cancelled = false;
    void library.refresh().then(() => {
      if (cancelled || opened.current) return;
      opened.current = true;
      const id = library.resolve(preferred);
      if (id) void show(id, requestedAyah);
      else setNoEdition(true);
    });
    return () => {
      cancelled = true;
    };
  }, [library, preferred, requestedAyah, show]);

  // A download begun here finishing: show it at the ayah being read.
  useEffect(() => {
    const id = pendingSelect.current;
    if (id && states[id].kind === 'ready') {
      pendingSelect.current = null;
      void saveTafsirEditionPreference(id);
      void show(id, readingAyah.current);
    } else if (id && (states[id].kind === 'failed' || states[id].kind === 'notDownloaded')) pendingSelect.current = null;
  }, [states, show]);

  const select = (id: TafsirEditionId) => {
    pendingSelect.current = null;
    setFellBack(false);
    void saveTafsirEditionPreference(id);
    if (shown?.id !== id) void show(id, readingAyah.current);
  };
  const download = (id: TafsirEditionId) => {
    pendingSelect.current = id;
    setFellBack(false);
    void library.download(id);
  };

  const rows = useMemo(() => (verses && shown ? buildSurahRows(verses, shown.dataset.surah(surah)) : null), [verses, shown, surah]);
  const failedState = Object.values(states).find((s) => s.kind === 'failed');
  const failedText = failedState?.kind === 'failed'
    ? failedState.reason === 'network' ? labels.failedNetwork : failedState.reason === 'verification' ? labels.failedVerification : labels.failedStorage
    : null;

  const surahName = rtl ? getSurahName(surah).nameArabic : getSurahName(surah).nameEnglish;
  const BackIcon = rtl ? ArrowRight : ArrowLeft;
  // The ayah screen's chosen Quran text size (Settings / A− A+), slightly smaller beside a long commentary.
  const arabicSize = Math.max(22, preferredSize - 2);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <View style={[styles.header, rtl && styles.rowRtl]}>
        <Pressable testID="tafsir-back" accessibilityRole="button" accessibilityLabel={labels.back} onPress={goBackOrHome} hitSlop={6} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
          <BackIcon size={22} color={colors.icon} />
        </Pressable>
        <View style={pageHeaderText(colors).block}>
          <Text accessibilityRole="header" style={[styles.title, { textAlign: rtl ? 'right' : 'left' }]}>{labels.title}</Text>
          <Text testID="tafsir-surah" style={[styles.subtitle, { textAlign: rtl ? 'right' : 'left' }]}>{surahName}</Text>
        </View>
      </View>

      <View style={styles.selector}>
        <TafsirEditionSelector
          editions={library.editions}
          states={states}
          selected={shown?.id ?? null}
          labels={labels}
          rtl={rtl}
          digits={digits}
          onSelect={select}
          onDownload={download}
        />
        {shown && (
          <Text testID="tafsir-source" numberOfLines={3} style={styles.source}>
            {fill(labels.sourceLine, { title: shown.dataset.source.title, publisher: shown.dataset.source.publisher })}
            {shown.dataset.source.distributor && shown.dataset.source.version
              ? `
${fill(labels.editionLine, { distributor: shown.dataset.source.distributor, version: shown.dataset.source.version })}`
              : ''}
          </Text>
        )}
        {fellBack && <Text accessibilityLiveRegion="polite" style={[styles.notice, { textAlign: rtl ? 'right' : 'left' }]}>{labels.fellBack}</Text>}
        {failedText && <Text testID="tafsir-download-error" accessibilityLiveRegion="polite" style={[styles.error, { textAlign: rtl ? 'right' : 'left' }]}>{failedText}</Text>}
        {labels.arabicOnlyNote && shown && <Text style={styles.note}>{labels.arabicOnlyNote}</Text>}
      </View>

      {noEdition || versesFailed ? (
        <View style={styles.center}>
          <Text testID={versesFailed ? 'tafsir-quran-failed' : 'tafsir-unavailable'} style={[styles.notice, { textAlign: 'center' }]}>{versesFailed ? labels.quranFailed : labels.noEdition}</Text>
        </View>
      ) : rows ? (
        <TafsirList
          // A new edition (or anchor) is a new list, opened directly at the ayah being read.
          key={`${shown?.id}:${anchor}`}
          rows={rows}
          surah={surah}
          anchor={anchor}
          highlight={requestedAyah}
          arabicSize={arabicSize}
          digits={digits}
          labels={labels}
          rtl={rtl}
          onReading={(ayah) => {
            readingAyah.current = ayah;
          }}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} accessibilityLabel={labels.loading} />
        </View>
      )}
    </SafeAreaView>
  );
}

function TafsirList({ rows, surah, anchor, highlight, arabicSize, digits, labels, rtl, onReading }: {
  rows: readonly TafsirRow[];
  surah: number;
  anchor: number;
  highlight: number;
  arabicSize: number;
  digits: (text: string) => string;
  labels: ReturnType<typeof tafsirLabels>;
  rtl: boolean;
  onReading: (ayah: number) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  const colors = usePalette();
  const list = useRef<FlatList<TafsirRow>>(null);
  /*
   * Opening: the rows drawn begin LEAD rows above the anchor's row, the list kept invisible until the anchor's row is
   * laid out and scrolled to the top — so the first frame seen is the anchor's ayah — and never at offset 0 while earlier
   * rows remain. Earlier rows are then added above as the reader scrolls up (maintainVisibleContentPosition). Adding them
   * at offset 0 put the content in the wrong place on Android (the emulator: 2:185 opened one row low; a pull at the top
   * jumped the wrong way), which this avoids.
   */
  const anchorIndex = rowIndexOfAyah(rows, anchor);
  const [start, setStart] = useState(() => Math.max(0, anchorIndex - LEAD_ROWS));
  const [revealed, setRevealed] = useState(() => anchorIndex === 0);
  const positioning = useRef(false);
  const [height, setHeight] = useState(0);
  const data = useMemo(() => rows.slice(start), [rows, start]);
  const placeAnchor = () => {
    if (revealed || positioning.current) return;
    positioning.current = true;
    // A frame later, every row above it is measured: scrollToIndex then lands exactly; the list shows a frame after.
    requestAnimationFrame(() => {
      list.current?.scrollToIndex({ index: anchorIndex - start, viewPosition: 0, animated: false });
      requestAnimationFrame(() => setRevealed(true));
    });
  };
  const addEarlier = (offset: number) => {
    if (revealed && start > 0 && offset < height * 1.5) setStart((s) => earlierWindowStart(s));
  };
  const onReadingRef = useRef(onReading);
  useEffect(() => {
    onReadingRef.current = onReading;
  }, [onReading]);

  // Stable for the list's lifetime (FlatList does not allow onViewableItemsChanged to change).
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<TafsirRow>[] }) => {
    const first = viewableItems.find((token) => token.isViewable)?.item;
    const ayah = anchorAyahOf(first);
    if (ayah !== null) onReadingRef.current(ayah);
  }, []);

  /**
   * To a passage's commentary: rows not drawn yet only have estimated heights, so the first scroll can land short (seen
   * on the Android emulator). It draws them; the second, once they are measured, puts the commentary at the top.
   */
  const jumpTo = (ayah: number) => {
    const index = commentaryIndexOf(data, ayah);
    if (index < 0) return;
    list.current?.scrollToIndex({ index, viewPosition: 0, animated: false });
    setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0, animated: true }), 200);
  };

  const num = (n: number) => digits(String(n));
  const renderItem = ({ item }: { item: TafsirRow }) => {
    if (item.type === 'ayah') {
      const showJump = item.range !== null && item.ayah < item.range.to;
      return (
        <View
          testID={`tafsir-ayah-${item.ayah}`}
          onLayout={item.ayah === anchor ? placeAnchor : undefined}
          style={[styles.ayah, item.ayah === highlight && styles.ayahHighlighted]}>
          <Text selectable style={[styles.arabic, { fontSize: arabicSize, lineHeight: computeQuranLineHeight(arabicSize) }]}>{item.text}</Text>
          <Text style={styles.reference}>{formatAyahReference(surah, item.ayah)}</Text>
          {showJump && item.range && (
            <Pressable
              testID={`tafsir-jump-${item.ayah}`}
              accessibilityRole="button"
              onPress={() => jumpTo(item.ayah)}
              hitSlop={6}
              style={({ pressed }) => [styles.jump, rtl && styles.rowRtl, pressed && styles.pressed]}>
              <ArrowDown size={14} color={colors.accent} />
              <Text style={styles.jumpText}>{fill(labels.jumpToRange, { from: num(item.range.from), to: num(item.range.to) })}</Text>
            </Pressable>
          )}
        </View>
      );
    }
    return (
      <View testID={`tafsir-commentary-${item.from}-${item.to}`} style={styles.commentary}>
        {item.to > item.from && <Text style={styles.rangeHeading}>{fill(labels.rangeHeading, { from: num(item.from), to: num(item.to) })}</Text>}
        <Text selectable style={styles.commentaryText}>{item.text}</Text>
      </View>
    );
  };

  return (
    <FlatList
      ref={list}
      testID="tafsir-list"
      data={data}
      keyExtractor={(row) => row.key}
      renderItem={renderItem}
      initialNumToRender={LEAD_ROWS + 6}
      windowSize={9}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      // Earlier ayahs near the top, once the opening ayah is placed (a drag's start counts too: a pull at the very top
      // sends no scroll event).
      onScrollBeginDrag={(event) => addEarlier(event.nativeEvent.contentOffset.y)}
      onScroll={(event) => addEarlier(event.nativeEvent.contentOffset.y)}
      style={revealed ? undefined : styles.hidden}
      scrollEventThrottle={64}
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        list.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
        setTimeout(() => list.current?.scrollToIndex({ index, viewPosition: 0, animated: true }), 120);
      }}
      contentContainerStyle={styles.listContent}
      // Room below the Surah's last ayah, so any ayah — the last one too — can sit at the top of the screen.
      ListFooterComponent={<View style={{ height: Math.max(0, height - 160) }}><Text style={styles.end}>{getSurahName(surah).nameArabic}</Text></View>}
    />
  );
}

// The row being read: one entirely on screen, or covering a fifth of it — never the last lines of the previous
// commentary still peeking in at the top (found on the Android emulator: a switch then reopened one ayah early).
/** Rows drawn above the opening ayah (its previous ayah and that ayah's commentary), so the list never opens at offset 0. */
const LEAD_ROWS = 2;

const VIEWABILITY = { viewAreaCoveragePercentThreshold: 20 };

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
/** Western digits (and a decimal point) in Arabic-Indic, as the Mushaf reader shows numbers in Arabic. */
export function arabicIndicText(text: string): string {
  return text.replace(/[0-9]/g, (d) => ARABIC_INDIC[Number(d)]).replace(/\./g, '٫');
}

function clampInt(raw: unknown, min: number, max: number): number | null {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= min && value <= max ? value : null;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
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
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  title: { ...pageHeaderText(colors).title },
  subtitle: pageHeaderText(colors).subtitle,
  selector: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  source: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.small,
  },
  notice: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  error: {
    color: colors.danger,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  hidden: {
    opacity: 0,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
  },
  ayah: {
    borderRadius: radii.sm,
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  ayahHighlighted: {
    backgroundColor: colors.accentSoft,
  },
  // The verified Quran Arabic, as AyahCard draws it (system font, right to left, Quran-safe line height).
  arabic: {
    color: colors.textPrimary,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  reference: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  jump: {
    alignItems: 'center',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 32,
  },
  jumpText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
    writingDirection: 'rtl',
  },
  commentary: {
    borderColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  rangeHeading: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  // The tafsir text: the source's Arabic, right to left in every app language.
  commentaryText: {
    color: colors.textPrimary,
    fontSize: typography.bodyLarge,
    lineHeight: 32,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  end: {
    color: colors.textMuted,
    fontSize: typography.caption,
    paddingTop: spacing.lg,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
});
