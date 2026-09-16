import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppleSignInCancelledError, isAppleSignInSupportedPlatform, requestAppleIdentityToken } from '@/auth/appleAuth';
import { extractGoogleIdToken, isGoogleAuthConfigured, useGoogleAuthRequest } from '@/auth/googleAuth';
import { useAuth } from '@/auth/useAuth';
import { colors, radii, shadows, spacing, typography } from '@/constants/theme';
import type { AppLocale } from '@/localization/locales';
import type { Messages } from '@/localization/messages';

type Direction = { writingDirection: 'ltr' | 'rtl'; textAlign: 'left' | 'right' };

type AccountSectionProps = {
  locale: AppLocale;
  messages: Messages;
  direction: Direction;
  isRtl: boolean;
};

/**
 * Settings' Account section (Part B §11). Never renders tokens, provider
 * subject IDs, internal database IDs, or secrets — only the localized
 * guest/signed-in state and, on failure, the shared auth-failure copy
 * (Part B §10). A failed sign-in never blocks the rest of Settings or the
 * app.
 */
export function AccountSection({ messages, direction, isRtl }: AccountSectionProps) {
  const { status, lastError, signInWithGoogleIdToken, signInWithAppleIdToken, signOut } = useAuth();
  const [googleRequest, googleResponse, promptGoogleAsync] = useGoogleAuthRequest();
  const [appleRequestError, setAppleRequestError] = useState<string | null>(null);

  useEffect(() => {
    const idToken = extractGoogleIdToken(googleResponse);
    if (idToken) {
      void signInWithGoogleIdToken(idToken);
    }
  }, [googleResponse, signInWithGoogleIdToken]);

  const onApplePress = async () => {
    setAppleRequestError(null);
    try {
      const idToken = await requestAppleIdentityToken();
      await signInWithAppleIdToken(idToken);
    } catch (error) {
      // A cancelled native sheet is not a failure worth showing — anything
      // else (device/native-module error, before the backend is ever
      // reached) gets the same shared failure copy as a verification
      // failure (Part B §10).
      if (!(error instanceof AppleSignInCancelledError)) {
        setAppleRequestError(messages.auth.signInFailed);
      }
    }
  };

  const displayedError = appleRequestError ?? lastError;

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, direction]}>{messages.account.sectionTitle}</Text>
      <View style={styles.card}>
        {status === 'signed-in' ? (
          <>
            <Text style={[styles.statusText, direction]}>{messages.account.signedIn}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={messages.account.signOut}
              onPress={() => void signOut()}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>{messages.account.signOut}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={[styles.statusText, direction]}>{messages.account.notSignedIn}</Text>
            <Text style={[styles.syncPrompt, direction]}>{messages.auth.syncPrompt}</Text>
            {isAppleSignInSupportedPlatform() && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.account.signInWithApple}
                onPress={() => void onApplePress()}
                style={({ pressed }) => [styles.button, isRtl && styles.buttonRtl, pressed && styles.pressed]}>
                <Text style={styles.buttonText}>{messages.account.signInWithApple}</Text>
              </Pressable>
            )}
            {isGoogleAuthConfigured() && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.account.signInWithGoogle}
                disabled={!googleRequest}
                onPress={() => void promptGoogleAsync()}
                style={({ pressed }) => [styles.button, isRtl && styles.buttonRtl, pressed && styles.pressed]}>
                <Text style={styles.buttonText}>{messages.account.signInWithGoogle}</Text>
              </Pressable>
            )}
            {Platform.OS === 'android' && !isGoogleAuthConfigured() && !isAppleSignInSupportedPlatform() && (
              // Neither provider is configured yet (Part B §5) — never a broken/empty section.
              <Text style={[styles.syncPrompt, direction]}>{messages.auth.signInFailed}</Text>
            )}
          </>
        )}
        {displayedError && <Text style={[styles.errorText, direction]}>{displayedError}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.olive,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.soft,
  },
  statusText: {
    color: colors.ink,
    fontSize: typography.body,
    fontWeight: '700',
  },
  syncPrompt: {
    color: colors.softText,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radii.md,
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonRtl: {
    flexDirection: 'row-reverse',
  },
  buttonText: {
    color: colors.surface,
    fontSize: typography.body,
    fontWeight: '700',
  },
  errorText: {
    color: colors.rust,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.78,
  },
});
