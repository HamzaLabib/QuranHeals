import { Leaf, PenLine } from 'lucide-react-native';
import { useId, useRef, type Ref } from 'react';
import { Image, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  SCENERY_CARD_THEME,
  SHARE_CARD_SCENERY_OVERLAY_COLOR,
  sceneryById,
  sceneryEdgeOpacity,
  type ShareCardSceneryId,
} from '@/constants/shareCardScenery';
import { SHARE_CARD_SCENERY_IMAGES } from '@/constants/shareCardSceneryImages';
import { SHARE_CARD_THEMES, type ShareCardThemeName } from '@/constants/shareCardThemes';
import {
  arabicLineHeight,
  QURAN_TEXT_CARD_ATTRIBUTION,
  REFLECTION_INVITATION,
  SHARE_CARD_BRAND,
  SHARE_CARD_DESIGN_WIDTH,
  SHARE_CARD_FOOTER_HEIGHT,
  SHARE_CARD_FORMAT_SPECS,
  SHARE_CARD_METRICS as M,
  translationLineHeight,
  type ShareCardFormat,
  type ShareCardFormatSpec,
  type ShareCardPage,
} from '@/utils/shareCardLayout';

type ShareAyahCardProps = {
  page: ShareCardPage;
  format: ShareCardFormat;
  /** The Colors background; ignored while a Scenery photograph is shown. */
  theme: ShareCardThemeName;
  /** A Scenery photograph, or null for the Colors background `theme`. */
  scenery: ShareCardSceneryId | null;
  /** Scenery only: whether the photograph has been drawn (true) or failed to load (false). */
  onSceneryLoad?: (loaded: boolean) => void;
  /** On-screen width in points; every design unit is scaled by width / 1080. */
  width: number;
  /** formatAyahReference(...) — the same reference line used everywhere in the app. */
  reference: string;
  /** Translator credit, shown on cards that carry translation text. */
  translationCredit: string | null;
  /** Reports, after layout, whether the content fits inside the card. */
  onFitChange?: (fits: boolean) => void;
  viewRef?: Ref<View>;
};

/**
 * One shareable ayah card, drawn identically at preview size and at export
 * size. It shows only the Quran text, the optional translation, the Surah
 * reference, the "Write your reflection / اكتب خاطرتك" invitation and small
 * Quran Heals branding — never emotion names, the
 * "How this ayah connects" text, reflections or any account data, so a card
 * is the same however the ayah was reached.
 *
 * Text never scales with the system font size: the card is an image with a
 * fixed layout, and the size planner (utils/shareCardLayout.ts) has already
 * chosen sizes that fit. The content block is measured after layout; if it
 * is taller than its area, `onFitChange(false)` asks the sheet to re-plan.
 *
 * A Scenery card draws its photograph (cover-cropped, centred) under a cream
 * overlay, then exactly the same text in the Scenery inks. Nothing is baked
 * into the photograph, so preview and export render it the same way.
 */
