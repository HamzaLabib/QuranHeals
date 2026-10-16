import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, TouchableWithoutFeedback, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MUSHAF_PANEL_COLORS } from '@/constants/mushafTheme';
import { fill } from '@/localization/fill';
import { HIZB_COUNT, HIZB_START_PAGES, JUZ_COUNT, JUZ_START_PAGES, searchNumbered } from '@/mushaf/navigation';
import { searchSurahs, SURAHS } from '@/mushaf/surahSearch';
import { useKeyboardAvoidingKey } from '@/layout/useDismissKeyboardOnResize';

export type MushafIndexMode = 'surah' | 'juz' | 'hizb';

type Labels = {
  close: string;
  page: string;
  noResults: string;
  surahTitle: string;
  juzTitle: string;
  hizbTitle: string;
  surahSearch: string;
  juzSearch: string;
  hizbSearch: string;
  /** "Juz' {n}" / "الجزء {n}". */
  juzName: string;
  /** "Hizb {n}" / "الحزب {n}". */
  hizbName: string;
};

type Props = {
  /** Which list is open; null: closed. */
  mode: MushafIndexMode | null;
  labels: Labels;
  dark: boolean;
  rtl: boolean;
  formatNumber: (n: number) => string;
  /** The current Surah / juz' / Hizb, marked and scrolled to. */
  current?: number;
  /** Opens that page (the division's first page); the sheet then closes. */
  onSelectPage: (page: number) => void;
  onClose: () => void;
};

type Row = { key: string; number: number; primary: string; secondary?: string; page: number };

const ROW_HEIGHT = 58;

/**
 * The reader's Surah, juz' and Hizb lists, opened by tapping the page's Surah name, juz' or Hizb label: searchable,
 * each row opening the page its division begins on (Surahs that begin partway down a page open that page; the layout
 * is never changed). Surahs: all 114 by Arabic or English name, or number (mushaf/surahSearch.ts). Juz' (30) and
 * Hizb (60, whole Hizbs only, never quarter markers): by number. The search sheet's own look (design-archive/
 * mushaf-navigation-v1/: MushafSearchSheet), its field in the reader's field colours; a tap on the dimmed space, the
 * close button or Back closes it.
 */
