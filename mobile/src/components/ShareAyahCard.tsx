import { Leaf, PenLine } from 'lucide-react-native';
import { useRef, type Ref } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';

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
  type ShareCardPage,
} from '@/utils/shareCardLayout';

type ShareAyahCardProps = {
  page: ShareCardPage;
  format: ShareCardFormat;
  theme: ShareCardThemeName;
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
 */
export function ShareAyahCard({ page, format, theme, width, reference, translationCredit, onFitChange, viewRef }: ShareAyahCardProps) {
  const spec = SHARE_CARD_FORMAT_SPECS[format];
  const colors = SHARE_CARD_THEMES[theme];
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

function invitationStyle(color: string, s: number) {
  return {
    color,
    fontSize: M.invitationFontSize * s,
    fontWeight: '600' as const,
    lineHeight: M.invitationLineHeight * s,
    textAlign: 'center' as const,
  };
}
