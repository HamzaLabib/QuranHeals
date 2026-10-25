/// <reference types="node" />
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The QCF V1 page-61 font is kept out of this public repository (Quran
 * Foundation's font terms: inside the app only, never a standalone
 * download) and restored by scripts/restore-mushaf-fonts.mjs, pinned in
 * assets/mushaf/qpc-v1/fonts.lock.json. These tests run the real script
 * against a local server: no network, no Quran Foundation CDN.
 */

const mobile = resolve(__dirname, '..');
const script = join(mobile, 'scripts/restore-mushaf-fonts.mjs');
const lock = JSON.parse(readFileSync(join(mobile, 'assets/mushaf/qpc-v1/fonts.lock.json'), 'utf8')) as { fonts: { page: number; file: string; url: string; bytes: number; sha256: string; family: string }[] };
const realFont = readFileSync(join(mobile, 'assets/mushaf/qpc-v1/p61.ttf'));

describe('pin and repository rules', () => {
  it('pins exactly the bundled page-61 font, from Quran Foundation`s documented CDN, with the same hash as qpcV1Fonts.ts', () => {
    expect(lock.fonts).toEqual([expect.objectContaining({ page: 61, file: 'p61.ttf', family: 'QCF_P061', bytes: 155996 })]);
    expect(lock.fonts[0].url).toBe('https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p61.ttf');
    const pinned = readFileSync(join(mobile, 'src/mushaf/qpcV1Fonts.ts'), 'utf8').match(/61: '([0-9a-f]{64})'/)?.[1];
    expect(lock.fonts[0].sha256).toBe(pinned);
    expect(createHash('sha256').update(realFont).digest('hex')).toBe(pinned);
  });

  it('git ignores every Mushaf font file but keeps the pin file tracked', () => {
    const ignored = (path: string) => {
      try {
        execFileSync('git', ['check-ignore', '-q', path], { cwd: mobile });
        return true;
      } catch {
        return false;
      }
    };
    expect(ignored('assets/mushaf/qpc-v1/p61.ttf')).toBe(true);
    expect(ignored('assets/mushaf/qpc-v1/p300.ttf')).toBe(true);
    expect(ignored('assets/mushaf/qcf-v2/p1.woff2')).toBe(true);
    expect(ignored('assets/mushaf/qpc-v1/p61.ttf.partial')).toBe(true);
    expect(ignored('assets/mushaf/qpc-v1/fonts.lock.json')).toBe(false);
  });

  it('is restored automatically: before tests, before starting the app, after install, and before EAS builds', () => {
    const { scripts } = JSON.parse(readFileSync(join(mobile, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    for (const hook of ['pretest', 'prestart', 'preandroid', 'preios', 'preweb', 'eas-build-pre-install', 'fonts:restore']) {
      expect(scripts[hook]).toBe('node scripts/restore-mushaf-fonts.mjs');
    }
    // The soft font restore first; then the expo-audio native patches (native-patches/*/README.md).
    expect(scripts.postinstall).toBe('node scripts/restore-mushaf-fonts.mjs --soft && node native-patches/expo-audio-exact-mp3-seek/apply.mjs --apply && node native-patches/expo-audio-android-playback-ownership/apply.mjs --apply');
    const ci = readFileSync(join(mobile, '../.github/workflows/ci.yml'), 'utf8');
    expect(ci).toMatch(/Restore pinned QCF V1 font\r?\n\s+run: node scripts\/restore-mushaf-fonts\.mjs\r?\n\r?\n\s+- run: npm ci/);
  });
});

describe('restore script', () => {
  let dir: string;
  let server: Server;
  let base: string;
  let served: Buffer | null;
  let requests: number;
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mushaf-fonts-'));
    served = realFont;
    requests = 0;
    server = createServer((_req, res) => {
      requests++;
      if (!served) { res.writeHead(503); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'font/ttf' });
      res.end(served);
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  });
  const run = (args: string[] = []) => new Promise<{ code: number; output: string }>((done) => {
    execFile(process.execPath, [script, ...args], { env: { ...process.env, MUSHAF_FONTS_DIR: dir, MUSHAF_FONTS_BASE_URL: base } }, (error, stdout, stderr) => {
      done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, output: stdout + stderr });
    });
  });
  const target = () => join(dir, 'p61.ttf');

  it('a clean checkout gets the exact pinned font', async () => {
    const result = await run();
    expect(result).toMatchObject({ code: 0 });
    expect(result.output).toMatch(/restored p61\.ttf \(QCF_P061, 155996 bytes, hash verified\)/);
    expect(readFileSync(target()).equals(realFont)).toBe(true);
  });

  it('a font already present and verified is left alone (no download)', async () => {
    writeFileSync(target(), realFont);
    expect(await run()).toMatchObject({ code: 0 });
    expect(requests).toBe(0);
  });

  it('a different upstream font is refused and nothing is written', async () => {
    served = Buffer.concat([realFont.subarray(0, 1000), Buffer.from('changed')]);
    const result = await run();
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/size\/SHA-256 mismatch .* Nothing was written/);
    expect(existsSync(target())).toBe(false);
    expect(existsSync(`${target()}.partial`)).toBe(false);
  });

  it('a damaged local font is replaced; if it can`t be, it is removed rather than bundled', async () => {
    writeFileSync(target(), Buffer.from('not a font'));
    expect(await run()).toMatchObject({ code: 0 });
    expect(readFileSync(target()).equals(realFont)).toBe(true);
    writeFileSync(target(), Buffer.from('not a font'));
    served = null;
    expect((await run()).code).toBe(1);
    expect(existsSync(target())).toBe(false);
  });

  it('postinstall (--soft) only warns when the CDN can`t be reached', async () => {
    served = null;
    const result = await run(['--soft']);
    expect(result.code).toBe(0);
    expect(result.output).toMatch(/npm run fonts:restore/);
  });
});
