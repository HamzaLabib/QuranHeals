import { Heart } from 'lucide-react-native';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radii, spacing, typography } from '@/constants/theme';

type FavoriteButtonProps = {
  isSaved: boolean;
  onToggle: () => void;
};

export function FavoriteButton({ isSaved, onToggle }: FavoriteButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isSaved ? 'Remove ayah from favorites' : 'Save ayah to favorites'}
      onPress={onToggle}
      style={({ pressed }) => [styles.button, isSaved && styles.saved, pressed && styles.pressed]}>
      <Heart
        size={18}
        color={isSaved ? colors.surface : colors.ink}
        fill={isSaved ? colors.surface : 'transparent'}
      />
      <Text style={[styles.text, isSaved && styles.savedText]}>{isSaved ? 'Saved' : 'Save'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  saved: {
    backgroundColor: colors.olive,
    borderColor: colors.olive,
  },
  text: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  savedText: {
    color: colors.surface,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});

