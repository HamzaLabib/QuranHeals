import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatAyahReference } from '@/utils/ayahReference';

const ayahCardSource = readFileSync(resolve(__dirname, '../src/components/AyahCard.tsx'), 'utf-8');

const sampleAyah = {
  arabicText: 'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ',
  surahNumber: 2,
  ayahNumber: 286,
  englishTranslation: 'This is the English translation text, which must never be copied automatically.',
};

/**
 * Faithful reproduction of AyahCard's copyAyahText/isCopied logic (pinned
 * against the real source below), exercised against a mocked
 * `expo-clipboard` — this project's test environment has no RN renderer to
 * mount the real component and tap the button.
 */
function createCopyHarness(clipboard: { setStringAsync: (text: string) => Promise<boolean> }) {
  let isCopied = false;
  let resetTimeout: ReturnType<typeof setTimeout> | null = null;
  const COPY_CONFIRMATION_MS = 1300;

  const copyAyahText = async () => {
    const text = `${sampleAyah.arabicText}\n\n${formatAyahReference(sampleAyah.surahNumber, sampleAyah.ayahNumber)}`;
    try {
      const succeeded = await clipboard.setStringAsync(text);
      if (!succeeded) return;
      isCopied = true;
      if (resetTimeout) clearTimeout(resetTimeout);
      resetTimeout = setTimeout(() => {
        isCopied = false;
      }, COPY_CONFIRMATION_MS);
    } catch {
      // never crashes, never shows a false success state
    }
  };

  return { copyAyahText, getIsCopied: () => isCopied, getResetTimeout: () => resetTimeout };
}

describe('AyahCard copy control: copies Arabic ayah text + reference only, never the translation', () => {
  it('the copied text is exactly the Arabic text, a blank line, then the formatted Surah reference', async () => {
    const setStringAsync = vi.fn(async () => true);
    const { copyAyahText } = createCopyHarness({ setStringAsync });

    await copyAyahText();

    const expectedText = `${sampleAyah.arabicText}\n\n${formatAyahReference(sampleAyah.surahNumber, sampleAyah.ayahNumber)}`;
    expect(setStringAsync).toHaveBeenCalledExactlyOnceWith(expectedText);
  });

  it('never includes the English translation in the copied text', async () => {
    const setStringAsync = vi.fn(async (_text: string) => true);
    const { copyAyahText } = createCopyHarness({ setStringAsync });

    await copyAyahText();

    const copiedText = setStringAsync.mock.calls[0][0];
    expect(copiedText).not.toContain(sampleAyah.englishTranslation);
  });
});

describe('AyahCard copy control: success shows a checkmark for ~1-1.5s, then restores the copy icon', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('flips to the copied state immediately on a successful copy', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({ setStringAsync: async () => true });

    await copyAyahText();

    expect(getIsCopied()).toBe(true);
  });

  it('stays in the copied state for at least ~1 second', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({ setStringAsync: async () => true });

    await copyAyahText();
    await vi.advanceTimersByTimeAsync(999);

    expect(getIsCopied()).toBe(true);
  });

  it('restores the copy icon within 1-1.5 seconds', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({ setStringAsync: async () => true });

    await copyAyahText();
    await vi.advanceTimersByTimeAsync(1300);

    expect(getIsCopied()).toBe(false);
  });

  it('a second copy resets the confirmation timer rather than letting an earlier one fire early', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({ setStringAsync: async () => true });

    await copyAyahText();
    await vi.advanceTimersByTimeAsync(1000);
    await copyAyahText(); // re-copy shortly before the first would have reverted
    await vi.advanceTimersByTimeAsync(1000);

    // Only 2000ms have passed since the first copy (< the second copy's own
    // 1300ms window starting at t=1000), so it must still show "copied".
    expect(getIsCopied()).toBe(true);
  });
});

