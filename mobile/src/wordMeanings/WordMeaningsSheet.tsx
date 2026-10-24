import { FlatList, StyleSheet, Text, View } from 'react-native';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { fill } from '@/localization/fill';
import { FeatureSheet } from '@/mushafFeatures/FeatureSheet';

import type { WordMeaning } from './dataset';
import type { WordMeaningsLabels } from './labels';

type Props = {
  visible: boolean;
  /** The page whose meanings are shown (the page being read when it opened). */
  page: number;
  /** That page's entries in the source's order, or null when this build has no dataset. */
  entries: readonly WordMeaning[] | null;
  labels: WordMeaningsLabels;
  dark: boolean;
  /** The App Language's direction, for the header; the meanings themselves are Arabic, always right to left. */
  rtl: boolean;
  formatNumber: (n: number) => string;
  surahName: (surah: number) => string;
  onClose: () => void;
};

/**
 * المعاني's sheet: the page's selected words and their short meanings from «الميسر في غريب القرآن الكريم», in the
 * source's order and words, scrolling when long. In the reader's feature sheet (mushafFeatures/FeatureSheet.tsx): closed
 * by a downward swipe on it or outside it, a tap outside it, the close button or Back; the list keeps its own scrolling,
 * and the page under the sheet receives no gesture while it is open. Opening or closing it changes nothing else: no
 * ورد, Khatma, last browsed page or other reading data.
 */
export function WordMeaningsSheet({ visible, page, entries, labels, dark, rtl, formatNumber, surahName, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const header = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;

  const reference = (e: WordMeaning) => fill(e.ayahEnd !== e.ayah ? labels.ayahRangeReference : labels.ayahReference, {
    surah: surahName(e.surah), s: formatNumber(e.surah), ayah: formatNumber(e.ayah), end: formatNumber(e.ayahEnd),
  });
  const renderEntry = ({ item }: { item: WordMeaning }) => (
    <View testID={`word-meanings-entry-${item.id}`} style={[styles.entry, { borderBottomColor: theme.divider }]}>
      <Text style={[styles.word, { color: theme.text }]}>{item.word}</Text>
      <Text style={[styles.explanation, { color: theme.text }]}>{item.explanation}</Text>
      <Text style={[styles.reference, { color: theme.muted }, header]}>{reference(item)}</Text>
    </View>
  );

  return (
    <FeatureSheet
      id="word-meanings"
      visible={visible}
      title={labels.title}
      subtitle={fill(labels.page, { n: formatNumber(page) })}
      closeLabel={labels.close}
      dark={dark}
      rtl={rtl}
      onClose={onClose}>
      {entries === null ? (
        <Text testID="word-meanings-unavailable" style={[styles.message, { color: theme.muted }]}>{labels.unavailable}</Text>
      ) : (
        <FlatList
          testID="word-meanings-list"
          data={entries as WordMeaning[]}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderEntry}
          initialNumToRender={10}
          windowSize={7}
          ListEmptyComponent={<Text testID="word-meanings-empty" style={[styles.message, { color: theme.muted }]}>{labels.empty}</Text>}
          ListFooterComponent={(
            <View style={styles.footer}>
              {labels.arabicOnlyNote ? <Text testID="word-meanings-arabic-only" style={[styles.note, { color: theme.muted }, header]}>{labels.arabicOnlyNote}</Text> : null}
              <Text testID="word-meanings-source" style={[styles.note, { color: theme.muted }, header]}>{labels.sourceLine}</Text>
            </View>
          )}
          style={styles.list}
        />
      )}
    </FeatureSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  entry: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 12,
  },
  // The source's Quranic word, as it writes it (King Fahd's Uthmani encoding), in the system's Arabic font as the
  // app's other ayah text.
  word: {
    fontSize: 21,
    fontWeight: '600',
    lineHeight: 34,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  explanation: {
    fontSize: 16,
    lineHeight: 27,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  reference: {
    fontSize: 12,
  },
  message: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
  footer: {
    gap: 6,
    paddingBottom: 8,
    paddingTop: 14,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
  },
});
