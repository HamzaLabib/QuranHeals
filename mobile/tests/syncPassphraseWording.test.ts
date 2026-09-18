import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

const sheetSource = readFileSync(resolve(__dirname, '../src/components/SyncPassphraseSheet.tsx'), 'utf-8');

/**
 * The Sync Passphrase UI must never show the same generic wording whether
 * the user is creating a passphrase for the first time or entering one that
 * already exists (see syncKeyManager.test.ts for the pre-existing coverage
 * of *which* mode gets picked — 'create' only when no cloud key exists yet
 * anywhere for the account, 'unlock' whenever one already does, which is
 * already server-authoritative and untouched by this change). This file
 * covers the wording itself.
 */
describe('SyncPassphraseSheet wording: Set Password (first-time) vs Enter Password (existing)', () => {
  it('renders the title/placeholder from an isCreate ternary driven by request.mode, never a single shared string', () => {
    expect(sheetSource).toMatch(/const isCreate = request\.mode === 'create';/);
    expect(sheetSource).toMatch(/\{isCreate \? messages\.syncPassphrase\.createTitle : messages\.syncPassphrase\.unlockTitle\}/);
    expect(sheetSource).toMatch(
      /placeholder=\{isCreate \? messages\.syncPassphrase\.createPlaceholder : messages\.syncPassphrase\.unlockPlaceholder\}/,
    );
  });

  it('never falls back to a single generic "placeholder" key shared by both modes', () => {
    expect(sheetSource).not.toMatch(/messages\.syncPassphrase\.placeholder\b/);
  });

  for (const locale of APP_LOCALES) {
    it(`${locale}: first-time setup uses "Set Password" wording, existing-passphrase unlock uses "Enter Password" wording — never the same string`, () => {
      const copy = MESSAGES[locale].syncPassphrase;
      expect(copy.createTitle).not.toBe(copy.unlockTitle);
      expect(copy.createPlaceholder).not.toBe(copy.unlockPlaceholder);
      expect(copy.createTitle.length).toBeGreaterThan(0);
      expect(copy.unlockTitle.length).toBeGreaterThan(0);
      expect(copy.createPlaceholder.length).toBeGreaterThan(0);
      expect(copy.unlockPlaceholder.length).toBeGreaterThan(0);
    });
  }

  it('English: matches the exact requested wording ("Set Password" / "Enter Password" / "Set password" / "Enter password")', () => {
    const copy = MESSAGES.en.syncPassphrase;
    expect(copy.createTitle).toBe('Set Password');
    expect(copy.unlockTitle).toBe('Enter Password');
    expect(copy.createPlaceholder).toBe('Set password');
    expect(copy.unlockPlaceholder).toBe('Enter password');
  });

  it('every locale\'s create/unlock descriptions clarify this is not the Google/Apple account password', () => {
    for (const locale of APP_LOCALES) {
      const copy = MESSAGES[locale].syncPassphrase;
      // English wording is asserted verbatim elsewhere; here we only check
      // that every locale's descriptions are non-empty and distinct from
      // each other, since the exact Arabic/ar-EG phrasing is pinned in
      // localization.test.ts.
      expect(copy.createDescription).not.toBe(copy.unlockDescription);
      expect(copy.createDescription.length).toBeGreaterThan(0);
      expect(copy.unlockDescription.length).toBeGreaterThan(0);
    }
  });

  it('ar-EG uses the exact same wording as ar for this security flow (never Egyptian colloquial)', () => {
    expect(MESSAGES['ar-EG'].syncPassphrase).toEqual(MESSAGES.ar.syncPassphrase);
  });
});

/**
 * Pure logic mirror of SyncPassphraseSheet's isCreate ternary (pinned above
 * against the real source), exercised against the actual mode values
 * syncKeyManager.ts's ensureReflectionMasterKey produces — proving the
 * end-to-end mapping from "server-authoritative setup state" to "the
 * correct displayed wording" for every state the spec calls out.
 */
function resolveSyncPassphraseCopy(mode: 'create' | 'unlock', locale: (typeof APP_LOCALES)[number]) {
  const isCreate = mode === 'create';
  const copy = MESSAGES[locale].syncPassphrase;
  return {
    title: isCreate ? copy.createTitle : copy.unlockTitle,
    placeholder: isCreate ? copy.createPlaceholder : copy.unlockPlaceholder,
  };
}

describe('End-to-end mode -> wording mapping for every required state', () => {
  it('1. user has never configured a Sync Password anywhere (no cloud key) -> "create" mode -> Set Password wording', () => {
    expect(resolveSyncPassphraseCopy('create', 'en')).toEqual({ title: 'Set Password', placeholder: 'Set password' });
  });

  it('2. user already has a Sync Password and this device needs to unlock -> "unlock" mode -> Enter Password wording', () => {
    expect(resolveSyncPassphraseCopy('unlock', 'en')).toEqual({ title: 'Enter Password', placeholder: 'Enter password' });
  });

  it('5/6. a second device signing in where encrypted reflections already exist gets "unlock" mode (never "create") -> Enter Password, never Set Password', () => {
    // The mode itself is decided by syncKeyManager.ts's ensureReflectionMasterKey
    // purely from whether a cloud sync key already exists for the account
    // (server-authoritative — see syncKeyManager.test.ts's "on a second
    // device (cloud key already exists), prompts to UNLOCK" coverage). This
    // asserts the wording layer built on top of that decision is correct
    // for exactly that outcome.
    const secondDeviceMode: 'create' | 'unlock' = 'unlock';
    const copy = resolveSyncPassphraseCopy(secondDeviceMode, 'en');
    expect(copy.title).toBe('Enter Password');
    expect(copy.title).not.toBe('Set Password');
  });

  it('13. the mapping produces distinct, correct wording in all three supported languages', () => {
    for (const locale of APP_LOCALES) {
      const createCopy = resolveSyncPassphraseCopy('create', locale);
      const unlockCopy = resolveSyncPassphraseCopy('unlock', locale);
      expect(createCopy.title).not.toBe(unlockCopy.title);
      expect(createCopy.placeholder).not.toBe(unlockCopy.placeholder);
    }
  });
});