export function ShareAyahCard({
  page, format, theme, scenery, onSceneryLoad, width, reference, translationCredit, onFitChange, viewRef,
}: ShareAyahCardProps) {
  const spec = SHARE_CARD_FORMAT_SPECS[format];
  const colors = scenery === null ? SHARE_CARD_THEMES[theme] : SCENERY_CARD_THEME;
  const s = width / SHARE_CARD_DESIGN_WIDTH;
  const height = Math.round(spec.height * s * 1000) / 1000;
  const isPaged = page.pageCount > 1;

  const available = useRef<number | null>(null);
  const natural = useRef<number | null>(null);
  const report = () => {
    if (available.current === null || natural.current === null) return;
    onFitChange?.(natural.current <= available.current + 1);
  };
  const onAreaLayout = (event: LayoutChangeEvent) => {
    available.current = event.nativeEvent.layout.height;
    report();
  };
  const onContentLayout = (event: LayoutChangeEvent) => {
    natural.current = event.nativeEvent.layout.height;
    report();
  };

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={{ backgroundColor: colors.background, height, overflow: 'hidden', width }}>
      {scenery !== null && (
        // Keyed by photograph: a new one mounts a new Image, so a late load
        // event from the previous photograph can never mark this one ready.
        <SceneryBackdrop key={scenery} scenery={scenery} spec={spec} width={width} height={height} onLoad={onSceneryLoad} />
      )}
      <View
        style={{
          borderColor: colors.frame,
          borderRadius: M.frameRadius * s,
          borderWidth: Math.max(1, M.frameWidth * s),
          bottom: M.frameInset * s,
          left: M.frameInset * s,
          position: 'absolute',
          right: M.frameInset * s,
          top: M.frameInset * s,
        }}
      />

      <View
        onLayout={onAreaLayout}
        style={{
          bottom: (spec.paddingBottom + SHARE_CARD_FOOTER_HEIGHT + M.footerGap) * s,
          justifyContent: 'center',
          left: spec.paddingX * s,
          overflow: 'hidden',
          position: 'absolute',
          right: spec.paddingX * s,
          top: spec.paddingTop * s,
        }}>
        <View onLayout={onContentLayout}>
          {isPaged && (
            <Text
              allowFontScaling={false}
              style={{
                color: colors.reference,
                fontSize: M.pageIndicatorFontSize * s,
                fontWeight: '600',
                letterSpacing: 2 * s,
                lineHeight: M.pageIndicatorHeight * s,
                marginBottom: M.pageIndicatorGap * s,
                textAlign: 'center',
                writingDirection: 'ltr',
              }}>
              {`${page.pageNumber} / ${page.pageCount}`}
            </Text>
          )}

          {page.arabic !== null && (
            <Text
              allowFontScaling={false}
              style={{
                color: colors.arabic,
                fontSize: page.arabicFontSize * s,
                fontWeight: '600',
                letterSpacing: 0,
                lineHeight: arabicLineHeight(page.arabicFontSize) * s,
                textAlign: 'center',
                writingDirection: 'rtl',
              }}>
              {page.arabic}
            </Text>
          )}

          {page.arabic !== null && page.translation !== null && (
            <View
              style={{
                alignSelf: 'center',
                backgroundColor: colors.divider,
                borderRadius: M.dividerThickness * s,
                height: M.dividerThickness * s,
                marginVertical: M.dividerGap * s,
                opacity: 0.7,
                width: M.dividerWidth * s,
              }}
            />
          )}

          {page.translation !== null && (
            <Text
              allowFontScaling={false}
              style={{
                color: colors.translation,
                fontSize: page.translationFontSize * s,
                lineHeight: translationLineHeight(page.translationFontSize) * s,
                textAlign: 'center',
                writingDirection: 'ltr',
              }}>
              {page.translation}
            </Text>
          )}

          {/* Fixed "English · S:A · Arabic" order in every language — see formatAyahReference. */}
          <Text
            allowFontScaling={false}
            style={{
              color: colors.reference,
              fontSize: M.referenceFontSize * s,
              fontWeight: '700',
              lineHeight: M.referenceLineHeight * s,
              marginTop: M.referenceGap * s,
              textAlign: 'center',
              writingDirection: 'ltr',
            }}>
            {reference}
          </Text>

          {/* Decorative only: a hairline, a small leaf, a hairline. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="share-card-ornament"
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              gap: 14 * s,
              height: M.ornamentHeight * s,
              justifyContent: 'center',
              marginTop: M.ornamentGap * s,
              opacity: 0.75,
            }}>
            <View style={{ backgroundColor: colors.divider, height: Math.max(1, M.ornamentLineThickness * s), width: M.ornamentLineWidth * s }} />
            <Leaf size={M.ornamentHeight * s} color={colors.divider} strokeWidth={1.5} />
            <View style={{ backgroundColor: colors.divider, height: Math.max(1, M.ornamentLineThickness * s), width: M.ornamentLineWidth * s }} />
          </View>
        </View>
      </View>

      <View
        style={{
          alignItems: 'center',
          bottom: spec.paddingBottom * s,
          gap: M.footerInnerGap * s,
          left: spec.paddingX * s,
          position: 'absolute',
          right: spec.paddingX * s,
        }}>
        {/* An invitation, not a control: the image is never tappable. It
            refers to the app's existing Add Reflection action. Both
            languages on every card; fixed English · Arabic order. */}
        <View
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            gap: 14 * s,
            justifyContent: 'center',
            marginBottom: (M.invitationGap - M.footerInnerGap) * s,
          }}>
          <PenLine size={M.invitationFontSize * s} color={colors.reference} strokeWidth={1.5} />
          <Text allowFontScaling={false} style={[invitationStyle(colors.reference, s), { writingDirection: 'ltr' }]}>
            {REFLECTION_INVITATION.en}
          </Text>
          <View style={{ backgroundColor: colors.divider, borderRadius: 4 * s, height: 6 * s, opacity: 0.8, width: 6 * s }} />
          <Text allowFontScaling={false} style={[invitationStyle(colors.reference, s), { writingDirection: 'rtl' }]}>
            {REFLECTION_INVITATION.ar}
          </Text>
        </View>
        <Text
          allowFontScaling={false}
          style={{
            color: colors.branding,
            fontSize: M.brandFontSize * s,
            fontWeight: '600',
            letterSpacing: 6 * s,
            lineHeight: M.brandLineHeight * s,
            textAlign: 'center',
          }}>
          {SHARE_CARD_BRAND.toUpperCase()}
        </Text>
        <View>
          <Text
            allowFontScaling={false}
            style={{ color: colors.branding, fontSize: M.attributionFontSize * s, lineHeight: M.attributionLineHeight * s, textAlign: 'center' }}>
            {QURAN_TEXT_CARD_ATTRIBUTION}
          </Text>
          {page.translation !== null && translationCredit !== null && (
            <Text
              allowFontScaling={false}
              style={{ color: colors.branding, fontSize: M.attributionFontSize * s, lineHeight: M.attributionLineHeight * s, textAlign: 'center' }}>
              {`Translation: ${translationCredit}`}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

/** How far, in design units, the full-strength overlay reaches beyond the card's content padding before fading. */
const SCENERY_OVERLAY_SPILL = 60;

/**
 * The photograph and its cream overlay. The overlay is at full strength
 * (overlayOpacity, computed per photograph for text contrast) over the whole
 * text area and fades to sceneryEdgeOpacity() towards the top and bottom
 * edges, where no text is drawn.
 */
function SceneryBackdrop({ scenery, spec, width, height, onLoad }: {
  scenery: ShareCardSceneryId;
  spec: ShareCardFormatSpec;
  width: number;
  height: number;
  onLoad?: (loaded: boolean) => void;
}) {
  const gradientId = `qh-scenery-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const { overlayOpacity } = sceneryById(scenery);
  const edgeOpacity = sceneryEdgeOpacity(overlayOpacity);
  const fullFrom = Math.max(spec.paddingTop - SCENERY_OVERLAY_SPILL, 0) / spec.height;
  const fullTo = Math.min(spec.height - spec.paddingBottom + SCENERY_OVERLAY_SPILL, spec.height) / spec.height;
  const layer = { height, left: 0, position: 'absolute' as const, top: 0, width };
  return (
    <>
      <Image
        source={SHARE_CARD_SCENERY_IMAGES[scenery]}
        resizeMode="cover"
        // Android fades images in by default; a capture mid-fade would differ from the preview.
        fadeDuration={0}
        onLoad={() => onLoad?.(true)}
        onError={() => onLoad?.(false)}
        style={layer}
      />
      <Svg pointerEvents="none" width={width} height={height} style={layer}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={SHARE_CARD_SCENERY_OVERLAY_COLOR} stopOpacity={edgeOpacity} />
            <Stop offset={fullFrom} stopColor={SHARE_CARD_SCENERY_OVERLAY_COLOR} stopOpacity={overlayOpacity} />
            <Stop offset={fullTo} stopColor={SHARE_CARD_SCENERY_OVERLAY_COLOR} stopOpacity={overlayOpacity} />
            <Stop offset={1} stopColor={SHARE_CARD_SCENERY_OVERLAY_COLOR} stopOpacity={edgeOpacity} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${gradientId})`} />
      </Svg>
    </>
  );
}

function invitationStyle(color: string, s: number) {
  return {
    color,
    fontSize: M.invitationFontSize * s,
    fontWeight: '600' as const,
    lineHeight: M.invitationLineHeight * s,
    textAlign: 'center' as const,
  };
}
