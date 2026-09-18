import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openTestDatabase } from './helpers/sqlite';

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  },
}));
vi.mock('@/services/quranAsset', () => ({ openBundledQuran: async () => openTestDatabase() }));

const { saveReflection } = await import('@/storage/ayahReflections');
const { loadReflectionListItems } = await import('@/hooks/useReflections');
const { resolveReflectionSyncStatusLabel } = await import('@/utils/reflectionSyncStatus');
const { formatReflectionDate } = await import('@/utils/formatDate');
const { MESSAGES } = await import('@/localization/messages');
const { APP_LOCALES } = await import('@/localization/locales');

const REFLECTIONS_STORAGE_KEY = 'quran-heals:ayah-reflections:v1';

beforeEach(() => state.clear());

describe('loadReflectionListItems: local loading, ordering, and Quran resolution', () => {
  it('returns an empty list when nothing has been saved (empty state)', async () => {
    expect(await loadReflectionListItems()).toEqual([]);
  });

  it('sorts newest edit first by updatedAt', async () => {
    await saveReflection('2:255', 'older', 1000);
    await saveReflection('94:6', 'newer', 2000);
    const items = await loadReflectionListItems();
    expect(items.map((item) => item.reflection.verseKey)).toEqual(['94:6', '2:255']);
  });

  it('re-sorts correctly after an edit changes updatedAt', async () => {
    await saveReflection('2:255', 'first', 1000);
    await saveReflection('94:6', 'second', 2000);
    await saveReflection('2:255', 'edited to be newest', 3000);
    const items = await loadReflectionListItems();
    expect(items.map((item) => item.reflection.verseKey)).toEqual(['2:255', '94:6']);
  });

  it('resolves verified Arabic text and surah/ayah numbers from the local Quran repository for a valid verseKey', async () => {
    await saveReflection('2:255', 'about ayat al-kursi', 1000);
    const [item] = await loadReflectionListItems();
    expect(item.arabicText).toBeTruthy();
    expect(typeof item.arabicText).toBe('string');
    expect(item.surahNumber).toBe(2);
    expect(item.ayahNumber).toBe(255);
  });

  it('keeps an unresolved reflection visible (arabicText null) without losing any other reflection', async () => {
    // '1:8' is shape-valid (matches the verseKey pattern) but does not exist —
    // Al-Fatihah has only 7 ayahs — so local resolution fails for it alone.
    await saveReflection('1:8', 'a reflection on an unresolvable reference', 1000);
    await saveReflection('2:255', 'a normal, resolvable reflection', 2000);

    const items = await loadReflectionListItems();
    expect(items).toHaveLength(2);

    const unresolved = items.find((item) => item.reflection.verseKey === '1:8');
    const resolved = items.find((item) => item.reflection.verseKey === '2:255');
    expect(unresolved).toBeDefined();
    expect(unresolved!.arabicText).toBeNull();
    // The reflection's own text/verseKey is still fully intact — never dropped.
    expect(unresolved!.reflection.text).toBe('a reflection on an unresolvable reference');
    expect(unresolved!.surahNumber).toBe(1);
    expect(unresolved!.ayahNumber).toBe(8);
    expect(resolved!.arabicText).toBeTruthy();
  });

  it('surfaces a corrupted reflection store as a thrown error, without deleting or overwriting the stored data', async () => {
    state.set(REFLECTIONS_STORAGE_KEY, '{not valid json');
    await expect(loadReflectionListItems()).rejects.toThrow();
    expect(state.get(REFLECTIONS_STORAGE_KEY)).toBe('{not valid json');
  });

  it('works with no network dependency at all (no fetch stub exists anywhere in this file)', async () => {
    await saveReflection('2:255', 'offline note', 1000);
    const items = await loadReflectionListItems();
    expect(items).toHaveLength(1);
    expect(items[0].arabicText).toBeTruthy();
  });

  it('carries through the syncState exactly as stored, for guest (undefined) and synced/pending reflections alike', async () => {
    const { markReflectionSyncState } = await import('@/storage/ayahReflections');
    await saveReflection('2:255', 'guest reflection', 1000);
    await saveReflection('94:6', 'will be marked pending', 1000);
    await saveReflection('94:6', 'edited', 2000); // editing an existing reflection marks it 'pending'
    await saveReflection('2:286', 'will be marked synced', 1000);
    await markReflectionSyncState('2:286', 'synced');

    const items = await loadReflectionListItems();
    const byKey = Object.fromEntries(items.map((item) => [item.reflection.verseKey, item.reflection.syncState]));
    expect(byKey['2:255']).toBeUndefined();
    expect(byKey['94:6']).toBe('pending');
    expect(byKey['2:286']).toBe('synced');
  });
});

