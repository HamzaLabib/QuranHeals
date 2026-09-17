import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sheetFiles = {
  ReflectionSheet: '../src/components/ReflectionSheet.tsx',
  ReportIssueSheet: '../src/components/ReportIssueSheet.tsx',
  SyncPassphraseSheet: '../src/components/SyncPassphraseSheet.tsx',
  DeleteAccountSheet: '../src/components/DeleteAccountSheet.tsx',
} as const;

describe.each(Object.entries(sheetFiles))('%s: keyboard-overlap fix (Part 3)', (_name, relativePath) => {
  const source = readFileSync(resolve(__dirname, relativePath), 'utf-8');

  it('wraps the sheet in KeyboardAvoidingView with a platform-specific behavior — not an iOS-only fix', () => {
    expect(source).toMatch(/KeyboardAvoidingView/);
    expect(source).toMatch(/behavior=\{Platform\.OS === 'ios' \? 'padding' : 'height'\}/);
  });

  it('keeps the field scrollable while the keyboard is open, with taps outside the field still working', () => {
    expect(source).toMatch(/<ScrollView/);
    expect(source).toMatch(/keyboardShouldPersistTaps="handled"/);
  });

  it('every KeyboardAvoidingView opening tag has a matching closing tag', () => {
    const opens = source.match(/<KeyboardAvoidingView[\s>]/g)?.length ?? 0;
    const closes = source.match(/<\/KeyboardAvoidingView>/g)?.length ?? 0;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });

  it('tapping outside a field dismisses the keyboard only — never a call that also closes/cancels the sheet', () => {
    expect(source).toMatch(/TouchableWithoutFeedback/);
    expect(source).toMatch(/onPress=\{Keyboard\.dismiss\}/);
    const opens = source.match(/<TouchableWithoutFeedback[\s>]/g)?.length ?? 0;
    const closes = source.match(/<\/TouchableWithoutFeedback>/g)?.length ?? 0;
    expect(opens).toBeGreaterThan(0);
    expect(opens).toBe(closes);
  });
});
