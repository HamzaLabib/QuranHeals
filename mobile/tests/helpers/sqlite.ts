/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import type { Ayah } from '@/types/domain';
import type { QuranConnection } from '@/services/quranRepository';

const connections: DatabaseSync[] = [];
afterAll(() => { for (const connection of connections) connection.close(); });

export function openTestDatabase(): QuranConnection {
  const db = new DatabaseSync(fileURLToPath(new URL('../../assets/quran/quran.sqlite', import.meta.url)), { readOnly: true });
  connections.push(db);
  return {
    getAllAsync: async <T>(sql: string, ...params: (string | number)[]) => db.prepare(sql).all(...params) as T[],
    execAsync: async sql => { db.exec(sql); },
    closeAsync: async () => { /* Read-only test connection is closed after the suite. */ },
  };
}

export function legacyAyah(overrides: Partial<Ayah> = {}): Ayah {
  return {
    id: '66f100000000000000000001', referenceKey: '2:153', surahNumber: 2, ayahNumber: 153,
    surahNameArabic: '', surahNameEnglish: 'Al-Baqarah', arabicText: 'UNTRUSTED_BACKEND_SNAPSHOT',
    englishTranslation: 'Existing translation fixture', emotions: ['sad'],
    quranTextSource: 'Legacy backend source', translationSource: 'Existing translation source', ...overrides,
  };
}
