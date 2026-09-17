import { useEffect, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/useAuth';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { getReflection, REFLECTION_MAX_LENGTH, saveReflection } from '@/storage/ayahReflections';

type ReflectionSheetProps = {
  visible: boolean;
  verseKey: string | null;
  onClose: () => void;
};

/**
 * Private خواطر editor — deliberately never shows Quran Arabic/translation
 * text itself (Part C §12: must not visually compete with it) and never
 * touches Report an Issue's data path (Part I §34). The guest/signed-in
 * note is chosen truthfully from the actual auth status, never claiming
 * sync that hasn't happened (Part C §14).
 */
export function ReflectionSheet({ visible, verseKey, onClose }: ReflectionSheetProps) {
  if (!visible || !verseKey) return null;

  // Keyed by verseKey so opening the sheet for a different ayah remounts
  // this inner component with fresh state, instead of imperatively
  // resetting isLoading/text inside an effect.
  return <ReflectionSheetContent key={verseKey} verseKey={verseKey} onClose={onClose} />;
}

function ReflectionSheetContent({ verseKey, onClose }: { verseKey: string; onClose: () => void }) {
  const { locale, messages } = useAppLocale();
  const { status } = useAuth();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const existing = await getReflection(verseKey).catch(() => null);
      if (!cancelled) {
        setText(existing?.text ?? '');
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [verseKey]);

  const close = () => onClose();

  const save = async () => {
    await saveReflection(verseKey, text);
    onClose();
  };

  const note = status === 'signed-in' ? messages.reflection.syncedNote : messages.reflection.guestNote;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      {/* KeyboardAvoidingView takes over the backdrop's flex/justify styling
          (rather than wrapping a separate flex:1 View around it) so
          `padding`/`height` behavior pushes the sheet — already pinned to
          the bottom via justifyContent: 'flex-end' — up above the keyboard
          without changing its intrinsic (content-sized) height. */}
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Tap outside the TextInput dismisses the keyboard only — Cancel/
            close is still a deliberate, separate button press; this never
            closes the sheet itself. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.sheet}>
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
                <Text style={[styles.title, direction]}>{messages.reflection.title}</Text>
                <Text style={[styles.prompt, direction]}>{messages.reflection.prompt}</Text>
                {!isLoading && (
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    multiline
                    maxLength={REFLECTION_MAX_LENGTH}
                    placeholder={messages.reflection.prompt}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, direction]}
                    accessibilityLabel={messages.reflection.title}
                  />
                )}
                <Text style={[styles.note, direction]}>{note}</Text>
                <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.reflection.cancel}
                    onPress={close}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                    <Text style={styles.secondaryButtonText}>{messages.reflection.cancel}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={messages.reflection.save}
                    onPress={save}
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                    <Text style={styles.primaryButtonText}>{messages.reflection.save}</Text>
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          </SafeAreaView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(31, 42, 36, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  safeArea: {
    maxHeight: '85%',
    width: '100%',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    ...shadows.soft,
  },
  content: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  prompt: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 19,
  },
  input: {
    backgroundColor: colors.parchment,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: typography.body,
    minHeight: 140,
    padding: spacing.md,
    textAlignVertical: 'top',
  },
  note: {
    color: colors.muted,
    fontSize: typography.small,
    lineHeight: 17,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionsRtl: {
    flexDirection: 'row-reverse',
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    flex: 1,
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
  },
});
