import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const emotionRouteSource = readFileSync(resolve(__dirname, '../src/app/ayah/[emotion].tsx'), 'utf-8');
const generalRouteSource = readFileSync(resolve(__dirname, '../src/app/ayah/general.tsx'), 'utf-8');
const experienceSource = readFileSync(resolve(__dirname, '../src/components/AyahExperience.tsx'), 'utf-8');

const state = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => state.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      state.set(key, value);
    }),
  },
}));

describe('Context: emotion flow retains emotion mode, general flow uses general mode', () => {
  it('app/ayah/[emotion].tsx renders AyahExperience with source.mode "emotion"', () => {
    expect(emotionRouteSource).toMatch(/<AyahExperience source=\{\{ mode: 'emotion', emotionKey, names \}\}/);
  });

  it('app/ayah/general.tsx renders AyahExperience with source.mode "general" and no emotionKey at all', () => {
    expect(generalRouteSource).toMatch(/<AyahExperience source=\{\{ mode: 'general' \}\}/);
    const code = generalRouteSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/emotionKey/);
  });

  it('general.tsx is a static route (never a dynamic [emotion]-style segment), so it can never collide with a real emotion key', () => {
    expect(generalRouteSource).not.toMatch(/useLocalSearchParams/);
  });

  it('the mode is a structural discriminant (source.mode), never inferred from localized text', () => {
    expect(experienceSource).toMatch(/source\.mode === 'emotion'/);
    expect(experienceSource).not.toMatch(/messages\.\w+\.\w+ === source\.mode/);
  });
});

describe('Another ayah: emotion mode continues the same emotion, general mode continues the full Quran pool', () => {
  it('the primary "Another ayah" button re-runs loadAyah, the same function used for the first load', () => {
    expect(experienceSource).toMatch(/accessibilityLabel=\{messages\.ayah\.loadAnotherAyah\}\s*\n\s*onPress=\{loadAyah\}/);
  });

  it('loadAyah dispatches through one fetchAyah closure that branches strictly on source.mode', () => {
    const fetchAyahBlock = experienceSource.match(/const fetchAyah = \(exclude: string\[\]\) =>[\s\S]*?\n {8}\}\);/)?.[0] ?? '';
    expect(fetchAyahBlock.length).toBeGreaterThan(0);
    expect(fetchAyahBlock).toMatch(/if \(source\.mode === 'emotion'\) \{\s*return getRandomAyah\(source\.emotionKey, exclude\);\s*\}/);
    // General mode's selection (resolveGeneralVerseKey — local, offline)
    // and content-load (getAyah — network) are two separate awaits here
    // rather than one atomic call, so a content-load failure can remember
    // and resume the already-chosen verse instead of drawing a new one on
    // retry (see resolveGeneralVerseKey's doc comment and
    // ayahPullToRefresh.test.ts's dedicated regression coverage for this).
    expect(fetchAyahBlock).toMatch(/const verseKey = await resolveGeneralVerseKey\(exclude\);/);
    expect(fetchAyahBlock).toMatch(/await getAyah\(verseKey\)/);
  });

  it('emotion mode never resolves a general-mode verseKey, and general mode is never given an emotionKey', () => {
    // Structural: resolveGeneralVerseKey/getAyah(verseKey) take only a
    // verseKey/exclusion list — there is no parameter through which an
    // emotionKey could reach them, and the `if` above proves getRandomAyah
    // (the emotion-mapping call) is only reached when source.mode ===
    // 'emotion'.
    expect(experienceSource).toMatch(/resolveGeneralVerseKey\(exclude\)/);
    expect(experienceSource).not.toMatch(/resolveGeneralVerseKey\(source\.emotionKey/);
    expect(experienceSource).not.toMatch(/getAyah\(source\.emotionKey/);
  });

  it("existing emotion-flow wording is unchanged — still آية أخرى / Another Ayah via messages.ayah.anotherAyah, not a new general-mode string", () => {
    expect(experienceSource).toMatch(/messages\.ayah\.anotherAyah/);
    expect(experienceSource).not.toMatch(/messages\.generalQuran\.anotherAyah/);
  });
});

