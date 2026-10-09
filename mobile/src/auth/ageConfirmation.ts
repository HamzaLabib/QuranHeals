import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Self-declared account-age confirmation, shown once before Apple or Google
 * sign-in (components/AccountSection.tsx). Quran Heals accounts are for
 * people aged 16 or older who also meet any higher minimum age in their
 * country; reading the Quran without an account needs no confirmation.
 *
 * This is a self-declaration, not age verification: no age or date of birth
 * is ever asked for, stored or sent. Only the fact that the current policy
 * was confirmed on this device, and when, is kept — on the device only
 * (AsyncStorage), never uploaded or synced. A sign-in started after the
 * confirmation sends just the policy version (accountAgeDeclaration below);
 * the backend requires it to create a NEW account and does not store it.
 *
 * Bump AGE_CONFIRMATION_POLICY_VERSION when the age policy changes: every
 * device is then asked to confirm again before its next sign-in. Existing
 * sessions are never affected; the confirmation only gates starting a new
 * sign-in.
 */

/** Version 1: accounts require age 16+ and any higher local minimum. */
export const AGE_CONFIRMATION_POLICY_VERSION = 1;

const STORAGE_KEY = 'quran-heals:account-age-confirmation:v1';

type StoredConfirmation = { policyVersion: number; confirmedAt: string };

/** What a sign-in request carries once the user has confirmed — the policy version only. */
export type AccountAgeDeclaration = { policyVersion: number };

/** The declaration for the current policy. Only attach it to a sign-in the user started after confirming. */
export function accountAgeDeclaration(): AccountAgeDeclaration {
  return { policyVersion: AGE_CONFIRMATION_POLICY_VERSION };
}

function isCurrentConfirmation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const { policyVersion, confirmedAt } = value as Partial<StoredConfirmation>;
  return policyVersion === AGE_CONFIRMATION_POLICY_VERSION && typeof confirmedAt === 'string' && confirmedAt.length > 0;
}

/**
 * Whether this device has confirmed the current account-age policy. Never
 * throws: a missing, corrupted or outdated record, or a storage failure,
 * all mean "not confirmed", so the confirmation is shown again.
 */
export async function hasConfirmedAccountAge(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw !== null && isCurrentConfirmation(JSON.parse(raw));
  } catch {
    return false;
  }
}

/**
 * Records that the current policy was confirmed on this device. Never
 * throws: if storage fails, the in-memory confirmation still applies to
 * this session and the user is simply asked again next time.
 */
export async function saveAccountAgeConfirmation(now: Date = new Date()): Promise<void> {
  try {
    const record: StoredConfirmation = { policyVersion: AGE_CONFIRMATION_POLICY_VERSION, confirmedAt: now.toISOString() };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Non-fatal: the confirmation is simply requested again on a later sign-in.
  }
}