describe('resolveReflectionSyncStatusLabel: guest/pending/synced display', () => {
  it('undefined (never attempted / guest) maps to "Saved on device"', () => {
    expect(resolveReflectionSyncStatusLabel(undefined, MESSAGES.en)).toBe('Saved on device');
  });

  it('the reserved "local" literal also maps to "Saved on device"', () => {
    expect(resolveReflectionSyncStatusLabel('local', MESSAGES.en)).toBe('Saved on device');
  });

  it('"pending" maps to "Pending sync"', () => {
    expect(resolveReflectionSyncStatusLabel('pending', MESSAGES.en)).toBe('Pending sync');
  });

  it('"synced" (signed-in, downloaded/uploaded) maps to "Synced"', () => {
    expect(resolveReflectionSyncStatusLabel('synced', MESSAGES.en)).toBe('Synced');
  });

  it('resolves distinct, non-empty labels in every locale', () => {
    for (const locale of APP_LOCALES) {
      const labels = [
        resolveReflectionSyncStatusLabel(undefined, MESSAGES[locale]),
        resolveReflectionSyncStatusLabel('pending', MESSAGES[locale]),
        resolveReflectionSyncStatusLabel('synced', MESSAGES[locale]),
      ];
      labels.forEach((label) => expect(label.trim().length).toBeGreaterThan(0));
      expect(new Set(labels).size).toBe(3);
    }
  });
});

describe('formatReflectionDate', () => {
  it('formats a fixed timestamp without throwing, for every supported locale', () => {
    const timestamp = new Date('2026-01-05T00:00:00.000Z').getTime();
    for (const locale of APP_LOCALES) {
      const formatted = formatReflectionDate(timestamp, locale);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
    }
  });
});

