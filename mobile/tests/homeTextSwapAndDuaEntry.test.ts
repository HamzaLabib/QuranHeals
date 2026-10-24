import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LANGUAGES } from '@/localization/locales';
import { MESSAGES } from '@/localization/messages';

/**
 * Home: the tagline and the "reflect" line swapped places, and the "reflect"
 * line has its new approved wording. My Reciting: the دعاء ختم القرآن row
 * shows its title only.
 */
const source = (path: string) => readFileSync(resolve(__dirname, '..', path), 'utf8').split(String.fromCharCode(13)).join('');
const home = source('src/app/(tabs)/index.tsx');
const style = (name: string) => home.match(new RegExp(`\\n  ${name}: \\{[\\s\\S]*?\\n  \\},`))?.[0] ?? '';

describe('Home: the two texts swapped', () => {
  it('under the app name: the new line (home.eyebrow), in the subtitle style; above the emotions question: the tagline (home.subtitle), in the eyebrow style', () => {
    const header = home.slice(home.indexOf('<View style={styles.headerTitleBlock}>'), home.indexOf('<ContinueReadingCard />'));
    expect(header).toMatch(/<Text style=\{\[styles\.wordmark, direction\]\}>\{messages\.appName\}<\/Text>[\s\S]*?<Text testID="home-subtitle" style=\{\[styles\.subtitle, direction\]\}>\{messages\.home\.eyebrow\}<\/Text>/);
    const prompt = home.slice(home.indexOf('<View style={styles.prompt}>'), home.indexOf('{isLoading && ('));
    expect(prompt).toMatch(/<Text testID="home-eyebrow" style=\{\[styles\.eyebrow, direction\]\}>\{messages\.home\.subtitle\}<\/Text>\s*<Text style=\{\[styles\.title, direction\]\}>\{messages\.home\.title\}<\/Text>/);
    // Each once: nothing duplicated, nothing removed.
    expect(home.match(/messages\.home\.eyebrow/g)).toHaveLength(1);
    expect(home.match(/messages\.home\.subtitle/g)).toHaveLength(1);
    expect(home.match(/messages\.appName/g)).toHaveLength(1);
  });

  it('the exact approved new line, in English and Standard Arabic', () => {
    // Shown exactly as written: this position's style (subtitle) never transforms case.
    expect(MESSAGES.en.home.eyebrow).toBe('Live by the Quran');
    expect(MESSAGES['ar-EG'].home.eyebrow).toBe('عِشْ بالقرآن');
    expect(MESSAGES.ar.home.eyebrow).toBe('عِشْ بالقرآن');
  });

  it('the tagline above the emotions question, in both App Languages', () => {
    // Shown exactly as written (no automatic uppercase), with the approved diacritics.
    expect(MESSAGES.en.home.subtitle).toBe('Healing for What Lies Within the Hearts');
    expect(MESSAGES.ar.home.subtitle).toBe('شفاءٌ لما في الصدور');
    expect(APP_LANGUAGES).toEqual(['en', 'ar']);
    // Egyptian Arabic keeps its approved tagline.
    expect(MESSAGES['ar-EG'].home.subtitle).toBe('رسالة من القرآن لكل إحساس بتحسه');
  });

  it('each place keeps its own styling; the longer line wraps beside the header buttons instead of overflowing or being cut', () => {
    expect(style('subtitle')).toMatch(/color: colors\.textSecondary,\s*fontSize: typography\.body,\s*lineHeight: 22,\s*marginTop: spacing\.xs,/);
    expect(style('eyebrow')).toMatch(/color: colors\.accent,\s*fontSize: typography\.small,\s*fontWeight: '700',/);
    expect(style('headerTitleBlock')).toMatch(/flexShrink: 1/);
    // Neither tagline is auto-uppercased: both show exactly as written.
    expect(style('subtitle')).not.toMatch(/textTransform/);
    expect(style('eyebrow')).not.toMatch(/textTransform/);
    expect(home).not.toMatch(/testID="home-(subtitle|eyebrow)"[^>]*numberOfLines/);
  });
});

describe('My Reciting: the دعاء ختم القرآن row', () => {
  const myReading = source('src/app/(tabs)/my-reading.tsx');

  it('shows its title only: the description line is gone, the row still opens the du`a', () => {
    const row = myReading.slice(myReading.indexOf('testID="my-reading-dua"'), myReading.indexOf('</Pressable>', myReading.indexOf('testID="my-reading-dua"')));
    expect(row.match(/<Text\b/g)).toHaveLength(1);
    expect(row).toMatch(/\{copy\.duaEntry\}/);
    // The du`a only: no ورد is passed along (it is confirmed on its own card).
    expect(row).toMatch(/onPress=\{\(\) => router\.push\('\/khatm-dua'\)\}/);
    expect(myReading).not.toMatch(/pendingWird/);
    for (const locale of ['en', 'ar', 'ar-EG'] as const) {
      expect(MESSAGES[locale].myReading).not.toHaveProperty('duaEntryBody');
      // In the App Language: English its own name, Arabic and ar-EG the Arabic.
      expect(MESSAGES[locale].myReading.duaEntry).toBe(locale === 'en' ? "Quran Completion Du'a" : 'دعاء ختم القرآن');
    }
  });
});
