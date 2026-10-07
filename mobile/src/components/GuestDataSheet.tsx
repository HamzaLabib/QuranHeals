import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getDirectionStyle, isRtlLocale } from '@/localization/locales';
import { useAppLocale } from '@/localization/useAppLocale';
import { useThemedStyles } from '@/theme/useTheme';
import { makeSyncPasswordStyles } from './SyncPassphraseSheet';

export type GuestDataChoice = 'add' | 'keep-separate';

type GuestDataSheetProps = {
  visible: boolean;
  onChoose: (choice: GuestDataChoice) => void;
};

/**
 * Asked after signing in when favorites or reflections were saved on this
 * device as a guest: guest data never joins an account without this
 * explicit choice (see storage/localDataOwnership.ts). A required decision
 * like the Sync Password step — no backdrop/Back dismissal, since leaving
 * the question unanswered would leave the account's sync waiting.
 */
export function GuestDataSheet({ visible, onChoose }: GuestDataSheetProps) {
  const styles = useThemedStyles(makeSyncPasswordStyles);
  const { locale, messages } = useAppLocale();
  const direction = getDirectionStyle(locale);
  const isRtl = isRtlLocale(locale);
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
              <Text style={[styles.title, direction]}>{messages.guestData.title}</Text>
              <Text style={[styles.description, direction]}>{messages.guestData.body}</Text>
              <View style={[styles.actions, isRtl && styles.actionsRtl]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={messages.guestData.keepSeparate}
                  onPress={() => onChoose('keep-separate')}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
                  <Text style={styles.secondaryButtonText}>{messages.guestData.keepSeparate}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={messages.guestData.add}
                  onPress={() => onChoose('add')}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
                  <Text style={styles.primaryButtonText}>{messages.guestData.add}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