describe('reflections localization (messages.ts)', () => {
  it('English title/subtitle/empty-state copy matches the approved wording exactly', () => {
    expect(MESSAGES.en.reflections.title).toBe('My Reflections');
    expect(MESSAGES.en.reflections.emptyTitle).toBe('No reflections yet');
    expect(MESSAGES.en.reflections.emptyMessage).toBe('Open an ayah and write a reflection. It will appear here.');
  });

  it('Standard Arabic title/empty-state copy matches the approved wording exactly', () => {
    expect(MESSAGES.ar.reflections.title).toBe('خواطري');
    expect(MESSAGES.ar.reflections.emptyTitle).toBe('لا توجد خواطر بعد');
    expect(MESSAGES.ar.reflections.emptyMessage).toBe('افتح آية وأضف خاطرة، وستظهر هنا.');
  });

  it('Egyptian Arabic uses the exact same wording as Standard Arabic for this general-UI section', () => {
    expect(MESSAGES['ar-EG'].reflections).toEqual(MESSAGES.ar.reflections);
    expect(MESSAGES['ar-EG'].reflections.title).toBe('خواطري');
  });

  it('every locale defines the exact same reflections keys — none missing a string the others have', () => {
    const keySet = (locale: (typeof APP_LOCALES)[number]) => Object.keys(MESSAGES[locale].reflections).sort();
    expect(keySet('ar')).toEqual(keySet('en'));
    expect(keySet('ar-EG')).toEqual(keySet('en'));
  });

  it('every reflections string in every locale is non-empty', () => {
    for (const locale of APP_LOCALES) {
      for (const [key, value] of Object.entries(MESSAGES[locale].reflections)) {
        expect(value.trim().length, `${locale}.reflections.${key} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it('adds home.openReflections without disturbing the existing home.openFavorites label', () => {
    expect(MESSAGES.en.home.openReflections).toBe('Open My Reflections');
    expect(MESSAGES.en.home.openFavorites).toBe('Open saved ayahs');
    expect(MESSAGES.ar.home.openReflections).toBe('فتح خواطري');
    expect(MESSAGES['ar-EG'].home.openReflections).toBe('فتح خواطري');
  });

  it('the reflection editor keeps its own title and Save action', () => {
    expect(MESSAGES.en.reflection.title).toBe('Reflections on this ayah');
    expect(MESSAGES.en.reflection.save).toBe('Save');
  });
});

describe('index.tsx: My Reflections header action (source-scan)', () => {
  const homeSource = readFileSync(resolve(__dirname, '../src/app/index.tsx'), 'utf-8');

  it('routes a NotebookPen icon to /reflections, beside Settings and Favorites', () => {
    expect(homeSource).toMatch(/NotebookPen/);
    expect(homeSource).toMatch(/<Link href="\/reflections" asChild>/);
    expect(homeSource).toMatch(/<NotebookPen size=\{20\} color=\{colors\.ink\} strokeWidth=\{2\} \/>/);
  });

  it('gives the new action a localized accessibility label, never a hardcoded string', () => {
    expect(homeSource).toMatch(/accessibilityLabel=\{messages\.home\.openReflections\}/);
  });

  it('keeps Settings, Favorites, and Reflections inside the same RTL-aware headerActions row', () => {
    const actionsBlock = homeSource.match(/<View style=\{\[styles\.headerActions,[\s\S]*?\n {8}<\/View>/)?.[0] ?? '';
    expect(actionsBlock).toContain('/settings');
    expect(actionsBlock).toContain('/favorites');
    expect(actionsBlock).toContain('/reflections');
  });

  it('orders the header actions Saved -> Reflections -> Settings, so Settings renders last (the outside screen corner in both LTR and the RTL-mirrored row)', () => {
    const actionsBlock = homeSource.match(/<View style=\{\[styles\.headerActions,[\s\S]*?\n {8}<\/View>/)?.[0] ?? '';
    const favoritesIndex = actionsBlock.indexOf('/favorites');
    const reflectionsIndex = actionsBlock.indexOf('/reflections');
    const settingsIndex = actionsBlock.indexOf('/settings');
    expect(favoritesIndex).toBeGreaterThanOrEqual(0);
    expect(reflectionsIndex).toBeGreaterThan(favoritesIndex);
    expect(settingsIndex).toBeGreaterThan(reflectionsIndex);
  });

  it('guards the title block with flexShrink so three icon buttons can never overflow/clip it on narrow screens', () => {
    expect(homeSource).toMatch(/headerTitleBlock:\s*\{\s*flexShrink:\s*1,?\s*\}/);
    expect(homeSource).toMatch(/<View style=\{styles\.headerTitleBlock\}>/);
  });

  it('never shrinks the wordmark font size as a fix for the extra icon (no adjustsFontSizeToFit hack)', () => {
    expect(homeSource).not.toMatch(/adjustsFontSizeToFit/);
    expect(homeSource).toMatch(/wordmark:\s*\{[^}]*fontSize:\s*29/s);
  });
});

describe('reflections.tsx and useReflections.ts: offline, guest-friendly, single editor (source-scan)', () => {
  const screenSource = readFileSync(resolve(__dirname, '../src/app/reflections.tsx'), 'utf-8');
  const hookSource = readFileSync(resolve(__dirname, '../src/hooks/useReflections.ts'), 'utf-8');
  const cardSource = readFileSync(resolve(__dirname, '../src/components/ReflectionListCard.tsx'), 'utf-8');

  it('the hook never imports the network layer or requires auth', () => {
    expect(hookSource).not.toMatch(/from ['"]@\/services\/api['"]/);
    expect(hookSource).not.toMatch(/\bfetch\(/);
    expect(hookSource).not.toMatch(/from ['"]@\/auth\/useAuth['"]/);
  });

  it('the screen never imports the network layer directly — any account sync reuses the existing refreshSync(), never a bespoke fetch', () => {
    expect(screenSource).not.toMatch(/from ['"]@\/services\/api['"]/);
    expect(screenSource).not.toMatch(/\bfetch\(/);
  });

  it('pull-to-refresh reuses the existing refreshSync() (a safe no-op for a guest) — it never gates the reflection list itself on being signed in, so guests still browse freely', () => {
    expect(screenSource).toMatch(/from '@\/auth\/useAuth'/);
    expect(screenSource).toMatch(/refreshSync\(\)/);
    // Only the pull-to-refresh sync call touches auth; nothing here ever
    // conditions rendering the list (or anything else) on account status.
    expect(screenSource).not.toMatch(/status/);
  });

  it('uses a performant FlatList for the reflection list, not a large ScrollView', () => {
    expect(screenSource).toMatch(/<FlatList/);
    expect(screenSource).not.toMatch(/<ScrollView/);
  });

  it('reuses the existing ReflectionSheet for editing — never a second editor or duplicated save logic', () => {
    expect(screenSource).toMatch(/from '@\/components\/ReflectionSheet'/);
    expect(screenSource).not.toMatch(/saveReflection\(/);
    expect(screenSource).not.toMatch(/getReflection\(/);
    expect(cardSource).not.toMatch(/saveReflection\(|getReflection\(/);
  });

  it('opens the sheet for the exact tapped verseKey', () => {
    expect(screenSource).toMatch(/setActiveVerseKey\(item\.reflection\.verseKey\)/);
    expect(screenSource).toMatch(/verseKey=\{activeVerseKey\}/);
  });

  it('refreshes the list after the sheet closes, so edited text/timestamps update immediately', () => {
    expect(screenSource).toMatch(/closeSheet[\s\S]*?void refresh\(\)/);
    expect(screenSource).toMatch(/onClose=\{closeSheet\}/);
  });

  it('the list card never independently reads AsyncStorage — it only renders the already-resolved item prop', () => {
    expect(cardSource).not.toMatch(/AsyncStorage/);
  });

  it('never writes or duplicates Quran Arabic anywhere in this feature\'s new files', () => {
    expect(hookSource).not.toMatch(/AsyncStorage\.setItem/);
    expect(cardSource).not.toMatch(/AsyncStorage\.setItem/);
    expect(screenSource).not.toMatch(/AsyncStorage\.setItem/);
  });

  it('resolves Arabic text from the local Quran repository, never from a cached/stored field', () => {
    expect(hookSource).toMatch(/getVerseByKey\(reflection\.verseKey\)/);
  });

  it('renders a localized, verseKey-specific accessibility label per card', () => {
    expect(cardSource).toMatch(/accessibilityLabel=\{`\$\{messages\.reflections\.openReflectionLabel\}\s*\$\{reflection\.verseKey\}`\}/);
  });

  it('mirrors the reference row for RTL locales', () => {
    expect(cardSource).toMatch(/isRtl && styles\.referenceRowRtl/);
    expect(cardSource).toMatch(/referenceRowRtl:\s*\{\s*flexDirection:\s*'row-reverse'/);
  });

  it('shows the localized unresolved-reference note instead of inventing a surah name/fake Arabic text', () => {
    expect(cardSource).toMatch(/messages\.reflections\.referenceUnresolved/);
  });

  it('displays the localized sync status via the shared pure resolver, not ad hoc inline logic', () => {
    expect(cardSource).toMatch(/resolveReflectionSyncStatusLabel\(reflection\.syncState, messages\)/);
  });
});
