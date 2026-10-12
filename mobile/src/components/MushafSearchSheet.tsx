import { ArrowLeft, ArrowRight, X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { searchSurahs, type SurahEntry } from '@/mushaf/surahSearch';

export type MushafSearchMode = 'page' | 'surah';

type Labels = {
  title: string;
  close: string;
  byPage: string;
  bySurah: string;
  pageNumber: string;
  go: string;
  goToPage: string;
  surahSearch: string;
  noResults: string;
  page: string;
};

type MushafSearchSheetProps = {
  visible: boolean;
  labels: Labels;
  dark: boolean;
  rtl: boolean;
  formatNumber: (n: number) => string;
  onClose: () => void;
  /** Page search: the typed text; returns an error to show, or null once it went there. */
  onGoToPage: (input: string) => string | null;
  /** Surah search: opens the page holding the Surah's first ayah. */
  onSelectSurah: (surah: SurahEntry) => void;
};

/** Every Surah row has this height, so the list can be virtualised cheaply. */
const ROW_HEIGHT = 58;

/**
 * The Mushaf's one search (the bar's search button), as a keyboard-aware
 * sheet with two modes:
 * - Page Number: one numeric field (Western or Arabic-Indic digits, 1–604)
 *   and a Go button.
 * - Surah Name: a search field over the list of all 114 Surahs in Quran
 *   order (number, Arabic and English name, first page), filtered as the
 *   reader types (mushaf/surahSearch.ts). Rows stay tappable with the
 *   keyboard open.
 * Going somewhere only navigates: nothing is saved, no stop or progress is
 * changed. The sheet closes after a successful jump, on its close button, a
 * tap on the dimmed backdrop, or Back.
 */
export function MushafSearchSheet(props: MushafSearchSheetProps) {
  const { labels, dark, rtl, formatNumber } = props;
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  const { height: windowHeight } = useWindowDimensions();
  const [mode, setMode] = useState<MushafSearchMode>('page');
  const [pageInput, setPageInput] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchSurahs(query), [query]);
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const row = rtl ? styles.rowRtl : styles.row;

  const close = () => {
    Keyboard.dismiss();
    props.onClose();
  };
  const go = () => {
    const error = props.onGoToPage(pageInput);
    setPageError(error);
    if (!error) setPageInput('');
  };
  const segment = (key: MushafSearchMode, label: string) => {
    const selected = mode === key;
    return (
      <Pressable
        key={key}
        testID={`mushaf-search-mode-${key}`}
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => setMode(key)}
        style={[styles.segment, selected && theme.segmentSelected]}>
        <Text style={[styles.segmentText, { color: selected ? theme.onSegmentSelected : theme.text }]}>{label}</Text>
      </Pressable>
    );
  };

  const renderSurah = ({ item }: { item: SurahEntry }) => {
    const page = `${labels.page} ${formatNumber(item.startPage)}`;
    return (
      <Pressable
        testID={`mushaf-surah-${item.surahNumber}`}
        accessibilityRole="button"
        accessibilityLabel={`${formatNumber(item.surahNumber)}. ${item.nameArabic}, ${item.nameEnglish}, ${page}`}
        onPress={() => props.onSelectSurah(item)}
        style={({ pressed }) => [styles.surah, row, { borderBottomColor: theme.divider }, pressed && theme.selected]}>
        <Text style={[styles.surahNumber, { color: theme.accent }]}>{formatNumber(item.surahNumber)}</Text>
        <View style={styles.surahNames}>
          <Text numberOfLines={1} style={[styles.surahArabic, { color: theme.text }, align]}>{item.nameArabic}</Text>
          <Text numberOfLines={1} style={[styles.surahEnglish, { color: theme.muted }, align]}>{item.nameEnglish}</Text>
        </View>
        <Text style={[styles.surahPage, { color: theme.muted }]}>{page}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView style={[styles.backdrop, { backgroundColor: theme.backdrop }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        {/* The dimmed space above the sheet closes it. */}
        <Pressable testID="mushaf-search-backdrop" accessibilityLabel={labels.close} style={styles.dismissArea} onPress={close} />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView edges={['bottom', 'left', 'right']} testID="mushaf-search-sheet" style={[styles.sheet, theme.sheet, mode === 'surah' && { height: Math.min(600, windowHeight * 0.78) }]}>
            <View style={[styles.header, row]}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }, align]}>{labels.title}</Text>
              <Pressable testID="mushaf-search-close" accessibilityRole="button" accessibilityLabel={labels.close} onPress={close} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <X size={20} color={theme.icon} />
              </Pressable>
            </View>

            <View accessibilityRole="tablist" style={[styles.segments, row, theme.segments]}>
              {segment('page', labels.byPage)}
              {segment('surah', labels.bySurah)}
            </View>

            {mode === 'page' ? (
              <View style={styles.pageMode}>
                <View style={[styles.inputRow, row]}>
                  <TextInput
                    testID="mushaf-search-page-input"
                    value={pageInput}
                    onChangeText={(text) => { setPageInput(text); setPageError(null); }}
                    placeholder={labels.pageNumber}
                    placeholderTextColor={theme.placeholder}
                    accessibilityLabel={labels.pageNumber}
                    keyboardType="number-pad"
                    returnKeyType="go"
                    maxLength={4}
                    autoFocus
                    onSubmitEditing={go}
                    style={[styles.input, styles.pageInput, theme.input, align]}
                  />
                  <Pressable
                    testID="mushaf-search-go"
                    accessibilityRole="button"
                    accessibilityLabel={labels.goToPage}
                    onPress={go}
                    style={({ pressed }) => [styles.go, theme.go, pressed && styles.pressed]}>
                    {/* Icon only (its label is spoken): the page number gets the row. Points forward in the reading
                        direction: its own left arrow right to left (a mirrored SVG flipped out of view on the web). */}
                    {rtl ? <ArrowLeft size={22} strokeWidth={2.4} color={theme.onGo} /> : <ArrowRight size={22} strokeWidth={2.4} color={theme.onGo} />}
                  </Pressable>
                </View>
                {pageError && <Text accessibilityLiveRegion="polite" style={[styles.error, { color: theme.error }, align]}>{pageError}</Text>}
              </View>
            ) : (
              <View style={styles.surahMode}>
                <TextInput
                  testID="mushaf-search-surah-input"
                  value={query}
                  onChangeText={setQuery}
                  placeholder={labels.surahSearch}
                  placeholderTextColor={theme.placeholder}
                  accessibilityLabel={labels.surahSearch}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  style={[styles.input, theme.input, align]}
                />
                <FlatList
                  testID="mushaf-surah-list"
                  data={results}
                  keyExtractor={(item) => String(item.surahNumber)}
                  renderItem={renderSurah}
                  getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
                  initialNumToRender={14}
                  windowSize={7}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  ListEmptyComponent={<Text testID="mushaf-surah-empty" style={[styles.empty, { color: theme.muted }]}>{labels.noResults}</Text>}
                  style={styles.list}
                />
              </View>
            )}
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  dismissArea: {
    flex: 1,
  },
  sheet: {
    alignSelf: 'center',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    // With the keyboard open, the Surah list's sheet shrinks to the space left above it.
    flexShrink: 1,
    maxWidth: 560,
    paddingBottom: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    width: '100%',
  },
  row: {
    flexDirection: 'row',
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  header: {
    alignItems: 'center',
    minHeight: 44,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '700',
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  segments: {
    borderRadius: 12,
    gap: 4,
    marginBottom: 12,
    padding: 3,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 38,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pageMode: {
    gap: 8,
  },
  inputRow: {
    alignItems: 'center',
    gap: 8,
  },
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    height: 46,
    paddingHorizontal: 12,
  },
  // A compact square: still a full 46-pt touch target.
  go: {
    alignItems: 'center',
    borderRadius: 14,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  error: {
    fontSize: 13,
    paddingHorizontal: 4,
  },
  surahMode: {
    flex: 1,
    gap: 8,
  },
  pageInput: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  surah: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    height: ROW_HEIGHT,
    paddingHorizontal: 6,
  },
  surahNumber: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    width: 30,
  },
  surahNames: {
    flex: 1,
    gap: 1,
  },
  surahArabic: {
    fontSize: 17,
    fontWeight: '700',
  },
  surahEnglish: {
    fontSize: 13,
  },
  surahPage: {
    fontSize: 13,
  },
  empty: {
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
