import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';

export function SyncPasswordField({ value, onChangeText, label, editable = true, onBlur }: {
  value: string;
  onChangeText: (value: string) => void;
  label: string;
  editable?: boolean;
  onBlur?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const toggle = visible ? messages.syncPassphrase.hide : messages.syncPassphrase.show;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, direction]}>{label}</Text>
      <View style={[styles.row, isRtlLocale(locale) && styles.rtl]}>
        <TextInput value={value} onChangeText={onChangeText} onBlur={onBlur}
          placeholder={label} accessibilityLabel={label} placeholderTextColor={colors.muted}
          secureTextEntry={!visible} autoCapitalize="none" autoCorrect={false}
          spellCheck={false} editable={editable} returnKeyType="done"
          onSubmitEditing={() => Keyboard.dismiss()} style={[styles.input, direction]} />
        <Pressable accessibilityRole="button" accessibilityLabel={`${toggle}: ${label}`}
          accessibilityState={{ expanded: visible }} onPress={() => setVisible((shown) => !shown)} style={styles.toggle}>
          <Text style={styles.label}>{toggle}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.parchment,
    borderColor: colors.border, borderRadius: radii.md, borderWidth: 1 },
  rtl: { flexDirection: 'row-reverse' },
  label: { color: colors.ink, fontSize: typography.caption },
  input: { flex: 1, minWidth: 0, minHeight: 52, paddingHorizontal: spacing.md, color: colors.ink, fontSize: typography.body },
  toggle: { minHeight: 48, minWidth: 48, paddingHorizontal: spacing.md, justifyContent: 'center', alignItems: 'center' },
});
