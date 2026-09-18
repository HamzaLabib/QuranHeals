import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Normalizes CRLF to LF once here so every regex below matches the same way
// regardless of the checkout's line endings (Windows' readFileSync can
// return '\r\n', which would otherwise silently break any regex assuming a
// bare '\n' — the code itself is never at fault for the platform's line
// endings).
const readSource = (path: string) => readFileSync(resolve(__dirname, path), 'utf-8').replace(/\r\n/g, '\n');

const sheetSource = readSource('../src/components/DeleteAccountSheet.tsx');
const accountSectionSource = readSource('../src/components/AccountSection.tsx');
const useAuthSource = readSource('../src/auth/useAuth.tsx');
const syncApiSource = readSource('../src/sync/syncApi.ts');

describe('useAuth.tsx: deleteAccount only clears local data after a confirmed backend success', () => {
  const deleteAccountBlock = useAuthSource.match(/const deleteAccount = useCallback\(async \(\) => \{[\s\S]*?\}, \[[^\]]*\]\);/)?.[0] ?? '';

  it('the deleteAccount callback exists and is exposed on the context', () => {
    expect(deleteAccountBlock.length).toBeGreaterThan(0);
    expect(useAuthSource).toMatch(/deleteAccount,\n\s*\}\),/);
  });

  it('calls the backend delete request before any local-clearing call — never the other way around', () => {
    const backendCallIndex = deleteAccountBlock.indexOf('deleteAccountRequest(token)');
    const clearReflectionsIndex = deleteAccountBlock.indexOf('clearAllReflections()');
    const clearFavoritesIndex = deleteAccountBlock.indexOf('clearAllFavorites()');
    const clearSessionIndex = deleteAccountBlock.indexOf('clearSessionToken()');

    expect(backendCallIndex).toBeGreaterThan(-1);
    expect(clearReflectionsIndex).toBeGreaterThan(backendCallIndex);
    expect(clearFavoritesIndex).toBeGreaterThan(backendCallIndex);
    expect(clearSessionIndex).toBeGreaterThan(backendCallIndex);
  });

  it('clears local reflections and favorites on deletion — unlike ordinary signOut(), which deliberately keeps them', () => {
    expect(deleteAccountBlock).toMatch(/clearAllReflections\(\)/);
    expect(deleteAccountBlock).toMatch(/clearAllFavorites\(\)/);
  });

  it('throws (never silently no-ops) when called while not signed in', () => {
    expect(deleteAccountBlock).toMatch(/if \(!token\) \{\s*throw/);
  });
});

describe('syncApi.ts: deleteAccountRequest', () => {
  it('sends a DELETE to /api/account — no :userId in the path', () => {
    expect(syncApiSource).toMatch(/method: 'DELETE'/);
    expect(syncApiSource).toMatch(/'\/api\/account'/);
    expect(syncApiSource).not.toMatch(/\/api\/account\/\$\{/);
  });

  it('reuses authedRequest (the same 401-refresh-and-retry path as every other sync call) rather than a bespoke fetch', () => {
    const block = syncApiSource.match(/export function deleteAccountRequest\([\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).toMatch(/authedRequest</);
  });
});

describe('AccountSection.tsx: Danger Zone gating and wiring', () => {
  it('the Danger Zone / Delete Account entry point only renders when signed in', () => {
    const block = accountSectionSource.match(/\{status === 'signed-in' && \(\s*<View style=\{styles\.dangerZone\}[\s\S]*?\)\}/)?.[0] ?? '';
    expect(block.length).toBeGreaterThan(0);
    expect(block).toMatch(/messages\.account\.deleteAccountAction/);
  });

  it('renders DeleteAccountSheet and only shows the success message once onDeleted actually fires', () => {
    expect(accountSectionSource).toMatch(/<DeleteAccountSheet/);
    expect(accountSectionSource).toMatch(/onDeleted=\{\(\) => \{/);
    expect(accountSectionSource).toMatch(/messages\.deleteAccount\.successMessage/);
  });

  it("never renders a token, provider subject id, or internal database id in the deletion flow either", () => {
    expect(accountSectionSource).not.toMatch(/\{user\.id\}|\{user\.providerSubject\}|\{token\}|\{sessionToken\}/);
  });
});

describe('DeleteAccountSheet.tsx: destructive-action safety', () => {
  it('the final delete button is disabled until the typed confirmation exactly matches', () => {
    expect(sheetSource).toMatch(/isValidDeleteConfirmation\(confirmationText, messages\.deleteAccount\.confirmationWord\)/);
    expect(sheetSource).toMatch(/disabled=\{!canDelete\}/);
  });

  it('never auto-submits on a valid confirmation value — deletion only starts from the button’s onPress', () => {
    // The only two places confirmDelete can be triggered from are the
    // Pressable's onPress and returnKeyType/onSubmitEditing — the latter
    // must dismiss the keyboard only, never call confirmDelete.
    expect(sheetSource).toMatch(/onPress=\{\(\) => void confirmDelete\(\)\}/);
    expect(sheetSource).toMatch(/onSubmitEditing=\{\(\) => Keyboard\.dismiss\(\)\}/);
    expect(sheetSource).not.toMatch(/onChangeText=\{[^}]*confirmDelete/);
  });

  it('uses destructive (rust) styling for the final delete action', () => {
    expect(sheetSource).toMatch(/destructiveButton:\s*\{[\s\S]*?backgroundColor: colors\.rust,/);
  });

  it('shows a loading state and disables the field/buttons while a request is in flight', () => {
    expect(sheetSource).toMatch(/isDeleting/);
    expect(sheetSource).toMatch(/<ActivityIndicator/);
    expect(sheetSource).toMatch(/editable=\{!isDeleting\}/);
  });

  it('guards against a duplicate/overlapping delete request', () => {
    const confirmDeleteBlock = sheetSource.match(/const confirmDelete = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    expect(confirmDeleteBlock).toMatch(/if \(!canDelete\) return;/);
    // canDelete itself is false while isDeleting (see the canDelete definition above), so a second tap during an in-flight request is a no-op.
    expect(sheetSource).toMatch(/const canDelete = isValidDeleteConfirmation\([^)]*\) && !isDeleting;/);
  });

  it('a failed deletion shows an error and never calls onDeleted', () => {
    const confirmDeleteBlock = sheetSource.match(/const confirmDelete = async \(\) => \{[\s\S]*?\n  \};/)?.[0] ?? '';
    expect(confirmDeleteBlock).toMatch(/catch \{[\s\S]*?setErrorMessage\(messages\.deleteAccount\.failureMessage\);/);
    const catchBlock = confirmDeleteBlock.match(/catch \{[\s\S]*?\}/)?.[0] ?? '';
    expect(catchBlock).not.toMatch(/onDeleted\(\)/);
  });

  it('Cancel and Android Back are disabled while a delete request is in flight, but otherwise work normally (not a mandatory flow)', () => {
    expect(sheetSource).toMatch(/const close = \(\) => \{\s*if \(isDeleting\) return;/);
    expect(sheetSource).toMatch(/onRequestClose=\{close\}/);
    expect(sheetSource).toMatch(/messages\.deleteAccount\.cancel/);
  });
});
