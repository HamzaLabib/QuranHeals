import * as Clipboard from 'expo-clipboard';
import { Check, ChevronLeft, ChevronRight, Download, Link2, RefreshCw, Share2, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, PixelRatio, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { pickScenery, type ShareCardSceneryId } from '@/constants/shareCardScenery';
import {
  DEFAULT_SHARE_CARD_THEME,
  SHARE_CARD_THEMES,
  SHARE_CARD_THEMES_ORDER,
  type ShareCardThemeName,
} from '@/constants/shareCardThemes';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { SheetSafeArea } from '@/layout/SheetSafeArea';
import { LAYOUT_TOKENS, windowClassFor } from '@/layout/windowClass';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useQuranTranslationPreference } from '@/localization/useQuranTranslationPreference';
import { captureCardImage, IMAGE_EXPORT_SUPPORTED, releaseCardImages, saveCardImages, shareCardImages } from '@/services/shareImage';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import type { Ayah } from '@/types/domain';
import { buildAyahLink } from '@/utils/ayahLink';
import { formatAyahReference } from '@/utils/ayahReference';
import {
  DEFAULT_SHARE_CARD_FORMAT,
  estimateScaleForLevel,
  MAX_ESTIMATE_LEVEL,
  planShareCards,
  SHARE_CARD_DESIGN_WIDTH,
  SHARE_CARD_FORMAT_SPECS,
  SHARE_CARD_FORMATS,
  translationAttribution,
  type ShareCardFormat,
} from '@/utils/shareCardLayout';
import { ShareAyahCard } from './ShareAyahCard';

type ShareAyahSheetProps = {
  visible: boolean;
  /**
   * The only input: the ayah itself. No emotion, connection text or other
   * screen context reaches the card, so sharing looks identical from the
   * emotion flow, the general Quran flow and Favorites.
   */
  ayah: Ayah | null;
  onClose: () => void;
};

type Status = { tone: 'info' | 'error'; text: string; openSettings?: boolean };
type Busy = 'share' | 'save' | null;
type BackgroundCategory = 'colors' | 'scenery';
const BACKGROUND_CATEGORIES: readonly BackgroundCategory[] = ['colors', 'scenery'];

/**
 * Share Ayah: a live, customizable preview of the ayah as an image card,
 * exported on-device as a real 1080-px-wide PNG (never a screenshot of the
 * screen) and handed to the system share sheet or saved to Photos.
 *
 * Besides the visible preview, every card of the current plan is also
 * rendered at full export size off-screen. Those copies are what gets
 * captured, and they are measured first: Share/Save stay disabled until
 * every export card reports that its text fits, and any overflow re-plans
 * with smaller text or more cards — the image is never clipped.
 *
 * Backgrounds come in two categories: Colors (Sage, Cream, Dark) and Scenery
 * (bundled photographs). The session's Scenery photograph is picked at random
 * the first time Scenery is chosen and then stays put — through re-renders,
 * format and translation changes, switching back and forth between the
 * categories, and export — until "New Background" picks a different one or
 * the sheet opens again. Every card of a long ayah uses the same photograph,
 * and Share/Save also wait until each export card has drawn it.
 */
