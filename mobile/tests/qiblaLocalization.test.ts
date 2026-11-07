import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_LOCALES } from '@/localization/locales';
import { MESSAGES, getMessages, type Messages } from '@/localization/messages';

/**
 * Qibla Direction's texts live in the central localization (localization/messages.ts, `qibla`), like every other
 * feature: one shape per locale, ar-EG on the same Standard Arabic as ar, English fallback through getMessages.
 */

type Leaf = string | string[];
function leaves(value: unknown, path = ''): [string, Leaf][] {
  if (typeof value === 'string' || Array.isArray(value)) return [[path, value as Leaf]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
}
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const qibla = (locale: (typeof APP_LOCALES)[number]): Messages['qibla'] => MESSAGES[locale].qibla;

describe('Qibla texts in the central localization', () => {
  it('en, ar and ar-EG all have every Qibla key, with the same structure', () => {
    const paths = leaves(qibla('en')).map(([path]) => path);
    expect(paths.length).toBeGreaterThan(60);
    for (const locale of APP_LOCALES) {
      expect(leaves(qibla(locale)).map(([path]) => path), locale).toEqual(paths);
      for (const [path, value] of leaves(qibla(locale))) {
        for (const text of Array.isArray(value) ? value : [value]) expect(text.trim().length, `${locale} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it('follows the central convention: a flat section of strings (no nested groups or arrays)', () => {
    for (const locale of APP_LOCALES) {
      for (const [key, value] of Object.entries(qibla(locale))) expect(typeof value, `${locale}.qibla.${key}`).toBe('string');
    }
  });

  it('ar-EG uses the same Standard Arabic as ar (the app’s general-UI rule)', () => {
    expect(qibla('ar-EG')).toBe(qibla('ar'));
  });

  it('every translation uses the same placeholders as English', () => {
    const en = Object.fromEntries(leaves(qibla('en')));
    for (const locale of APP_LOCALES) {
      for (const [path, value] of leaves(qibla(locale))) {
        if (typeof value === 'string') expect(placeholders(value), `${locale} ${path}`).toEqual(placeholders(en[path] as string));
      }
    }
  });

  it('keeps the approved wording, exactly', () => {
    expect(qibla('en')).toMatchObject({ homeAction: 'Qibla Direction', title: 'Qibla Direction', instruction: 'Point your phone toward the Qibla', aligned: 'Lined up with the Qibla bearing' });
    expect(qibla('ar')).toMatchObject({ homeAction: 'اتجاه القبلة', title: 'اتجاه القبلة', instruction: 'وجّه هاتفك نحو القبلة', aligned: 'متّجه نحو القبلة' });
    const cardinals = (m: Messages['qibla']) => [m.cardinalNorth, m.cardinalEast, m.cardinalSouth, m.cardinalWest];
    expect(cardinals(qibla('ar'))).toEqual(['ش', 'ق', 'ج', 'غ']);
    expect(cardinals(qibla('en'))).toEqual(['N', 'E', 'S', 'W']);
  });

  it('Western digits only (owner decision): no Arabic-Indic digits in any Qibla text', () => {
    for (const locale of APP_LOCALES) {
      for (const [path, value] of leaves(qibla(locale))) {
        for (const text of Array.isArray(value) ? value : [value]) expect(text, `${locale} ${path}`).not.toMatch(/[٠-٩۰-۹]/);
      }
    }
  });

  it('the privacy promise appears where location is asked for, in both languages', () => {
    const check = (m: Messages['qibla']) => [m.permissionBody, m.pickerNote].join(' ');
    expect(check(qibla('en'))).toMatch(/on this device only.*never sent or stored.*saved on this device only/s);
    expect(check(qibla('ar'))).toMatch(/على هذا الجهاز فقط.*لا يُرسَل ولا يُحفَظ.*على هذا الجهاز فقط/s);
  });

  it('falls back to English for an unknown locale, as every section does', () => {
    expect(getMessages('xx' as never).qibla).toBe(qibla('en'));
  });
});

describe('one translation system', () => {
  const src = resolve(__dirname, '../src');
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });

  it('the separate qibla/qiblaMessages.ts is gone and nothing refers to it', () => {
    expect(existsSync(join(src, 'qibla/qiblaMessages.ts'))).toBe(false);
    for (const file of files(src)) expect(readFileSync(file, 'utf-8'), file).not.toMatch(/qiblaMessages|getQiblaMessages|QIBLA_MESSAGES/);
  });

  it('Home and the Qibla screen read the central messages', () => {
    const home = readFileSync(join(src, 'app/(tabs)/index.tsx'), 'utf-8');
    expect(home).toMatch(/accessibilityLabel=\{messages\.qibla\.homeAction\}/);
    expect(home).toMatch(/accessibilityHint=\{messages\.qibla\.homeActionHint\}/);
    expect(readFileSync(join(src, 'app/qibla.tsx'), 'utf-8')).toMatch(/const m = messages\.qibla;/);
  });
});
