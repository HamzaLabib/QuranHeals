import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { createElement } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

/**
 * The Qibla diagnostics panel can never reach a production build (docs/qibla.md, "Device diagnostics"):
 *  - the route loads it only inside `__DEV__ ? require(...) : null`, which Metro folds away in release bundles;
 *  - nothing else in the app imports it or links to its route; Home and the tabs are untouched;
 *  - with __DEV__ false (vitest runs as a release bundle does), the route renders only a redirect to Home and the
 *    panel module is never even evaluated;
 *  - scripts/verify-qibla-diagnostics-excluded.mjs checks the real production export for the panel's strings.
 */

const src = resolve(__dirname, '../src');
const routePath = join(src, 'app/qibla-diagnostics.tsx');
const routeSource = readFileSync(routePath, 'utf-8');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}
const all = files(src).map((path) => ({ path: relative(src, path).replaceAll('\\', '/'), text: readFileSync(path, 'utf-8') }));
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const panelEvaluated = vi.hoisted(() => ({ value: false }));
vi.mock('@/qibla/diagnostics/QiblaDiagnosticsPanel', () => {
  panelEvaluated.value = true;
  return { QiblaDiagnosticsPanel: () => 'PANEL' };
});
const redirects = vi.hoisted(() => [] as string[]);
vi.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    redirects.push(href);
    return null;
  },
}));

describe('Qibla diagnostics: development builds only', () => {
  it('vitest runs with __DEV__ false, like a release bundle', () => {
    expect(__DEV__).toBe(false);
  });

  it('the route loads the panel only inside `__DEV__ ? require(...) : null` (no static import)', () => {
    const body = code(routeSource);
    expect(body).toMatch(/const DiagnosticsPanel: ComponentType \| null = __DEV__\s*\?\s*\(require\('@\/qibla\/diagnostics\/QiblaDiagnosticsPanel'\)/);
    expect(body).toMatch(/\.QiblaDiagnosticsPanel\s*:\s*null;/);
    expect(body).not.toMatch(/^import .*qibla\/diagnostics/m);
    expect(body).toMatch(/if \(!DiagnosticsPanel\) return <Redirect href="\/" \/>;/);
  });

  it('nothing else in the app imports the diagnostics code', () => {
    const importers = all
      .filter((f) => !f.path.startsWith('qibla/diagnostics/'))
      .filter((f) => /qibla\/diagnostics|\.\/diagnostics\//.test(code(f.text)))
      .map((f) => f.path);
    expect(importers).toEqual(['app/qibla-diagnostics.tsx']);
  });

  it('nothing links to the diagnostics route: it is reached only by its deep link in a development build', () => {
    // A route path ('/qibla-diagnostics') or the deep link, anywhere in code outside the route itself. (The panel's own
    // testIDs, e.g. 'qibla-diagnostics-back', are not links.)
    const linkers = all
      .filter((f) => f.path !== 'app/qibla-diagnostics.tsx' && /['"`]\/qibla-diagnostics|quranheals:\/\/qibla-diagnostics/.test(code(f.text)))
      .map((f) => f.path);
    expect(linkers).toEqual([]);
    // The detector does catch a link.
    expect(/['"`]\/qibla-diagnostics/.test(`router.push('/qibla-diagnostics')`)).toBe(true);
  });

  it('Home opens the normal /qibla screen, never the diagnostics; the five tabs and the tab bar are untouched', () => {
    const home = code(readFileSync(join(src, 'app/(tabs)/index.tsx'), 'utf-8'));
    expect(home).toMatch(/router\.push\('\/qibla'\)/);
    expect(home).not.toMatch(/qibla-diagnostics|qibla\/diagnostics/);
    const qiblaScreen = code(readFileSync(join(src, 'app/qibla.tsx'), 'utf-8'));
    expect(qiblaScreen).not.toMatch(/qibla-diagnostics|qibla\/diagnostics|getDiagnostics/);
    for (const path of ['app/(tabs)/_layout.tsx', 'components/AppTabBar.tsx']) {
      expect(readFileSync(join(src, path), 'utf-8'), path).not.toMatch(/qibla|kaaba/i);
    }
    const tabs = readFileSync(join(src, 'components/AppTabBar.tsx'), 'utf-8');
    expect(tabs).toMatch(/export const APP_TABS = \['index', 'emotions', 'mushaf', 'my-reading', 'reflections'\] as const;/);
  });

  it('in a release bundle the route only redirects to Home, and the panel module is never evaluated', async () => {
    const { default: Route } = await import('@/app/qibla-diagnostics');
    let rendered: unknown;
    await act(async () => {
      rendered = create(createElement(Route)).toJSON();
    });
    expect(rendered).toBeNull();
    expect(redirects).toEqual(['/']);
    expect(panelEvaluated.value).toBe(false);
  });

  it('the production-export check looks for strings that really exist only in the diagnostics code', async () => {
    const { MARKERS } = (await import('../scripts/verify-qibla-diagnostics-excluded.mjs' as string)) as { MARKERS: string[] };
    const diagnosticsText = all.filter((f) => f.path.startsWith('qibla/diagnostics/')).map((f) => f.text).join('\n');
    const elsewhere = all.filter((f) => !f.path.startsWith('qibla/diagnostics/')).map((f) => f.text).join('\n');
    expect(MARKERS.length).toBeGreaterThanOrEqual(3);
    for (const marker of MARKERS) {
      expect(diagnosticsText, marker).toContain(marker);
      expect(elsewhere, marker).not.toContain(marker);
    }
  });
});