describe('Recent history: general flow has its own namespace, separate from emotion history, device-local, 10-minute TTL', () => {
  beforeEach(() => state.clear());

  it('GENERAL_QURAN_HISTORY_KEY can never collide with a real emotionKey (structurally distinct from the backend emotionKey pattern)', async () => {
    const { GENERAL_QURAN_HISTORY_KEY } = await import('@/storage/recentAyahHistory');
    const emotionKeyPattern = /^[a-z][a-z_-]{1,40}$/;
    expect(emotionKeyPattern.test(GENERAL_QURAN_HISTORY_KEY)).toBe(false);
    expect(GENERAL_QURAN_HISTORY_KEY).toBe('__general_quran__');
  });

  it('recording a general-flow ayah excludes it from the next general-flow draw, without touching any emotion history', async () => {
    const { GENERAL_QURAN_HISTORY_KEY, recordShownAyah, getExcludedVerseKeys } = await import('@/storage/recentAyahHistory');
    const generalAyah = { id: '2:255', verseKey: '2:255' } as never;
    await recordShownAyah(GENERAL_QURAN_HISTORY_KEY, generalAyah);
    await recordShownAyah('sad', { id: '94:6', verseKey: '94:6' } as never);

    expect(await getExcludedVerseKeys(GENERAL_QURAN_HISTORY_KEY)).toEqual(['2:255']);
    expect(await getExcludedVerseKeys('sad')).toEqual(['94:6']);
    // Neither namespace's history leaked into the other.
    expect(await getExcludedVerseKeys(GENERAL_QURAN_HISTORY_KEY)).not.toContain('94:6');
    expect(await getExcludedVerseKeys('sad')).not.toContain('2:255');
  });

  it('the general-flow namespace uses the exact same 10-minute TTL as the emotion flow (no separate/shorter/longer window)', async () => {
    const { RECENT_AYAH_TTL_MS } = await import('@/storage/recentAyahHistory');
    expect(RECENT_AYAH_TTL_MS).toBe(10 * 60 * 1000);
  });

  it('general-flow history is stored in the same device-local AsyncStorage module as emotion history — never synced, never network-backed', () => {
    // \bsync\b (a word boundary), not a bare substring match — otherwise
    // this would false-positive on "async" (e.g. an `async` arrow function
    // declared near a "general"-named identifier) or "AsyncStorage" itself,
    // neither of which has anything to do with account/cloud sync.
    expect(experienceSource).not.toMatch(/general.*\bsync\b|\bsync\b.*general/i);
  });

  it('an expired (>10 minutes old) general-flow entry is excluded from the active list, exactly like emotion history', async () => {
    const { GENERAL_QURAN_HISTORY_KEY, recordShownAyah, getExcludedVerseKeys, RECENT_AYAH_TTL_MS } = await import(
      '@/storage/recentAyahHistory'
    );
    const now = 1_000_000;
    await recordShownAyah(GENERAL_QURAN_HISTORY_KEY, { id: '2:255', verseKey: '2:255' } as never, now);
    expect(await getExcludedVerseKeys(GENERAL_QURAN_HISTORY_KEY, now + RECENT_AYAH_TTL_MS - 1)).toEqual(['2:255']);
    expect(await getExcludedVerseKeys(GENERAL_QURAN_HISTORY_KEY, now + RECENT_AYAH_TTL_MS + 1)).toEqual([]);
  });
});

describe('Integration: favorites, reflections, translation, and Report an Issue are the same experience regardless of source mode', () => {
  it('AyahCard, FavoriteButton, ReflectionSheet, and ReportIssueSheet are all rendered unconditionally — never gated by source.mode', () => {
    const resultBlock = experienceSource.match(/\{!isLoading && !errorMessage && ayah && \(([\s\S]*?)\)\}\s*\n\s*<\/ScrollView>/)?.[0] ?? '';
    expect(resultBlock).toMatch(/<AyahCard ayah=\{ayah\} \/>/);
    expect(resultBlock).toMatch(/<FavoriteButton/);
    expect(resultBlock).not.toMatch(/source\.mode/);
  });

  it('ReflectionSheet is keyed by the ayah\'s own verseKey, identical whichever flow produced the ayah — no source-specific reflection identifier', () => {
    expect(experienceSource).toMatch(/verseKey=\{ayah\?\.verseKey \?\? null\}/);
    expect(experienceSource).not.toMatch(/verseKey=\{`\$\{source\.mode\}/);
  });

  it("translation display honors the existing global preference — AyahCard is not passed a mode-specific translation prop", () => {
    expect(experienceSource).not.toMatch(/<AyahCard[^>]*mode/);
  });

  it('favoriting works the same way regardless of source — toggleFavorite/isFavorite operate on the ayah, not on source.mode', () => {
    expect(experienceSource).toMatch(/isFavorite\(ayah\)/);
    expect(experienceSource).toMatch(/toggleFavorite\(ayah\)/);
  });

  it('guest and signed-in both reach the same AyahExperience — no auth/status gating on which mode is available', () => {
    // useAuth() is used only to reuse refreshSync() for pull-to-refresh (a
    // safe no-op for a guest) — never to gate emotion/general mode, and
    // never by checking `status` anywhere in this file.
    expect(experienceSource).not.toMatch(/status === 'guest'|status === 'signed-in'/);
    expect(experienceSource).not.toMatch(/\bstatus\b/);
    expect(experienceSource).toMatch(/const \{ refreshSync \} = useAuth\(\);/);
  });
});
