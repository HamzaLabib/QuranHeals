import { useCallback, useEffect, useState } from 'react';
import type { LayoutRectangle } from 'react-native';

import { localNumber } from '@/localization/fill';
import { MUSHAF_PAGE_COUNT } from '@/mushaf/mushafPage';
import { isRtlLocale } from '@/localization/locales';
import { useQuranReadingMode } from '@/localization/quranLanguage';
import { useAppLocale } from '@/localization/useAppLocale';
import { getSurahName } from '@/services/surahNames';
import { isSurahPreviewBundled } from '@/surahPreview/bundledDataset';
import { SURAH_PREVIEW_ENABLED } from '@/surahPreview/config';
import { previewLanguage, surahPreviewDataset, surahsStartingOn } from '@/surahPreview/dataset';
import { surahPreviewLabels } from '@/surahPreview/labels';
import { SurahPreviewSheet } from '@/surahPreview/SurahPreviewSheet';
import { isWordMeaningsBundled } from '@/wordMeanings/bundledDataset';
import { WORD_MEANINGS_ENABLED } from '@/wordMeanings/config';
import { wordMeaningsDataset } from '@/wordMeanings/dataset';
import { wordMeaningsLabels } from '@/wordMeanings/labels';
import { useWordMeaningsVisibility } from '@/mushaf/useWordMeaningsVisibility';
import { WordMeaningsSheet } from '@/wordMeanings/WordMeaningsSheet';

import { ARROW_ONLY_WIDTH, FeatureButton } from './FeatureButton';
import { edgeInset, labelledButtons, pillCap, placeFeatureButtons } from './placement';

export type FeatureKind = 'meanings' | 'preview';

type Props = {
  /** The page being read. */
  page: number;
  areaWidth: number;
  /** The page's width and frame (Normal Mode), for Meanings' approved x: the page frame's left edge. */
  pageWidth: number;
  tilesDown: number;
  /**
   * False while the page is zoomed or not drawn (loading, not downloaded), or another popup is open: the buttons are
   * then hidden as the ورد row is while zoomed (unseen, letting every touch through, unannounced).
   */
  showControls: boolean;
  dark: boolean;
  /** The ورد pill as laid out in its row (null until measured), and the row's left and top. */
  wirdPill: LayoutRectangle | null;
  rowLeft: number;
  rowTop: number;
  /** The highest the buttons may reach (the page's lower edge; page 604: under إتمام الختمة and the du'a); null until measured. */
  minTop: number | null;
  /** The ورد pill's text colour now (its name, or the accent while no ورد is chosen). */
  pillText: 'text' | 'accent';
  /** The ورد row's centre (the pill is centred on it). */
  rowCentre: number;
  /** Whether a sheet is open, for the reader's own rules (the recitation never turns a page from under it). */
  onOpenChange?: (open: boolean) => void;
  /** The widest the ورد pill may be so the buttons fit beside it (placement.ts pillCap); null: no limit of theirs. */
  onPillRoom?: (maxWidth: number | null) => void;
};

/**
 * The reader's feature buttons under the page and their sheets, in Normal Mode only: Meanings (المعاني) on every page
 * (where its data is bundled) and Surah Preview (عن السورة) on the pages where a Surah begins, in one row beside the ورد
 * pill (placement.ts). The reader mounts it in Normal Mode only; unmounted (full screen, the long page) it leaves
 * nothing: no button, chevron, sheet, touch target or gesture. Switching to full screen therefore closes an open
 * sheet, and coming back never reopens it.
 *
 * One sheet at a time: opening one closes the other. A sheet shows the page it was opened on and closes when the page
 * changes (by any means), so another page's content is never shown. Opening and closing them read only bundled data:
 * nothing is saved, synced or fetched, and the page and reading position stay as they were.
 */
export function MushafFeatureLayer(props: Props) {
  // Settings → Word Meanings OFF: no Meanings button at all (as in a build without it); Surah Preview is unaffected.
  // Hidden until the stored choice is read, so a saved OFF never shows it for a moment.
  const { visible: meaningsVisible, isReady: meaningsChoiceRead } = useWordMeaningsVisibility();
  const meanings = WORD_MEANINGS_ENABLED && isWordMeaningsBundled() && meaningsChoiceRead && meaningsVisible;
  const preview = SURAH_PREVIEW_ENABLED && isSurahPreviewBundled();
  if (!meanings && !preview) return null;
  return <FeatureLayer {...props} meanings={meanings} preview={preview} />;
}