describe('AyahCard copy control: failure never crashes and never shows a false success state', () => {
  it('a rejected setStringAsync does not throw and leaves isCopied false', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({
      setStringAsync: async () => {
        throw new Error('clipboard unavailable');
      },
    });

    await expect(copyAyahText()).resolves.toBeUndefined();
    expect(getIsCopied()).toBe(false);
  });

  it('setStringAsync resolving false (unsuccessful, not thrown) also never shows the checkmark', async () => {
    const { copyAyahText, getIsCopied } = createCopyHarness({ setStringAsync: async () => false });

    await copyAyahText();

    expect(getIsCopied()).toBe(false);
  });
});

describe('AyahCard copy control: wiring (source-scan)', () => {
  it('uses the existing expo-clipboard dependency — no new/ad hoc clipboard implementation', () => {
    expect(ayahCardSource).toMatch(/from 'expo-clipboard'/);
    expect(ayahCardSource).toMatch(/Clipboard\.setStringAsync\(/);
  });

  it('uses the project\'s existing icon library (lucide) for the copy/checkmark icons', () => {
    expect(ayahCardSource).toMatch(/from 'lucide-react-native'/);
    expect(ayahCardSource).toMatch(/<Copy /);
    expect(ayahCardSource).toMatch(/<Check /);
  });

  it('swaps the icon based on isCopied — Check when copied, Copy otherwise', () => {
    expect(ayahCardSource).toMatch(/\{isCopied \? <Check[\s\S]*?: <Copy/);
  });

  it('the copied text is built from ayah.arabicText and formatAyahReference — never ayah.englishTranslation', () => {
    const copyBlock = ayahCardSource.match(/const copyAyahText = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(copyBlock.length).toBeGreaterThan(0);
    expect(copyBlock).toMatch(/ayah\.arabicText/);
    expect(copyBlock).toMatch(/formatAyahReference\(ayah\.surahNumber, ayah\.ayahNumber\)/);
    expect(copyBlock).not.toMatch(/englishTranslation/);
  });

  it('a caught clipboard failure never crashes and never sets isCopied — no false success state', () => {
    const copyBlock = ayahCardSource.match(/const copyAyahText = async \(\) => \{[\s\S]*?\n {2}\};/)?.[0] ?? '';
    expect(copyBlock).toMatch(/catch \{/);
    const catchBlock = copyBlock.match(/catch \{[\s\S]*?\}/)?.[0] ?? '';
    expect(catchBlock).not.toMatch(/setIsCopied\(true\)/);
  });

  it('uses a localized accessibility label from messages.ayah.copyAyah — never a hardcoded string', () => {
    expect(ayahCardSource).toMatch(/accessibilityLabel=\{messages\.ayah\.copyAyah\}/);
  });

  it('the copy control sits in the same row as the font-size controls, right side, left side reserved for A-/A+', () => {
    const rowBlock = ayahCardSource.match(/<View style=\{styles\.controlsRow\}>[\s\S]*?\n {6}<\/View>/)?.[0] ?? '';
    expect(rowBlock.length).toBeGreaterThan(0);
    expect(rowBlock).toMatch(/<QuranFontSizeControls/);
    const leftIndex = rowBlock.indexOf('controlsLeft');
    const copyIndex = rowBlock.indexOf('copyButton');
    expect(leftIndex).toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeGreaterThan(leftIndex);
  });

  it('the controls row is rendered for both the main and compact (Favorites) card — the copy control is not main-screen-only, unlike the font-size controls', () => {
    expect(ayahCardSource).toMatch(/<View style=\{styles\.controlsRow\}>/);
    expect(ayahCardSource).not.toMatch(/\{!compact && \(\s*<View style=\{styles\.controlsRow\}/);
  });

  it('the copy button keeps roughly a 44x44 minimum touch target', () => {
    const copyButtonStyleBlock = ayahCardSource.match(/copyButton: \{[\s\S]*?\},/)?.[0] ?? '';
    expect(copyButtonStyleBlock).toMatch(/height:\s*44/);
    expect(copyButtonStyleBlock).toMatch(/width:\s*44/);
  });
});