export function ShareAyahSheet({ visible, ayah, onClose }: ShareAyahSheetProps) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { locale, messages } = useAppLocale();
  const copy = messages.share;
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const { preference } = useQuranTranslationPreference();
  const screen = useWindowDimensions();

  const hasTranslation = Boolean(ayah?.englishTranslation?.trim());
  const [format, setFormat] = useState<ShareCardFormat>(DEFAULT_SHARE_CARD_FORMAT);
  const [theme, setTheme] = useState<ShareCardThemeName>(DEFAULT_SHARE_CARD_THEME);
  const [category, setCategory] = useState<BackgroundCategory>('colors');
  // Null until Scenery is first chosen in this session.
  const [sceneryId, setSceneryId] = useState<ShareCardSceneryId | null>(null);
  // `${planId}|${page key}|${photograph}` of every export card that has drawn its photograph.
  const [sceneryLoaded, setSceneryLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const [sceneryFailed, setSceneryFailed] = useState<ShareCardSceneryId | null>(null);
  // Follows the reader's translation setting: on when translations are
  // always shown, off for "on demand" / "off". Changing it here never
  // changes that saved setting.
  const [showTranslation, setShowTranslation] = useState(preference.displayMode === 'always');
  const [pageIndex, setPageIndex] = useState(0);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [verifiedPlanId, setVerifiedPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const busyRef = useRef(false);
  const exportViews = useRef(new Map<string, View | null>());
  const fitReports = useRef(new Map<string, boolean>());
  // Shared files stay until the next export or until the sheet closes: on
  // Android the receiving app may still be reading the file after the share
  // sheet itself has returned.
  const sharedUris = useRef<string[]>([]);

  // Each opening (or a different ayah) starts from the defaults.
  const openKey = visible && ayah ? ayah.id : null;
  const [trackedOpenKey, setTrackedOpenKey] = useState<string | null>(openKey);
  if (openKey !== trackedOpenKey) {
    setTrackedOpenKey(openKey);
    if (openKey) {
      setFormat(DEFAULT_SHARE_CARD_FORMAT);
      setTheme(DEFAULT_SHARE_CARD_THEME);
      setCategory('colors');
      setSceneryId(null);
      setSceneryLoaded(new Set());
      setSceneryFailed(null);
      setShowTranslation(preference.displayMode === 'always');
      setPageIndex(0);
      setLevels({});
      setVerifiedPlanId(null);
      setStatus(null);
      setLinkCopied(false);
    }
  }

  const translationOn = showTranslation && hasTranslation;
  const layoutKey = `${ayah?.id ?? ''}|${format}|${translationOn ? 't' : 'a'}`;
  const level = levels[layoutKey] ?? 0;
  const planId = `${layoutKey}|${level}`;
  const pages = useMemo(
    () => (ayah
      ? planShareCards({
        arabicText: ayah.arabicText,
        translation: translationOn ? ayah.englishTranslation : null,
        format,
        estimateScale: estimateScaleForLevel(level),
      })
      : []),
    [ayah, translationOn, format, level],
  );
  const currentIndex = Math.min(pageIndex, Math.max(pages.length - 1, 0));
  const currentPage = pages[currentIndex];
  // What every card shows: a photograph, or null for the Colors theme.
  const scenery = category === 'scenery' ? sceneryId : null;
  const sceneryKey = (pageKey: string) => `${planId}|${pageKey}|${scenery}`;
  const backgroundReady = scenery === null || pages.every((page) => sceneryLoaded.has(sceneryKey(page.key)));
  const fitVerified = verifiedPlanId === planId;
  const isReady = fitVerified && backgroundReady;
  const cannotFit = level >= MAX_ESTIMATE_LEVEL && !fitVerified;

  const onSceneryLoad = useCallback((key: string, forScenery: ShareCardSceneryId, loaded: boolean) => {
    if (!loaded) {
      setSceneryFailed(forScenery);
      return;
    }
    setSceneryLoaded((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);

  const releaseShared = useCallback(() => {
    releaseCardImages(sharedUris.current);
    sharedUris.current = [];
  }, []);
  useEffect(() => releaseShared, [releaseShared]);

  const onFit = useCallback((forPlanId: string, variant: 'preview' | 'export', pageKey: string, fits: boolean) => {
    if (forPlanId !== planId) return;
    if (!fits) {
      if (level < MAX_ESTIMATE_LEVEL) setLevels((current) => ({ ...current, [layoutKey]: level + 1 }));
      return;
    }
    if (variant !== 'export') return;
    fitReports.current.set(`${forPlanId}|${pageKey}`, true);
    if (pages.every((page) => fitReports.current.get(`${forPlanId}|${page.key}`))) setVerifiedPlanId(forPlanId);
  }, [planId, level, layoutKey, pages]);

  if (!visible || !ayah || !currentPage) return null;

  const reference = formatAyahReference(ayah.surahNumber, ayah.ayahNumber);
  const translationCredit = translationAttribution(ayah.translationSource);
  const spec = SHARE_CARD_FORMAT_SPECS[format];
  const aspect = spec.height / SHARE_CARD_DESIGN_WIDTH;
  // Large, but leaves the controls reachable on small phones.
  const maxPreviewHeight = Math.max(220, Math.min(screen.height * 0.42, 470));
  // Inside the sheet: the window on phones, the centred sheet (at most LAYOUT_TOKENS.sheetMaxWidth) on tablets.
  const sheetWidth = windowClassFor(screen.width) === 'compact' ? screen.width : Math.min(screen.width, LAYOUT_TOKENS.sheetMaxWidth);
  const previewWidth = Math.floor(Math.min(sheetWidth - 2 * spacing.lg - 2, maxPreviewHeight / aspect));
  // Laid out at 1080 px: exactly that on iOS (integer screen scale); Android
  // corrects any rounding when capturing — see captureCardImage.
  const exportWidth = SHARE_CARD_DESIGN_WIDTH / PixelRatio.get();
  const isMultiCard = pages.length > 1;

  const close = () => {
    releaseShared();
    setStatus(null);
    onClose();
  };

  // Random picks happen only here, in response to a tap — never while rendering.
  const chooseCategory = (next: BackgroundCategory) => {
    setCategory(next);
    if (next === 'scenery' && sceneryId === null) setSceneryId(pickScenery(null));
    setStatus(null);
  };
  const showNewBackground = () => {
    setSceneryId(pickScenery(sceneryId));
    setSceneryFailed(null);
    setStatus(null);
  };
  const sceneryError = scenery !== null && sceneryFailed === scenery;

  const captureAll = async (targets: typeof pages) => {
    const uris: string[] = [];
    try {
      for (const page of targets) {
        const view = exportViews.current.get(`${planId}|${page.key}`) ?? null;
        uris.push(await captureCardImage(
          { current: view },
          { width: spec.width, height: spec.height },
          `quran-heals-${ayah.surahNumber}-${ayah.ayahNumber}-${page.pageNumber}`,
        ));
      }
      return uris;
    } catch (error) {
      releaseCardImages(uris);
      throw error;
    }
  };

  const runExport = async (action: Exclude<Busy, null>) => {
    if (busyRef.current || !isReady) return;
    if (!IMAGE_EXPORT_SUPPORTED) {
      setStatus({ tone: 'error', text: copy.shareUnavailable });
      return;
    }
    busyRef.current = true;
    setBusy(action);
    setStatus(null);
    releaseShared();
    let uris: string[] = [];
    try {
      // Always every card, in order: a long ayah is never shared in part.
      uris = await captureAll(pages);
      if (action === 'share') {
        sharedUris.current = uris;
        uris = [];
        // The image can't carry a link, so the ayah's link goes on the
        // clipboard first, ready for a Story Link sticker or a message.
        if (await copyLinkQuietly()) setStatus({ tone: 'info', text: copy.linkAutoCopied });
        const result = await shareCardImages(sharedUris.current, copy.title);
        if (result === 'unavailable') setStatus({ tone: 'error', text: copy.shareUnavailable });
        if (result === 'multiple-unavailable') setStatus({ tone: 'error', text: copy.multipleUnavailable });
        // Nothing was handed to another app, so nothing needs to outlive this call.
        if (result !== 'shared') releaseShared();
      } else {
        const result = await saveCardImages(uris);
        if (result.status === 'saved') {
          setStatus({ tone: 'info', text: result.count > 1 ? copy.savedAll : copy.saved });
        } else {
          setStatus(result.canAskAgain
            ? { tone: 'error', text: copy.saveDenied }
            : { tone: 'error', text: copy.saveBlocked, openSettings: true });
        }
      }
    } catch {
      setStatus({ tone: 'error', text: action === 'share' ? copy.shareFailed : copy.saveFailed });
    } finally {
      releaseCardImages(uris);
      busyRef.current = false;
      setBusy(null);
    }
  };

  const formatLabel: Record<ShareCardFormat, string> = {
    story: copy.formatStory,
    post: copy.formatPost,
    square: copy.formatSquare,
  };
  const themeLabel: Record<ShareCardThemeName, string> = {
    sage: copy.themeSage,
    cream: copy.themeCream,
    dark: copy.themeDark,
  };
  const categoryLabel: Record<BackgroundCategory, string> = {
    colors: copy.backgroundColors,
    scenery: copy.backgroundScenery,
  };
  const shareLabel = isMultiCard ? `${copy.shareAllCards} (${pages.length})` : copy.share;
  // Only the Quran reference — never who shared it or why.
  const ayahLink = buildAyahLink(ayah.surahNumber, ayah.ayahNumber);
  /** Copies the exact ayah link; never throws. */
  const copyLinkQuietly = async (): Promise<boolean> => {
    if (!ayahLink) return false;
    try {
      const copied = await Clipboard.setStringAsync(ayahLink);
      setLinkCopied(copied);
      return copied;
    } catch {
      setLinkCopied(false);
      return false;
    }
  };
  const copyLink = async () => {
    setStatus(await copyLinkQuietly()
      ? { tone: 'info', text: copy.linkCopied }
      : { tone: 'error', text: copy.copyLinkFailed });
  };
  const PreviousIcon = isRtl ? ChevronRight : ChevronLeft;
  const NextIcon = isRtl ? ChevronLeft : ChevronRight;
  const actionsDisabled = !isReady || busy !== null;
  // Cards are captured one by one: changing the layout or colours midway
  // would mix two designs in one multi-card set.
  const optionsLocked = busy !== null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        {/* Full-size export copies, off-screen and hidden from assistive tech. */}
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.exportStage, { left: -(exportWidth + 1000) }]}>
          {pages.map((page) => (
            <ShareAyahCard
              key={`${planId}|${page.key}`}
              viewRef={(view) => { exportViews.current.set(`${planId}|${page.key}`, view); }}
              page={page}
              format={format}
              theme={theme}
              scenery={scenery}
              onSceneryLoad={scenery === null ? undefined : (loaded) => onSceneryLoad(sceneryKey(page.key), scenery, loaded)}
              width={exportWidth}
              reference={reference}
              translationCredit={translationCredit}
              onFitChange={(fits) => onFit(planId, 'export', page.key, fits)}
            />
          ))}
        </View>

        <SheetSafeArea edges={['bottom']} style={styles.safeArea}>
          <View style={styles.sheet}>
            <View style={[styles.header, isRtl && styles.rowRtl]}>
              <Text style={[styles.title, direction]}>{copy.title}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={copy.close}
                onPress={close}
                hitSlop={8}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <X size={20} color={colors.icon} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.content}>
              <View style={styles.previewArea}>
                <View
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={`${copy.preview}. ${reference}`}
                  style={styles.previewShadow}>
                  <View style={styles.previewClip}>
                    <ShareAyahCard
                      key={`${planId}|${currentPage.key}|preview`}
                      page={currentPage}
                      format={format}
                      theme={theme}
                      scenery={scenery}
                      width={previewWidth}
                      reference={reference}
                      translationCredit={translationCredit}
                      onFitChange={(fits) => onFit(planId, 'preview', currentPage.key, fits)}
                    />
                  </View>
                </View>

                {isMultiCard && (
                  <View style={[styles.pager, isRtl && styles.rowRtl]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.previousCard}
                      accessibilityState={{ disabled: currentIndex === 0 }}
                      disabled={currentIndex === 0}
                      onPress={() => setPageIndex(currentIndex - 1)}
                      style={({ pressed }) => [styles.pagerButton, currentIndex === 0 && styles.disabled, pressed && styles.pressed]}>
                      <PreviousIcon size={20} color={colors.icon} />
                    </Pressable>
                    <Text
                      accessibilityLabel={`${copy.card} ${currentPage.pageNumber} / ${currentPage.pageCount}`}
                      style={styles.pagerText}>
                      {`${currentPage.pageNumber} / ${currentPage.pageCount}`}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.nextCard}
                      accessibilityState={{ disabled: currentIndex >= pages.length - 1 }}
                      disabled={currentIndex >= pages.length - 1}
                      onPress={() => setPageIndex(currentIndex + 1)}
                      style={({ pressed }) => [styles.pagerButton, currentIndex >= pages.length - 1 && styles.disabled, pressed && styles.pressed]}>
                      <NextIcon size={20} color={colors.icon} />
                    </Pressable>
                  </View>
                )}
                {isMultiCard && <Text style={[styles.note, direction]}>{copy.longAyahNote}</Text>}
              </View>

              <Text style={[styles.sectionLabel, direction]}>{copy.format}</Text>
              <View style={[styles.segmented, isRtl && styles.rowRtl]}>
                {SHARE_CARD_FORMATS.map((option) => {
                  const selected = option === format;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={`${formatLabel[option]} ${SHARE_CARD_FORMAT_SPECS[option].ratioLabel}`}
                      accessibilityState={{ selected }}
                      disabled={optionsLocked}
                      onPress={() => { setFormat(option); setPageIndex(0); setStatus(null); }}
                      style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && styles.pressed]}>
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{formatLabel[option]}</Text>
                      <Text style={[styles.segmentRatio, selected && styles.segmentTextSelected]}>{SHARE_CARD_FORMAT_SPECS[option].ratioLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.sectionLabel, direction]}>{copy.background}</Text>
              <View style={[styles.segmented, isRtl && styles.rowRtl]}>
                {BACKGROUND_CATEGORIES.map((option) => {
                  const selected = option === category;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={categoryLabel[option]}
                      accessibilityState={{ selected }}
                      disabled={optionsLocked}
                      onPress={() => chooseCategory(option)}
                      style={({ pressed }) => [styles.segment, selected && styles.segmentSelected, pressed && styles.pressed]}>
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{categoryLabel[option]}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {category === 'scenery' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={copy.newBackground}
                  accessibilityState={{ disabled: optionsLocked }}
                  disabled={optionsLocked}
                  onPress={showNewBackground}
                  style={({ pressed }) => [styles.newBackgroundButton, isRtl && styles.rowRtl, optionsLocked && styles.disabled, pressed && styles.pressed]}>
                  <RefreshCw size={18} color={colors.accent} />
                  <Text style={styles.newBackgroundText}>{copy.newBackground}</Text>
                </Pressable>
              ) : (
                <View style={[styles.swatches, isRtl && styles.rowRtl]}>
                  {SHARE_CARD_THEMES_ORDER.map((option) => {
                    const selected = option === theme;
                    return (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityLabel={themeLabel[option]}
                        accessibilityState={{ selected }}
                        disabled={optionsLocked}
                        onPress={() => { setTheme(option); setStatus(null); }}
                        style={({ pressed }) => [styles.swatchOption, pressed && styles.pressed]}>
                        <View style={[styles.swatchRing, selected && styles.swatchRingSelected]}>
                          <View
                            style={[
                              styles.swatch,
                              { backgroundColor: SHARE_CARD_THEMES[option].background, borderColor: SHARE_CARD_THEMES[option].frame },
                            ]}>
                            <Text style={[styles.swatchGlyph, { color: SHARE_CARD_THEMES[option].arabic }]}>ق</Text>
                          </View>
                        </View>
                        <Text style={[styles.swatchLabel, selected && styles.swatchLabelSelected]}>{themeLabel[option]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {hasTranslation && (
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={copy.showTranslation}
                  accessibilityState={{ checked: showTranslation }}
                  disabled={optionsLocked}
                  onPress={() => { setShowTranslation(!showTranslation); setPageIndex(0); setStatus(null); }}
                  style={({ pressed }) => [styles.toggleRow, isRtl && styles.rowRtl, pressed && styles.pressed]}>
                  <Text style={[styles.toggleLabel, direction]}>{copy.showTranslation}</Text>
                  <View style={[styles.track, showTranslation && styles.trackOn]}>
                    <View style={[styles.thumb, showTranslation ? styles.thumbOn : styles.thumbOff]} />
                  </View>
                </Pressable>
              )}

              {(status || busy || cannotFit || sceneryError) && (
                <View accessibilityLiveRegion="polite" style={[styles.statusRow, isRtl && styles.rowRtl]}>
                  {busy && <ActivityIndicator size="small" color={colors.accent} />}
                  <Text
                    style={[
                      styles.statusText,
                      direction,
                      (cannotFit || sceneryError || status?.tone === 'error') && styles.statusError,
                    ]}>
                    {busy ? copy.preparing : cannotFit ? copy.cannotFit : sceneryError ? copy.sceneryLoadFailed : status?.text}
                  </Text>
                  {!busy && status?.openSettings && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={copy.openSettings}
                      onPress={() => { Linking.openSettings().catch(() => undefined); }}
                      style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                      <Text style={styles.linkText}>{copy.openSettings}</Text>
                    </Pressable>
                  )}
                </View>
              )}

              <View style={[styles.actions, isRtl && styles.rowRtl]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={isMultiCard ? copy.saveAllImages : copy.saveImage}
                  accessibilityState={{ disabled: actionsDisabled, busy: busy === 'save' }}
                  disabled={actionsDisabled}
                  onPress={() => void runExport('save')}
                  style={({ pressed }) => [styles.secondaryButton, actionsDisabled && styles.disabled, pressed && styles.pressed]}>
                  <Download size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryButtonText}>{isMultiCard ? copy.saveAllImages : copy.saveImage}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={shareLabel}
                  accessibilityState={{ disabled: actionsDisabled, busy: busy === 'share' }}
                  disabled={actionsDisabled}
                  onPress={() => void runExport('share')}
                  style={({ pressed }) => [styles.primaryButton, actionsDisabled && styles.disabled, pressed && styles.pressed]}>
                  <Share2 size={18} color={colors.onPrimaryButton} />
                  <Text style={styles.primaryButtonText}>{shareLabel}</Text>
                </Pressable>
              </View>

              {ayahLink && (
                <View style={styles.linkSection}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={copy.copyLink}
                    onPress={() => void copyLink()}
                    style={({ pressed }) => [styles.copyLinkButton, isRtl && styles.rowRtl, pressed && styles.pressed]}>
                    {linkCopied ? <Check size={18} color={colors.accent} /> : <Link2 size={18} color={colors.accent} />}
                    <Text style={styles.copyLinkText}>{copy.copyLink}</Text>
                  </Pressable>
                  <Text style={[styles.note, direction]}>{copy.linkHint}</Text>
                </View>
              )}
            </ScrollView>
          </View>
        </SheetSafeArea>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  backdrop: {
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'flex-end',
  },
  exportStage: {
    position: 'absolute',
    top: 0,
  },
  safeArea: {
    backgroundColor: colors.sheetBackground,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    maxHeight: '94%',
    width: '100%',
    ...shadows.soft,
  },
  sheet: {
    flexShrink: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  title: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  closeButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  previewArea: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  previewShadow: {
    borderRadius: radii.md,
    ...shadows.soft,
  },
  previewClip: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  pagerButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  pagerText: {
    color: colors.textSecondary,
    fontSize: typography.body,
    fontWeight: '700',
    minWidth: 56,
    textAlign: 'center',
    writingDirection: 'ltr',
  },
  note: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
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
    minHeight: 48,
    paddingVertical: spacing.xs,
  },
  segmentSelected: {
    backgroundColor: colors.primaryButton,
  },
  segmentText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  segmentRatio: {
    color: colors.textMuted,
    fontSize: typography.small,
    writingDirection: 'ltr',
  },
  segmentTextSelected: {
    color: colors.onPrimaryButton,
  },
  newBackgroundButton: {
    alignItems: 'center',
    backgroundColor: colors.secondaryButtonSurface,
    borderColor: colors.secondaryButtonBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  newBackgroundText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  swatchOption: {
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 72,
  },
  swatchRing: {
    borderColor: 'transparent',
    borderRadius: radii.full,
    borderWidth: 2,
    padding: 3,
  },
  swatchRingSelected: {
    borderColor: colors.accent,
  },
  swatch: {
    alignItems: 'center',
    borderRadius: radii.full,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  swatchGlyph: {
    fontSize: 20,
    fontWeight: '700',
  },
  swatchLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  swatchLabelSelected: {
    color: colors.textPrimary,
    fontWeight: '800',
  },
  toggleRow: {
    alignItems: 'center',
    backgroundColor: colors.inputBackground,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  toggleLabel: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '600',
  },
  track: {
    backgroundColor: colors.border,
    borderRadius: radii.full,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 3,
    width: 48,
  },
  trackOn: {
    backgroundColor: colors.accentFill,
  },
  thumb: {
    backgroundColor: colors.onAccentFill,
    borderRadius: radii.full,
    height: 22,
    width: 22,
  },
  // Physical positions: a switch reads off-left / on-right in every language.
  thumbOff: {
    alignSelf: 'flex-start',
  },
  thumbOn: {
    alignSelf: 'flex-end',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusText: {
    color: colors.accent,
    flexShrink: 1,
    fontSize: typography.caption,
    fontWeight: '700',
    lineHeight: 19,
  },
  statusError: {
    color: colors.danger,
  },
  linkButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  linkText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  primaryButtonText: {
    color: colors.onPrimaryButton,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: '800',
  },
  linkSection: {
    gap: spacing.sm,
  },
  copyLinkButton: {
    alignItems: 'center',
    borderColor: colors.secondaryButtonBorder,
    backgroundColor: colors.secondaryButtonSurface,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  copyLinkText: {
    color: colors.accent,
    fontSize: typography.body,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.78,
  },
});
