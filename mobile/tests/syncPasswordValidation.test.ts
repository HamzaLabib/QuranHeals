import { describe, expect, it } from 'vitest';
import { canChangeSyncPassword, canSetSyncPassword, passwordLengthError } from '@/utils/syncPasswordValidation';

describe('exact sync password validation', () => {
  it.each([0, 7, 33])('rejects %i characters', (n) => {
    expect(canSetSyncPassword('a'.repeat(n), 'a'.repeat(n))).toBe(false);
    expect(canChangeSyncPassword('current-password', 'a'.repeat(n), 'a'.repeat(n), true)).toBe(false);
  });
  it.each([8, 32])('accepts %i matching characters without composition rules', (n) => {
    expect(canSetSyncPassword('a'.repeat(n), 'a'.repeat(n))).toBe(true);
    expect(canChangeSyncPassword('current-password', 'a'.repeat(n), 'a'.repeat(n), true)).toBe(true);
  });
  it.each(['12345678', '!@#$%^&*', '  pass  ', 'كلمةمرور', '😀'.repeat(8)])('accepts input exactly: %s', (password) => {
    expect(canSetSyncPassword(password, password)).toBe(true);
  });
  it('does not trim or normalize confirmation', () => {
    expect(canSetSyncPassword(' password ', 'password')).toBe(false);
    expect(canSetSyncPassword('ＣＣＣＣＣＣＣＣ', 'CCCCCCCC')).toBe(false);
    expect(passwordLengthError('😀'.repeat(33))).toBe('tooLong');
  });
  it('requires confirmation, a verified current password, and a different new password', () => {
    expect(canSetSyncPassword('password', '')).toBe(false);
    expect(canSetSyncPassword('password', 'Password')).toBe(false);
    expect(canChangeSyncPassword('current!', 'new-pass', 'new-pass', false)).toBe(false);
    expect(canChangeSyncPassword('current!', 'current!', 'current!', true)).toBe(false);
    expect(canChangeSyncPassword('current!', 'new-pass', 'mismatch', true)).toBe(false);
  });
});
