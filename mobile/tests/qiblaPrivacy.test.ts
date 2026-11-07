import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Qibla privacy and battery rules, by source scan (docs/qibla.md): the location is used on the device only. No
 * coordinate is logged, stored, sent or synchronised; expo-location is imported in exactly one file; no background
 * location, no continuous position watch.
 */

const src = resolve(__dirname, '../src');
const qiblaDir = join(src, 'qibla');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const qiblaFiles = files(qiblaDir).map((path) => ({ path: relative(src, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf-8') }));
const allFiles = files(src).map((path) => ({ path: relative(src, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf-8') }));
const importsOf = (text: string) => [...text.matchAll(/from '([^']+)'|import\('([^']+)'\)|require\('([^']+)'\)/g)].map((m) => m[1] ?? m[2] ?? m[3]);

describe('Qibla location privacy (source scan)', () => {
  it('the Qibla module exists and is scanned', () => {
    expect(qiblaFiles.map((f) => f.path)).toEqual(
      expect.arrayContaining(['qibla/qiblaCompassController.ts', 'qibla/useQiblaCompass.ts', 'qibla/locationSource.native.ts', 'qibla/locationSource.ts']),
    );
  });

  it('expo-location is imported by exactly one file in the whole app: qibla/locationSource.native.ts', () => {
    const importers = allFiles.filter((f) => importsOf(f.text).includes('expo-location')).map((f) => f.path);
    expect(importers).toEqual(['qibla/locationSource.native.ts']);
  });

  // The Qibla module and its screen. The one file allowed local storage is the chosen city's ID (below).
  const screenFiles = ['app/qibla.tsx'].map((path) => ({ path, text: readFileSync(join(src, path), 'utf-8') }));
  const STORAGE_FILE = 'qibla/manualCityStorage.ts';

  it('no Qibla file can reach the network, sync or logging; only the city-ID file touches storage', () => {
    const forbiddenModules = [/^@\/services\//, /^@\/sync\//, /^@\/storage\//, /^@\/auth\//, /^@\/utils\/devLog/, /expo-secure-store/, /expo-sqlite/, /expo-file-system/, /sentry/i, /analytics/i, /expo-network/];
    for (const file of [...qiblaFiles, ...screenFiles]) {
      for (const module of importsOf(file.text)) {
        for (const pattern of forbiddenModules) expect(module, `${file.path} imports ${module}`).not.toMatch(pattern);
        if (file.path !== STORAGE_FILE) expect(module, `${file.path} imports ${module}`).not.toMatch(/async-storage/);
      }
      // Code only (comments may mention these words).
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file.path).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon/);
      expect(code, file.path).not.toMatch(/\bconsole\.|devLog\(/);
      if (file.path !== STORAGE_FILE) expect(code, file.path).not.toMatch(/AsyncStorage|localStorage|sessionStorage|indexedDB/);
    }
  });

  it('the city-ID file stores one key, holding a number only (never coordinates or a name), and nothing syncs it', () => {
    const code = qiblaFiles.find((f) => f.path === STORAGE_FILE)!.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code.match(/AsyncStorage\.setItem\(/g)).toHaveLength(1);
    expect(code).toMatch(/AsyncStorage\.setItem\(MANUAL_CITY_KEY, String\(id\)\)/);
    expect(code).toMatch(/Number\.isSafeInteger\(id\)/);
    expect(code).not.toMatch(/latitude|longitude|coordinates|label|name/i);
    const preferenceFields = readFileSync(join(src, 'sync/preferenceFields.ts'), 'utf-8');
    expect(preferenceFields).not.toMatch(/qibla|manualCity/i);
  });

  it('no background location, no continuous position watch, no geocoding anywhere in the app', () => {
    for (const file of allFiles) {
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file.path).not.toMatch(/requestBackgroundPermissionsAsync|startLocationUpdatesAsync|startGeofencingAsync|watchPositionAsync|reverseGeocodeAsync|geocodeAsync/);
    }
  });

  const codeOf = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const typeBody = (text: string, name: string) => codeOf(text.match(new RegExp(`export type ${name} =([\\s\\S]*?)\\n\\};?\\n`))?.[1] ?? '');
  const controller = () => qiblaFiles.find((f) => f.path === 'qibla/qiblaCompassController.ts')!.text;

  it('the snapshot carries the bearing only: no coordinates and no distance (bearing + distance would locate the user)', () => {
    const snapshotType = typeBody(controller(), 'QiblaSnapshot');
    expect(snapshotType).toMatch(/qibla: QiblaView \| null;/);
    expect(snapshotType).not.toMatch(/coordinates|latitude|longitude|Coordinates|distance|QiblaResult/i);
    const view = codeOf(controller().match(/export type QiblaView =([\s\S]*?);\n\n/)?.[1] ?? '');
    expect(view).toMatch(/kind: 'bearing'; bearing: number/);
    expect(view).not.toMatch(/distance|coordinates|latitude|longitude/i);
  });

  it('the diagnostics read-out has no coordinates and no distance either', () => {
    const diagnosticsType = typeBody(controller(), 'QiblaDiagnostics');
    expect(diagnosticsType).toMatch(/trueMinusMagneticDeg/);
    expect(diagnosticsType).not.toMatch(/coordinates|latitude|longitude|Coordinates|distance|QiblaResult/i);
  });
});
