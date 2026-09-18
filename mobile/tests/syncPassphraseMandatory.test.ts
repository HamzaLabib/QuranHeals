import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sheetSource = readFileSync(resolve(__dirname, '../src/components/SyncPassphraseSheet.tsx'), 'utf-8');
const useAuthSource = readFileSync(resolve(__dirname, '../src/auth/useAuth.tsx'), 'utf-8');

// Strip comments before asserting no cancel/skip *code* exists — the
// component's own doc comments legitimately discuss what was deliberately
// removed, using exactly those words, which would otherwise false-positive.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const sheetCode = stripComments(sheetSource);

describe('SyncPassphraseSheet: the mandatory password step cannot be skipped/cancelled/dismissed', () => {
  it('has no Cancel/skip/"not now" prop, button, or copy anywhere in the actual code', () => {
    expect(sheetCode).not.toMatch(/onCancel/i);
    expect(sheetCode).not.toMatch(/\bcancel\b/i);
    expect(sheetCode).not.toMatch(/not now/i);
    expect(sheetCode).not.toMatch(/\bskip\b/i);
  });

  it('Android/hardware back cannot dismiss it — onRequestClose is a no-op, not a close/cancel handler', () => {
    expect(sheetSource).toMatch(/onRequestClose=\{\(\) => \{\}\}/);
  });

  it('is not wrapped by a Pressable/TouchableOpacity that closes it on backdrop tap', () => {
    // The only Pressables in this file are the Sign out / Continue buttons
    // inside the sheet — never one wrapping the backdrop itself that could
    // dismiss on an outside tap.
    expect(sheetSource).not.toMatch(/<Pressable[^>]*style=\{styles\.backdrop\}/);
  });

  it('provides exactly one way out: signing out — reusing the existing account.signOut copy, not new invented copy', () => {
    expect(sheetSource).toMatch(/onSignOut/);
    expect(sheetSource).toMatch(/messages\.account\.signOut/);
  });

  it('the password field stays a secure/masked entry', () => {
    expect(readFileSync(resolve(__dirname, '../src/components/SyncPasswordField.tsx'), 'utf-8')).toMatch(/secureTextEntry=\{!visible\}/);
  });
});

describe('useAuth.tsx: wiring the mandatory step through to a real sign-out, never a silent skip', () => {
  it('SyncPassphraseSheet is rendered with onSignOut, not onCancel', () => {
    expect(useAuthSource).toMatch(/<SyncPassphraseSheet[\s\S]*?onSignOut=\{/);
    expect(useAuthSource).not.toMatch(/<SyncPassphraseSheet[\s\S]*?onCancel=\{/);
  });

  it('the sign-out path calls the real signOut() — not just resolving/rejecting the prompt and leaving the user signed in', () => {
    const onSignOutBlock = useAuthSource.match(/onSignOut=\{\(\) => \{[\s\S]*?\}\}/)?.[0] ?? '';
    expect(onSignOutBlock).toMatch(/void signOut\(\)/);
  });
});
