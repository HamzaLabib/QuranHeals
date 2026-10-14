import { Link } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette } from '@/theme/useTheme';

/**
 * The Settings shortcut in a screen's top header: Home's gear, shared. Opens the
 * existing /settings screen above the current one, so its Back returns here.
 *
 * Placed as the header row's last item: the row is mirrored in Arabic and its
 * title takes the remaining width, so the gear sits at the far end, opposite
 * Back, in both languages. It takes the host screen's own icon-button and
 * pressed styles, so it matches the Back button beside it.
 *
 * Not on the Mushaf reader (kept distraction-free), Settings itself, the
 * دعاء ختم القرآن screen, or modals and sheets. The Khatma completion screen,
 * which has no Back button, shows it alone at its header's far end.
 */
export function SettingsHeaderButton({ style, pressedStyle }: { style: StyleProp<ViewStyle>; pressedStyle?: StyleProp<ViewStyle> }) {
  const colors = usePalette();
  const { messages } = useAppLocale();
  return (
    <Link href="/settings" asChild>
      <Pressable
        testID="header-settings"
        accessibilityRole="button"
        accessibilityLabel={messages.settings.openSettings}
        style={({ pressed }) => [style, pressed && pressedStyle]}>
        <Settings size={20} color={colors.icon} strokeWidth={2} />
      </Pressable>
    </Link>
  );
}
