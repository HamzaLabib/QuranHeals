import { describe, expect, it } from 'vitest';

import { isValidDeleteConfirmation } from '@/utils/deleteAccountConfirmation';

describe('isValidDeleteConfirmation (English, requiredWord = "DELETE")', () => {
  it('rejects an empty field', () => {
    expect(isValidDeleteConfirmation('', 'DELETE')).toBe(false);
  });

  it('rejects a partial match', () => {
    expect(isValidDeleteConfirmation('DELET', 'DELETE')).toBe(false);
    expect(isValidDeleteConfirmation('DELETES', 'DELETE')).toBe(false);
  });

  it('rejects the wrong case (exact match required)', () => {
    expect(isValidDeleteConfirmation('delete', 'DELETE')).toBe(false);
    expect(isValidDeleteConfirmation('Delete', 'DELETE')).toBe(false);
  });

  it('accepts the exact word', () => {
    expect(isValidDeleteConfirmation('DELETE', 'DELETE')).toBe(true);
  });

  it('trims accidental leading/trailing whitespace before comparing', () => {
    expect(isValidDeleteConfirmation('  DELETE  ', 'DELETE')).toBe(true);
    expect(isValidDeleteConfirmation('\nDELETE\t', 'DELETE')).toBe(true);
  });

  it('does not trim/ignore internal whitespace — "DE LETE" is still not an exact match', () => {
    expect(isValidDeleteConfirmation('DE LETE', 'DELETE')).toBe(false);
  });
});

describe('isValidDeleteConfirmation (Arabic, requiredWord = "حذف")', () => {
  it('accepts the exact Arabic word', () => {
    expect(isValidDeleteConfirmation('حذف', 'حذف')).toBe(true);
  });

  it('trims whitespace around the Arabic word', () => {
    expect(isValidDeleteConfirmation('  حذف  ', 'حذف')).toBe(true);
  });

  it('rejects a partial or different Arabic string', () => {
    expect(isValidDeleteConfirmation('حذ', 'حذف')).toBe(false);
    expect(isValidDeleteConfirmation('إلغاء', 'حذف')).toBe(false);
  });
});
