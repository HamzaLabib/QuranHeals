import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the public repository against accidentally committed sensitive or restricted files: it reads `git ls-files`
 * (what a commit would publish), never the working tree. Skipped outside a Git checkout (e.g. a source archive).
 */
const root = resolve(__dirname, '..', '..');
const inGit = existsSync(resolve(root, '.git'));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const tracked = inGit ? git('ls-files', '-z').split('\0').filter(Boolean) : [];

describe.skipIf(!inGit)('repository hygiene (tracked files)', () => {
  it('tracks no environment files, signing material, provisioning profiles or OAuth/cloud credential files', () => {
    const sensitive = [
      /(^|\/)\.env$/, // .env (examples are fine: .env.example)
      /(^|\/)\.env\.(?!example$)[^/]+$/, // .env.local, .env.production, …
      /\.(p8|p12|pfx|pem|key|jks|keystore|mobileprovision)$/i,
      /(^|\/)client_secret[^/]*\.json$/i,
      /(^|\/)credentials[^/]*\.json$/i,
      /(^|\/)[^/]*-credentials\.env$/i,
      /(^|\/)(google-services\.json|GoogleService-Info\.plist|service-account[^/]*\.json)$/i,
      /(^|\/)id_(rsa|ed25519|ecdsa)$/,
    ];
    expect(tracked.filter((path) => sensitive.some((pattern) => pattern.test(path)))).toEqual([]);
  });

  it('tracks none of the licence-restricted files the repository keeps out on purpose', () => {
    const restricted = [
      // QCF V1 page fonts (King Fahd Complex via Quran Foundation): only inside the app, restored at install/build time.
      /^mobile\/assets\/mushaf\/.*\.(ttf|otf|woff2?)$/i,
      // Quran Foundation Content Sync copy.
      /^backend\/data\/mushaf-sync\//,
      // The Unicode prototype's Madina05 table and KFGQPC-derived widths (unicode-experiments/licenses/NOTICES.md).
      /(^|\/)generated\/(madina05Layout|hafsWordWidths)\.ts$/,
      // Local administrative files (deletion cases, audit logs).
      /^QuranHealsAdmin\//,
      // Larger-text experiment comparison images (QCF V1 page renders), untracked in audit C1: comparisons/ARCHIVED.md.
      /^design-archive\/experiments\/larger-text-mushaf\/comparisons\/[^/]+\.(png|jpe?g|webp)$/i,
      // King Fahd verification outputs (contain KFGQPC Quran text), privately archived in audit C2: output/ARCHIVED-OUTPUTS.md.
      /^tools\/quran-verification\/output\/kfgqpc-/,
      // The original King Fahd package and other locally kept third-party sources (.gitignore "Third-party source").
      /^tools\/quran-import\/raw\/UthmanicHafs_v2-0\.zip$/,
      /^backend\/data\/quran\/(en\.pickthall\.txt|quran-data\.xml)$/,
      /^tools\/quran-import\/raw\/gutenberg-16955\/16955\.txt$/,
      // MongoDB pre-write snapshot backups (user data).
      /^backend\/backups\/(?!\.gitignore$)/,
    ];
    expect(tracked.filter((path) => restricted.some((pattern) => pattern.test(path)))).toEqual([]);
  });

  it('every tracked file that .gitignore would exclude is a known, deliberate exception', () => {
    const ignoredButTracked = git('ls-files', '-ci', '--exclude-standard', '-z').split('\0').filter(Boolean);
    const known = [
      // Keeps the (otherwise ignored) backups folder in place.
      /^backend\/backups\/\.gitignore$/,
    ];
    expect(ignoredButTracked.filter((path) => !known.some((pattern) => pattern.test(path)))).toEqual([]);
  });

  it('keeps the canonical Tanzil input exactly the verified file (SHA-256 pinned in tools/quran-verification/README.md)', () => {
    const committed = execFileSync('git', ['cat-file', 'blob', 'HEAD:tools/quran-verification/input/quran-uthmani.txt'], { cwd: root, maxBuffer: 1 << 26 });
    expect(createHash('sha256').update(committed).digest('hex')).toBe('6933e133dd56db778c801bf738848454e43648105a151e8d84d86a7cae39ec5f');
  });
});
