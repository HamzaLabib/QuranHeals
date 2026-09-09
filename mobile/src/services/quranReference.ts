export type QuranErrorKind = 'invalid_reference' | 'not_found' | 'integrity' | 'unavailable';

export class QuranDataError extends Error {
  constructor(message: string, public readonly kind: QuranErrorKind = 'unavailable') {
    super(message);
    this.name = 'QuranDataError';
  }
}

function invalidReference(): never {
  throw new QuranDataError('This ayah has an invalid or conflicting reference and cannot be opened.', 'invalid_reference');
}

export function verseKeyFromNumbers(surah: unknown, ayah: unknown): string {
  if (typeof surah !== 'number' || typeof ayah !== 'number' || !Number.isInteger(surah) ||
      !Number.isInteger(ayah) || surah < 1 || surah > 114 || ayah < 1 || ayah > 286) invalidReference();
  return `${surah}:${ayah}`;
}

export function parseVerseKey(value: unknown): { surah: number; ayah: number; verseKey: string } {
  if (typeof value !== 'string' || !/^[1-9]\d{0,2}:[1-9]\d{0,2}$/.test(value)) invalidReference();
  const [surah, ayah] = value.split(':').map(Number);
  if (verseKeyFromNumbers(surah, ayah) !== value) invalidReference();
  return { surah, ayah, verseKey: value };
}

// A Mongo ID or Arabic snapshot is never evidence of a Quran reference.
export function resolveVerseKey(record: unknown): string {
  if (!record || typeof record !== 'object' || Array.isArray(record)) invalidReference();
  const row = record as Record<string, unknown>;
  const keys: string[] = [];
  for (const field of ['verseKey', 'referenceKey']) {
    if (row[field] !== undefined) keys.push(parseVerseKey(row[field]).verseKey);
  }
  for (const [surahField, ayahField] of [['surahNumber', 'ayahNumber'], ['surah', 'ayah']]) {
    if (row[surahField] !== undefined || row[ayahField] !== undefined) {
      keys.push(verseKeyFromNumbers(row[surahField], row[ayahField]));
    }
  }
  if (keys.length === 0 || keys.some(key => key !== keys[0])) invalidReference();
  return keys[0];
}
