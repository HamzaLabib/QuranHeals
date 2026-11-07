import { X } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { radii, spacing, typography, type Palette } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale, type AppLocale } from '@/localization/locales';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

import { cityLabel, loadCities, searchCities, type City } from './cities';
import type { Messages } from '@/localization/messages';

type Props = {
  visible: boolean;
  locale: AppLocale;
  messages: Messages['qibla'];
  onSelect: (city: City) => void;
  onClose: () => void;
};

/**
 * "Choose a city": the offline list (assets/qibla/cities.json), searched as the user types, in English or Arabic. The
 * list is loaded the first time the sheet opens. Picking a city gives the Qibla bearing for its centre; the screen saves
 * only its ID, on this device.
 */
export function QiblaCityPicker({ visible, locale, messages, onSelect, onClose }: Props) {
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const direction = getDirectionStyle(locale);
  const rtl = isRtlLocale(locale);
  const [query, setQuery] = useState('');
  const results = useMemo(() => (visible ? searchCities(query, 60, loadCities()) : []), [visible, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.header, rtl && styles.rowRtl]}>
          <Text accessibilityRole="header" style={[styles.title, direction]}>{messages.pickerTitle}</Text>
          <Pressable
            testID="qibla-city-close"
            accessibilityRole="button"
            accessibilityLabel={messages.close}
            onPress={onClose}
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
            <X size={22} color={colors.icon} />
          </Pressable>
        </View>
        <TextInput
          testID="qibla-city-search"
          value={query}
          onChangeText={setQuery}
          placeholder={messages.searchPlaceholder}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={messages.searchPlaceholder}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={[styles.search, direction]}
        />
        <Text style={[styles.note, direction]}>{messages.pickerNote}</Text>
        <FlatList
          data={results}
          keyExtractor={(city) => String(city.id)}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={<Text style={[styles.empty, direction]}>{messages.noResults}</Text>}
          renderItem={({ item }) => (
            <Pressable
              testID={`qibla-city-${item.id}`}
              accessibilityRole="button"
              onPress={() => onSelect(item)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <Text style={[styles.rowText, direction]}>{cityLabel(item, locale)}</Text>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { backgroundColor: colors.sheetBackground, flex: 1 },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowRtl: { flexDirection: 'row-reverse' },
  title: { color: colors.textPrimary, flex: 1, fontSize: typography.bodyLarge, fontWeight: '700' },
  close: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  search: {
    backgroundColor: colors.fieldBackground,
    borderColor: colors.fieldBorder,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    marginHorizontal: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  note: { color: colors.textMuted, fontSize: typography.small, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  row: { borderBottomColor: colors.divider, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.lg },
  rowText: { color: colors.textPrimary, fontSize: typography.body },
  empty: { color: colors.textSecondary, fontSize: typography.body, padding: spacing.lg },
  pressed: { opacity: 0.75 },
});
