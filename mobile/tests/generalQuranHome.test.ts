import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MESSAGES } from '@/localization/messages';

const indexSource = readFileSync(resolve(__dirname, '../src/app/index.tsx'), 'utf-8');

describe('Home screen: "A Message from the Quran" general action (source-scan)', () => {
  it('renders one action wired to messages.generalQuran.action — no separate heading key', () => {
    expect(indexSource).toMatch(/messages\.generalQuran\.action/);
    expect(indexSource).not.toMatch(/messages\.generalQuran\.heading/);
    expect(indexSource).not.toMatch(/messages\.generalQuran\.button/);
  });

  it('the whole action is one Pressable — not a separate heading Text plus a separate button Pressable', () => {
    // Anchor on the route push (unique to this action) and take the
    // smallest enclosing <Pressable>...</Pressable>, not a naive
    // first-<Pressable>-to-first-match scan (which would sweep in the
    // header's own Settings/Favorites Pressables earlier in the file).
    const routeCallIndex = indexSource.indexOf("router.push('/ayah/general')");
    expect(routeCallIndex).toBeGreaterThan(-1);
    const blockStart = indexSource.lastIndexOf('<Pressable', routeCallIndex);
    const blockEnd = indexSource.indexOf('</Pressable>', routeCallIndex) + '</Pressable>'.length;
    const actionBlock = indexSource.slice(blockStart, blockEnd);

    expect(actionBlock).toContain('generalQuranAction');
    // Exactly one accessibilityLabel/accessibilityRole pair inside the block.
    expect(actionBlock.match(/accessibilityRole="button"/g)).toHaveLength(1);
    expect(actionBlock.match(/accessibilityLabel=\{messages\.generalQuran\.action\}/g)).toHaveLength(1);
    // Referenced exactly twice: the accessibilityLabel and the single
    // visible Text node — never a second, separate label/heading string.
    expect(actionBlock.match(/messages\.generalQuran\.action/g)).toHaveLength(2);
  });

  it("navigates to the general Quran route on press, not the emotion route", () => {
    expect(indexSource).toMatch(/onPress=\{\(\) => router\.push\('\/ayah\/general'\)\}/);
  });

  it('is a distinct, full-width action — never a member of the 29-emotion grid', () => {
    const gridBlock = indexSource.match(/<View style=\{\[styles\.grid,[\s\S]*?<\/View>\s*\)\}/)?.[0] ?? '';
    expect(gridBlock).not.toMatch(/generalQuran/);
  });

  it('uses a distinct style object from EmotionCard — not styled or laid out as a 30th emotion card', () => {
    expect(indexSource).not.toMatch(/<EmotionCard[^>]*generalQuran/);
    expect(indexSource).toMatch(/generalQuranAction:/);
  });

  it('comes after the emotion grid in source order (placed below the emotion experience)', () => {
    const gridIndex = indexSource.indexOf('styles.grid');
    const generalIndex = indexSource.indexOf('generalQuranAction');
    expect(gridIndex).toBeGreaterThan(-1);
    expect(generalIndex).toBeGreaterThan(gridIndex);
  });

  it('has an accessible label and role for touch/screen-reader access', () => {
    expect(indexSource).toMatch(/accessibilityRole="button"[\s\S]{0,60}accessibilityLabel=\{messages\.generalQuran\.action\}/);
  });

  it('the previous two-part heading+button styles no longer exist', () => {
    expect(indexSource).not.toMatch(/generalQuranSection:|generalQuranHeading:|generalQuranButton:|generalQuranButtonText:/);
  });
});

describe('generalQuran localization copy — exact approved wording', () => {
  it('English displays exactly "A Message from the Quran"', () => {
    expect(MESSAGES.en.generalQuran.action).toBe('A Message from the Quran');
  });

  it('Arabic (Standard) displays exactly "رسالة من القرآن"', () => {
    expect(MESSAGES.ar.generalQuran.action).toBe('رسالة من القرآن');
  });

  it('ar-EG displays exactly "رسالة من القرآن" — the same Standard Arabic, not Egyptian colloquial', () => {
    expect(MESSAGES['ar-EG'].generalQuran.action).toBe('رسالة من القرآن');
  });

  it('ar-EG and ar are identical for this label', () => {
    expect(MESSAGES['ar-EG'].generalQuran.action).toBe(MESSAGES.ar.generalQuran.action);
  });

  it('the old heading/button copy is no longer present anywhere in the dictionary', () => {
    const serialized = JSON.stringify(MESSAGES);
    expect(serialized).not.toContain('Need an ayah from the Quran?');
    expect(serialized).not.toContain('Give me an ayah');
    expect(serialized).not.toContain('هل تحتاج إلى آية من القرآن؟');
    expect(serialized).not.toContain('أعطني آية');
  });

  it('loadError is preserved unchanged (still used by AyahExperience on a failed load)', () => {
    expect(MESSAGES.en.generalQuran.loadError).toBe("We couldn't load an ayah. Please try again.");
    expect(MESSAGES.ar.generalQuran.loadError).toBe('تعذّر تحميل الآية. يُرجى المحاولة مرة أخرى.');
    expect(MESSAGES['ar-EG'].generalQuran.loadError).toBe(MESSAGES.ar.generalQuran.loadError);
  });

  it('does not disturb the three approved Egyptian exceptions', () => {
    expect(MESSAGES['ar-EG'].home.title).toBe('إيه إحساسك دلوقتي؟');
    expect(MESSAGES['ar-EG'].home.subtitle).toBe('رسالة من القرآن لكل إحساس بتحسه');
  });
});
