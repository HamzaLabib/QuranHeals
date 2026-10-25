import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { fill } from '@/localization/fill';
import { FeatureSheet } from '@/mushafFeatures/FeatureSheet';

import { shownStatus, type SurahPreviewEntry } from './dataset';
import type { SurahPreviewLabels } from './labels';

type Props = {
  visible: boolean;
  /** The Surahs beginning on the page it was opened on (one or more), and the one shown. */
  surahs: readonly number[];
  selected: number;
  onSelect: (surah: number) => void;
  /** The shown Surah's entry and its language; null when this build has no dataset (or no valid entry for it). */
  entry: SurahPreviewEntry | null;
  language: 'ar' | 'en';
  labels: SurahPreviewLabels;
  dark: boolean;
  /** The App Language's direction, for the header and the Surah choice. */
  rtl: boolean;
  formatNumber: (n: number) => string;
  surahName: (surah: number) => string;
  onClose: () => void;
};

/**
 * عن السورة's sheet, in the approved order: the Surah's name (centred); Makki or Madani, its number of ayahs and its
 * number; a divider; its main purpose (مقصد السورة); a divider; its main themes (موضوعاتها). Texts are the sources'
 * (credited on Sources, /credits); a section with no usable text says so instead of showing a filler, and one awaiting
 * scholarly review is marked. More than one Surah beginning on the page (e.g. 604): a choice of them above, the first
 * shown. Closed as every feature sheet (FeatureSheet); opening or closing it changes no reading data.
 */
export function SurahPreviewSheet({ visible, surahs, selected, onSelect, entry, language, labels, dark, rtl, formatNumber, surahName, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const ui = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  // The introduction's own direction: Arabic right to left, English left to right, whatever the App Language.
  const body = { textAlign: language === 'ar' ? 'right' : 'left', writingDirection: language === 'ar' ? 'rtl' : 'ltr' } as const;
  // Themes in the introduction's language where that text exists, else the Arabic (with its own direction).
  const themesEnShown = language === 'en' && entry !== null && shownStatus(entry.status.themesEn);
  const themes = entry === null ? null : themesEnShown ? entry.themes.en : shownStatus(entry.status.themesAr) ? entry.themes.ar : null;
  const themesBody = themesEnShown ? body : ({ textAlign: 'right', writingDirection: 'rtl' } as const);
  const centred = { textAlign: 'center', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const divider = <View style={[styles.divider, { backgroundColor: theme.divider }]} />;

  const choice = surahs.length > 1 ? (
    <View style={styles.choice}>
      <Text style={[styles.choiceTitle, { color: theme.muted }, ui]}>{labels.chooseSurah}</Text>
      <View testID="surah-preview-choice" accessibilityRole="tablist" style={[styles.chips, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {surahs.map((surah) => {
          const active = surah === selected;
          return (
            <Pressable
              key={surah}
              testID={`surah-preview-choose-${surah}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={surahName(surah)}
              onPress={() => onSelect(surah)}
              hitSlop={{ top: 6, bottom: 6 }}
              style={({ pressed }) => [styles.chip, theme.segments, active && theme.segmentSelected, pressed && styles.pressed]}>
              <Text numberOfLines={1} style={[styles.chipText, { color: active ? theme.onSegmentSelected : theme.text }]}>{surahName(surah)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  ) : null;

  return (
    <FeatureSheet id="surah-preview" visible={visible} title={labels.title} closeLabel={labels.close} dark={dark} rtl={rtl} onClose={onClose} header={choice}>
      {(
        <ScrollView testID="surah-preview-scroll" style={styles.scroll} contentContainerStyle={styles.content}>
          <Text testID="surah-preview-name" accessibilityRole="header" style={[styles.name, { color: theme.text }, centred]}>{surahName(selected)}</Text>
          {entry === null ? (
            <Text testID="surah-preview-unavailable" style={[styles.message, { color: theme.muted }]}>{labels.unavailable}</Text>
          ) : (
            <>
              <Text testID="surah-preview-facts" style={[styles.facts, { color: theme.muted }, centred]}>
                {[
                  entry.revelation === 'makki' ? labels.makki : labels.madani,
                  labels.ayahCount(entry.ayahCount, formatNumber(entry.ayahCount)),
                  fill(labels.surahNumber, { n: formatNumber(selected) }),
                ].join('  |  ')}
              </Text>
              {divider}
              <Text style={[styles.heading, { color: theme.accent }, ui]}>{labels.purpose}</Text>
              <Text testID="surah-preview-purpose" selectable style={[styles.text, { color: theme.text }, body]}>
                {language === 'en' ? entry.purpose.en : entry.purpose.ar}
              </Text>
              {divider}
              <Text style={[styles.heading, { color: theme.accent }, ui]}>{labels.themes}</Text>
              {themes ? (
                <View testID="surah-preview-themes" style={styles.themes}>
                  {themes.map((item, i) => (
                    <View key={i} style={[styles.themeRow, { flexDirection: themesBody.writingDirection === 'rtl' ? 'row-reverse' : 'row' }]}>
                      <Text style={[styles.text, { color: theme.accent }]}>•</Text>
                      <Text selectable style={[styles.text, styles.themeText, { color: theme.text }, themesBody]}>{item}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text testID="surah-preview-themes-unavailable" style={[styles.note, { color: theme.muted }, ui]}>{labels.themesUnavailable}</Text>
              )}
              {language === 'ar' && labels.arabicOnlyNote ? (
                <View style={styles.footer}>
                  <Text testID="surah-preview-arabic-only" style={[styles.note, { color: theme.muted }, ui]}>{labels.arabicOnlyNote}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </FeatureSheet>
  );
}

const styles = StyleSheet.create({
  choice: {
    gap: 6,
    paddingBottom: 8,
  },
  choiceTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  chips: {
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 14,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  content: {
    gap: 6,
    paddingBottom: 12,
    paddingHorizontal: 4,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
  },
  facts: {
    fontSize: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  heading: {
    fontSize: 14,
    fontWeight: '700',
  },
  text: {
    fontSize: 16,
    lineHeight: 27,
  },
  themes: {
    gap: 2,
  },
  themeRow: {
    gap: 8,
  },
  themeText: {
    flex: 1,
  },
  message: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
  footer: {
    gap: 6,
    paddingTop: 14,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.6,
  },
});
