import { Heart } from 'lucide-react-native';
import { Pressable, StyleSheet } from 'react-native';

import { radii, type Palette } from '@/constants/theme';
import { useAppLocale } from '@/localization/useAppLocale';
import { usePalette, useThemedStyles } from '@/theme/useTheme';

type FavoriteButtonProps = {
  isSaved: boolean;
  onToggle: () => void;
};

/** Icon-only save/unsave toggle — the accessibility label still carries the save/saved distinction even though no visible text remains. */
export function FavoriteButton({ isSaved, onToggle }: FavoriteButtonProps) {
  const { messages } = useAppLocale();
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isSaved ? messages.favoriteButton.removeLabel : messages.favoriteButton.saveLabel}
      accessibilityState={{ selected: isSaved }}
      onPress={onToggle}
      style={({ pressed }) => [styles.button, isSaved && styles.saved, pressed && styles.pressed]}>
      <Heart size={20} color={isSaved ? colors.onAccentFill : colors.icon} fill={isSaved ? colors.onAccentFill : 'transparent'} />
    </Pressable>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.full,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  saved: {
    backgroundColor: colors.accentFill,
    borderColor: colors.accentFill,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});