function FeatureLayer({ page, areaWidth, pageWidth, tilesDown, showControls, dark, wirdPill, rowLeft, rowTop, rowCentre, minTop, pillText, onOpenChange, onPillRoom, meanings, preview }: Props & { meanings: boolean; preview: boolean }) {
  const { locale } = useAppLocale();
  const { mode: quranMode } = useQuranReadingMode();
  const rtl = isRtlLocale(locale);
  const meaningsLabels = wordMeaningsLabels(locale);
  const previewLabels = surahPreviewLabels(locale);
  const startingSurahs = preview ? surahsStartingOn(page) : [];

  // The sheet open, and the page it was opened on; and what each sheet shows (kept while it slides away, so it never
  // changes to another page's content on the way out). Mounted from its first opening on, so the reader's start never
  // builds a sheet or reads a dataset.
  const [open, setOpen] = useState<{ kind: FeatureKind; page: number } | null>(null);
  const [meaningsPage, setMeaningsPage] = useState<number | null>(null);
  const [shownPreview, setShownPreview] = useState<{ surahs: number[]; selected: number } | null>(null);
  // Another page is shown: the sheet closes (React's "adjust state when a prop changes": no extra commit).
  if (open !== null && open.page !== page) setOpen(null);
  const isOpen = open !== null;
  useEffect(() => {
    onOpenChange?.(isOpen);
    return () => onOpenChange?.(false);
  }, [isOpen, onOpenChange]);
  const close = useCallback(() => setOpen(null), []);

  const buttons: { kind: FeatureKind; label: string; hint: string }[] = [
    ...(meanings ? [{ kind: 'meanings' as const, label: meaningsLabels.title, hint: meaningsLabels.openHint }] : []),
    ...(startingSurahs.length > 0 ? [{ kind: 'preview' as const, label: previewLabels.title, hint: previewLabels.openHint }] : []),
  ];
  const toggle = (kind: FeatureKind) => {
    if (open?.kind === kind) return setOpen(null);
    if (kind === 'meanings') setMeaningsPage(page);
    else setShownPreview({ surahs: startingSurahs, selected: startingSurahs[0] });
    return setOpen({ kind, page });
  };

  // Each button's labelled size, kept with the label it was measured with (another language measures again); unseen
  // until it and the pill are measured, so it never visibly jumps into place. Arrow-only needs no measuring
  // (ARROW_ONLY_WIDTH, the labelled height), so switching form never hides or moves anything else.
  type Size = { width: number; height: number; label: string };
  const [sizes, setSizes] = useState<Partial<Record<FeatureKind, Size>>>({});
  const hasPreview = startingSurahs.length > 0;
  const meaningsLabelled = meanings && sizes.meanings?.label === meaningsLabels.title ? sizes.meanings : null;
  const previewLabelled = hasPreview && sizes.preview?.label === previewLabels.title ? sizes.preview : null;
  const sized = (!meanings || meaningsLabelled !== null) && (!hasPreview || previewLabelled !== null);
  // Meanings LEFT at its approved x, the ورد pill centred as always, Surah Preview RIGHT at the mirrored inset: the same
  // physical order in every language (placement.ts). The ورد name comes first: the pill is narrowed only as far as the
  // arrow-only buttons need (a longer name then ends in “…”); where even that leaves no room for Surah Preview it is not
  // shown, Meanings always is. Each button then keeps its label only while it clears the pill as laid out.
  const page604 = page === MUSHAF_PAGE_COUNT;
  const inset = edgeInset({ areaWidth, pageWidth, tilesDown, rowLeft, page604 });
  const cap = pillCap({ inset, areaWidth, rowCentre, meaningsWidth: meanings ? ARROW_ONLY_WIDTH : null, previewWidth: hasPreview ? ARROW_ONLY_WIDTH : null });
  const room = cap.maxWidth;
  useEffect(() => {
    onPillRoom?.(room);
  }, [room, onPillRoom]);
  useEffect(() => () => onPillRoom?.(null), [onPillRoom]);
  // The pill as laid out; reported wider than it may be now (laid out before this cap reached it, e.g. a page where a
  // Surah begins), it is taken at the cap, centred where it is: exactly its next layout, so nothing switches twice.
  const laidOut = wirdPill === null ? null : { left: rowLeft + wirdPill.x, top: rowTop + wirdPill.y, width: wirdPill.width, height: wirdPill.height };
  const pill = laidOut !== null && room !== null && laidOut.width > room + 0.5 ? { ...laidOut, left: laidOut.left + (laidOut.width - room) / 2, width: room } : laidOut;
  // Page 604 (owner's decision, 2026-10-24): both always arrow-only, whatever the ورد name, language or screen; every
  // other page keeps the adaptive rule. Their labelled height is still measured first (the capsule keeps it).
  const labelled = sized && pill !== null
    ? page604
      ? { meanings: false, preview: false }
      : labelledButtons({ pill, inset, areaWidth, meaningsWidth: meaningsLabelled?.width ?? null, previewWidth: cap.previewFits ? previewLabelled?.width ?? null : null })
    : { meanings: true, preview: true };
  const sizeOf = (kind: FeatureKind, measured: Size | null) => (measured === null ? null : labelled[kind] ? measured : { width: ARROW_ONLY_WIDTH, height: measured.height });
  const places = sized && pill !== null && minTop !== null ? placeFeatureButtons({
    pill,
    inset,
    areaWidth,
    minTop,
    meanings: sizeOf('meanings', meaningsLabelled),
    preview: cap.previewFits ? sizeOf('preview', previewLabelled) : null,
  }) : null;

  const formatNumber = (n: number) => localNumber(locale, n);
  const surahName = (surah: number) => (rtl ? getSurahName(surah).nameArabic : getSurahName(surah).nameEnglish);
  const meaningsData = meaningsPage === null ? null : wordMeaningsDataset();
  const meaningsEntries = meaningsData?.status === 'official' && meaningsPage !== null ? meaningsData.forPage(meaningsPage) : null;
  const previewData = shownPreview === null ? null : surahPreviewDataset();
  const previewEntry = previewData?.status === 'official' && shownPreview ? previewData.forSurah(shownPreview.selected) : null;

  return (
    <>
      {buttons.map((button) => {
        const place = places?.[button.kind] ?? null;
        const measured = button.kind === 'meanings' ? meaningsLabelled : previewLabelled;
        const arrowOnly = measured !== null && !labelled[button.kind];
        return (
          <FeatureButton
            key={button.kind}
            arrowOnlyHeight={arrowOnly ? measured.height : undefined}
            testID={button.kind === 'meanings' ? 'word-meanings-open' : 'surah-preview-open'}
            label={button.label}
            hint={button.hint}
            dark={dark}
            rtl={rtl}
            textColor={pillText}
            open={open?.kind === button.kind}
            hidden={!showControls || !place}
            position={place ? { left: place.left, top: place.top } : { left: 0, top: rowTop }}
            slopTop={place?.slopTop ?? 0}
            slopBottom={place?.slopBottom ?? 0}
            onPress={() => toggle(button.kind)}
            onLayout={(event) => {
              // Only the labelled form is measured (arrow-only's size is known).
              if (arrowOnly) return;
              const { width, height } = event.nativeEvent.layout;
              // Sub-pixel changes are ignored: Android snaps a box to whole pixels by where it is, so re-centring it on a
              // height that differs by a fraction of a pixel would otherwise move and re-measure it forever.
              const label = button.label;
              setSizes((now) => {
                const before = now[button.kind];
                return before && before.label === label && Math.abs(before.width - width) < 0.5 && Math.abs(before.height - height) < 0.5 ? now : { ...now, [button.kind]: { width, height, label } };
              });
            }}
          />
        );
      })}
      {meaningsPage !== null && (
        <WordMeaningsSheet
          visible={open?.kind === 'meanings'}
          page={meaningsPage}
          entries={meaningsEntries}
          labels={meaningsLabels}
          dark={dark}
          rtl={rtl}
          formatNumber={formatNumber}
          surahName={surahName}
          onClose={close}
        />
      )}
      {shownPreview !== null && (
        <SurahPreviewSheet
          visible={open?.kind === 'preview'}
          surahs={shownPreview.surahs}
          selected={shownPreview.selected}
          onSelect={(selected) => setShownPreview((now) => (now ? { ...now, selected } : now))}
          entry={previewEntry}
          language={previewEntry ? previewLanguage(previewEntry, locale, quranMode) : rtl ? 'ar' : 'en'}
          labels={previewLabels}
          dark={dark}
          rtl={rtl}
          formatNumber={formatNumber}
          surahName={surahName}
          onClose={close}
        />
      )}
    </>
  );
}
