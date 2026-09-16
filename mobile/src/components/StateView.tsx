import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '@/constants/theme';

type StateViewProps = {
  title: string;
  message: string;
  icon?: ReactNode;
  /** Subtle continuous rotation for a loading icon (e.g. RefreshCw) — never used for error/empty states. */
  spin?: boolean;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
};

export function StateView({ title, message, icon, spin = false, actionLabel, onAction }: StateViewProps) {
  // A lazily-initialized state value (not a ref) so it's safe to read during
  // render — Animated.Value itself is still a mutable, imperatively-driven
  // container; only its *identity* needs to be stable across renders.
  const [rotation] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!spin) return undefined;

    const loop = Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin, rotation]);

  const spinStyle = {
    transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
  };

  return (
    <View style={styles.container}>
      {icon && (
        <View style={styles.iconWrap}>{spin ? <Animated.View style={spinStyle}>{icon}</Animated.View> : icon}</View>
      )}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.oliveWash,
    borderRadius: radii.full,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  title: {
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  message: {
    color: colors.muted,
    fontSize: typography.body,
    lineHeight: 23,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.ink,
    borderRadius: radii.sm,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.lg,
  },
  buttonText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
});