export function MushafIndexSheet({ mode, labels, dark, rtl, formatNumber, current, onSelectPage, onClose }: Props) {
  const theme = dark ? MUSHAF_PANEL_COLORS.dark : MUSHAF_PANEL_COLORS.light;
  // Measured afresh after a rotation or resize (layout/useDismissKeyboardOnResize.ts).
  const keyboardKey = useKeyboardAvoidingKey(mode !== null);
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState('');
  // A new list starts with an empty search.
  const [openedMode, setOpenedMode] = useState<MushafIndexMode | null>(null);
  if (mode !== openedMode) {
    setOpenedMode(mode);
    setQuery('');
  }
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  const row = rtl ? styles.rowRtl : styles.row;

  const rows = useMemo<Row[]>(() => {
    if (mode === 'surah') {
      return searchSurahs(query).map((s) => ({ key: `s${s.surahNumber}`, number: s.surahNumber, primary: s.nameArabic, secondary: s.nameEnglish, page: s.startPage }));
    }
    if (mode === 'juz') return searchNumbered(query, JUZ_COUNT).map((n) => ({ key: `j${n}`, number: n, primary: fill(labels.juzName, { n: formatNumber(n) }), page: JUZ_START_PAGES[n - 1] }));
    if (mode === 'hizb') return searchNumbered(query, HIZB_COUNT).map((n) => ({ key: `h${n}`, number: n, primary: fill(labels.hizbName, { n: formatNumber(n) }), page: HIZB_START_PAGES[n - 1] }));
    return [];
  }, [mode, query, labels.juzName, labels.hizbName, formatNumber]);
  // Opened unfiltered: start at the current one.
  const initialIndex = query === '' && current !== undefined ? Math.max(0, rows.findIndex((r) => r.number === current)) : 0;

  const close = () => {
    Keyboard.dismiss();
    onClose();
  };
  const title = mode === 'juz' ? labels.juzTitle : mode === 'hizb' ? labels.hizbTitle : labels.surahTitle;
  const placeholder = mode === 'juz' ? labels.juzSearch : mode === 'hizb' ? labels.hizbSearch : labels.surahSearch;
  const fullCount = mode === 'surah' ? SURAHS.length : mode === 'juz' ? JUZ_COUNT : HIZB_COUNT;

  const renderRow = ({ item }: { item: Row }) => {
    const page = `${labels.page} ${formatNumber(item.page)}`;
    const selected = item.number === current;
    return (
      <Pressable
        testID={`mushaf-index-${mode}-${item.number}`}
        accessibilityRole="button"
        accessibilityLabel={[mode === 'surah' ? `${formatNumber(item.number)}. ${item.primary}` : item.primary, item.secondary, page].filter(Boolean).join(', ')}
        accessibilityState={{ selected }}
        onPress={() => {
          Keyboard.dismiss();
          onSelectPage(item.page);
        }}
        style={({ pressed }) => [styles.item, row, { borderBottomColor: theme.divider }, (pressed || selected) && theme.selected]}>
        {mode === 'surah' && <Text style={[styles.itemNumber, { color: theme.accent }]}>{formatNumber(item.number)}</Text>}
        <View style={styles.itemNames}>
          <Text numberOfLines={1} style={[styles.itemPrimary, { color: theme.text }, align]}>{item.primary}</Text>
          {item.secondary ? <Text numberOfLines={1} style={[styles.itemSecondary, { color: theme.muted }, align]}>{item.secondary}</Text> : null}
        </View>
        <Text style={[styles.itemPage, { color: theme.muted }]}>{page}</Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView key={keyboardKey} style={[styles.backdrop, { backgroundColor: theme.backdrop }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        <Pressable testID="mushaf-index-backdrop" accessibilityLabel={labels.close} style={styles.dismissArea} onPress={close} />
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView edges={['bottom', 'left', 'right']} testID="mushaf-index-sheet" style={[styles.sheet, theme.sheet, { height: Math.min(mode === 'surah' ? 600 : 520, windowHeight * 0.72) }]}>
            <View style={[styles.header, row]}>
              <Text accessibilityRole="header" style={[styles.title, { color: theme.text }, align]}>{title}</Text>
              <Pressable testID="mushaf-index-close" accessibilityRole="button" accessibilityLabel={labels.close} onPress={close} hitSlop={8} style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}>
                <X size={20} color={theme.icon} />
              </Pressable>
            </View>
            <TextInput
              testID="mushaf-index-search"
              value={query}
              onChangeText={setQuery}
              placeholder={placeholder}
              placeholderTextColor={theme.placeholder}
              accessibilityLabel={placeholder}
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType={mode === 'surah' ? 'default' : 'number-pad'}
              returnKeyType="search"
              style={[styles.input, theme.input, align]}
            />
            <FlatList
              key={`${mode}-${fullCount}`}
              testID="mushaf-index-list"
              data={rows}
              keyExtractor={(item) => item.key}
              renderItem={renderRow}
              getItemLayout={(_data, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
              initialScrollIndex={initialIndex}
              initialNumToRender={14}
              windowSize={7}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={<Text testID="mushaf-index-empty" style={[styles.empty, { color: theme.muted }]}>{labels.noResults}</Text>}
              style={styles.list}
            />
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The search sheet's own styles (MushafSearchSheet), so the reader's lists look as before. */
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
    flexShrink: 1,
    gap: 8,
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
  input: {
    borderRadius: 14,
    borderWidth: 1,
    fontSize: 16,
    height: 46,
    paddingHorizontal: 12,
  },
  list: {
    flex: 1,
  },
  item: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    height: ROW_HEIGHT,
    paddingHorizontal: 6,
  },
  itemNumber: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    width: 30,
  },
  itemNames: {
    flex: 1,
    gap: 1,
  },
  itemPrimary: {
    fontSize: 17,
    fontWeight: '700',
  },
  itemSecondary: {
    fontSize: 13,
  },
  itemPage: {
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
