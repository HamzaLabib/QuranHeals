import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  accountAgeDeclaration,
  hasConfirmedAccountAge,
  saveAccountAgeConfirmation,
  type AccountAgeDeclaration,
} from '@/auth/ageConfirmation';
import { AppleSignInCancelledError, isAppleSignInSupportedPlatform, requestAppleCredential } from '@/auth/appleAuth';
import { extractGoogleIdToken, isGoogleAuthConfigured, useGoogleAuthRequest } from '@/auth/googleAuth';
import { useAuth } from '@/auth/useAuth';
import { radii, shadows, spacing, typography, type Palette } from '@/constants/theme';
import { usePalette, useThemedStyles } from '@/theme/useTheme';
import { AgeConfirmationPanel } from '@/components/AgeConfirmationPanel';
import { DeleteAccountSheet } from '@/components/DeleteAccountSheet';
import { ChangeSyncPasswordSheet } from '@/components/ChangeSyncPasswordSheet';
import type { AppLocale } from '@/localization/locales';
import type { Messages } from '@/localization/messages';
import { AppleIcon } from './AppleIcon';
import { GoogleIcon } from './GoogleIcon';

const BRAND_ICON_SIZE = 21;

type SignInProvider = 'apple' | 'google';

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
  const colors = usePalette();
  const styles = useThemedStyles(makeStyles);
  const { status, lastError, signInWithGoogleIdToken, signInWithAppleIdToken, signOut, deleteAccount } = useAuth();
  const [googleRequest, googleResponse, promptGoogleAsync] = useGoogleAuthRequest();
  const [appleRequestError, setAppleRequestError] = useState<string | null>(null);
  const [isDeleteSheetVisible, setIsDeleteSheetVisible] = useState(false);
  // Shown after the sheet reports a completed deletion — status has already
  // flipped to 'guest' by then, so this is purely a one-time confirmation,
  // never a stand-in for the signed-in/out state itself.
  const [accountDeletedMessage, setAccountDeletedMessage] = useState(false);
  // Set only in launchSignIn, which runs only after the age confirmation:
  // the backend needs this declaration to create a new account. A provider
  // result that arrives without it (never expected) is sent without one, so
  // only an existing account could sign in.
  const ageDeclarationRef = useRef<AccountAgeDeclaration | undefined>(undefined);

  useEffect(() => {
    const idToken = extractGoogleIdToken(googleResponse);
    if (idToken) {
      void signInWithGoogleIdToken(idToken, ageDeclarationRef.current);
    }
  }, [googleResponse, signInWithGoogleIdToken]);

  // Account-age self-declaration (auth/ageConfirmation.ts): every Apple and
  // Google sign-in started from here goes through requestSignIn. Loaded once
  // so a tap on an already-confirmed device starts the provider immediately
  // (no async gap before Google's browser prompt). Until it has loaded, or
  // if storage fails, the device counts as not confirmed and is asked.
  // Only starting a NEW sign-in is gated: restored sessions, refresh,
  // re-authentication for deletion/reset, and guest use are untouched.
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<SignInProvider | null>(null);

  useEffect(() => {
    let active = true;
    void hasConfirmedAccountAge().then((confirmed) => {
      if (active && confirmed) setAgeConfirmed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const launchSignIn = (provider: SignInProvider) => {
    ageDeclarationRef.current = accountAgeDeclaration();
    if (provider === 'apple') {
      void onApplePress();
    } else {
      setAccountDeletedMessage(false);
      void promptGoogleAsync();
    }
  };

  const requestSignIn = (provider: SignInProvider) => {
    if (ageConfirmed) {
      launchSignIn(provider);
    } else {
      setAccountDeletedMessage(false);
      setPendingProvider(provider);
    }
  };

  const onAgeConfirmed = () => {
    const provider = pendingProvider;
    if (!provider) return;
    setAgeConfirmed(true);
    setPendingProvider(null);
    void saveAccountAgeConfirmation();
    launchSignIn(provider);
  };

  const onApplePress = async () => {
    setAppleRequestError(null);
    setAccountDeletedMessage(false);
    try {
      const { identityToken, authorizationCode } = await requestAppleCredential();
      await signInWithAppleIdToken(identityToken, authorizationCode, ageDeclarationRef.current);
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
        {status === 'loading' ? (
          // Session restoration in progress (cold start) — never flashes
          // "Not signed in" + sign-in buttons before restoration has
          // actually concluded either way.
          <Text style={[styles.statusText, direction]}>{messages.account.checkingSession}</Text>
        ) : status === 'signed-in' ? (
          <>
            <Text style={[styles.statusText, direction]}>{messages.account.signedIn}</Text>
            <ChangePasswordAction messages={messages} />
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
            {pendingProvider ? (
              <AgeConfirmationPanel
                messages={messages}
                direction={direction}
                isRtl={isRtl}
                onContinue={onAgeConfirmed}
                onCancel={() => setPendingProvider(null)}
              />
            ) : (
            <>
            <Text style={[styles.syncPrompt, direction]}>{messages.auth.syncPrompt}</Text>
            {isAppleSignInSupportedPlatform() && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.account.signInWithApple}
                onPress={() => requestSignIn('apple')}
                style={({ pressed }) => [styles.button, styles.appleButton, isRtl && styles.buttonRtl, pressed && styles.pressed]}>
                <AppleIcon size={BRAND_ICON_SIZE} color={colors.onAppleButton} />
                <Text style={[styles.buttonText, styles.appleButtonText]}>{messages.account.signInWithApple}</Text>
              </Pressable>
            )}
            {isGoogleAuthConfigured() && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={messages.account.signInWithGoogle}
                disabled={!googleRequest}
            onPress={() => requestSignIn('google')}
            style={({ pressed }) => [
              styles.button,
              styles.googleButton,
              isRtl && styles.buttonRtl,
              pressed && styles.pressed,
            ]}>
              <GoogleIcon size={BRAND_ICON_SIZE} />
              <Text style={[styles.buttonText, styles.googleButtonText]}>
                {messages.account.signInWithGoogle}
              </Text>
              </Pressable>
            )}
            {Platform.OS === 'android' && !isGoogleAuthConfigured() && !isAppleSignInSupportedPlatform() && (
              // Neither provider is configured yet (Part B §5) — never a broken/empty section.
              <Text style={[styles.syncPrompt, direction]}>{messages.auth.signInFailed}</Text>
            )}
            </>
            )}
          </>
        )}
        {displayedError && <Text style={[styles.errorText, direction]}>{displayedError}</Text>}
        {accountDeletedMessage && <Text style={[styles.successText, direction]}>{messages.deleteAccount.successMessage}</Text>}
      </View>

      {status === 'signed-in' && (
        <View style={styles.dangerZone}>
          <Text style={[styles.dangerZoneTitle, direction]}>{messages.account.dangerZoneTitle}</Text>
          <Text style={[styles.dangerZoneDescription, direction]}>{messages.account.deleteAccountActionDescription}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={messages.account.deleteAccountAction}
            onPress={() => setIsDeleteSheetVisible(true)}
            style={({ pressed }) => [styles.deleteAccountButton, pressed && styles.pressed]}>
            <Text style={styles.deleteAccountButtonText}>{messages.account.deleteAccountAction}</Text>
          </Pressable>
        </View>
      )}

      <DeleteAccountSheet
        deleteAccount={deleteAccount}
        visible={isDeleteSheetVisible}
        onClose={() => setIsDeleteSheetVisible(false)}
        onDeleted={() => {
          setIsDeleteSheetVisible(false);
          setAccountDeletedMessage(true);
        }}
      />
    </View>
  );
}

/** Signed-in subtree owns the sheet, so sign-out also resets visibility. */
function ChangePasswordAction({ messages }: { messages: Messages }) {
  const styles = useThemedStyles(makeStyles);
  const [visible, setVisible] = useState(false);
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={messages.syncPassphrase.changeTitle}
      onPress={() => setVisible(true)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <Text style={styles.buttonText}>{messages.syncPassphrase.changeTitle}</Text>
    </Pressable>
    {visible && <ChangeSyncPasswordSheet onClose={() => setVisible(false)} />}
  </>;
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  section: {
    gap: spacing.sm,
  },
  sectionLabel: {
    color: colors.accent,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
    ...shadows.soft,
  },
  statusText: {
    color: colors.textPrimary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  syncPrompt: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.primaryButton,
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: 11,
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonRtl: {
    flexDirection: 'row-reverse',
  },
  // Sign in with Apple: black in light mode, white in dark mode (Apple HIG
  // button styles). Same ink fill as the other buttons in light mode.
  appleButton: {
    backgroundColor: colors.appleButton,
  },
  appleButtonText: {
    color: colors.onAppleButton,
  },
  // Google's own light/dark button themes; GoogleIcon keeps its brand colors.
  googleButton: {
    backgroundColor: colors.googleButton,
    borderColor: colors.googleButtonBorder,
    borderWidth: 1,
  },
  googleButtonText: {
    color: colors.onGoogleButton,
  },
  buttonText: {
    color: colors.onPrimaryButton,
    fontSize: typography.body,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  successText: {
    color: colors.accent,
    fontSize: typography.caption,
    fontWeight: '700',
    lineHeight: 18,
  },
  dangerZone: {
    backgroundColor: colors.card,
    borderColor: colors.dangerBorder,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  dangerZoneTitle: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  dangerZoneDescription: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  // Deliberately understated (outlined, not solid-filled) so this entry
  // point is never as easy to tap as a normal action button — the solid
  // destructive fill is reserved for the sheet's own final confirm button
  // (DeleteAccountSheet.tsx), after the typed-confirmation gate.
  deleteAccountButton: {
    alignItems: 'center',
    borderColor: colors.danger,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  deleteAccountButtonText: {
    color: colors.danger,
    fontSize: typography.body,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.78,
  },
});
