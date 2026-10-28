import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Before the contract tests (vitest.contract.config.mts): the backend code
 * they import must load the backend's OWN dependencies. Without backend/'s
 * `npm ci`, a bare import there (e.g. `zod` in syncValidators.ts) is
 * silently resolved from this app's node_modules instead — another major
 * version, pulled in by its tooling — and the tests would check the server's
 * rules on a library the server does not run. So: each dependency the
 * backend declares and these tests reach must resolve inside
 * backend/node_modules, at a version its package.json accepts by major.
 */
const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), '../../../backend');
/** What the imported backend modules (validators/syncValidators.ts, services/preferencesMerge.ts) load at runtime. */
const REACHED = ['zod'];

export default function setup(): void {
  const declared = (JSON.parse(readFileSync(join(BACKEND, 'package.json'), 'utf-8')) as { dependencies: Record<string, string> }).dependencies;
  const fromBackend = createRequire(join(BACKEND, 'src', 'index.js'));
  for (const name of REACHED) {
    let manifest: string;
    try {
      manifest = fromBackend.resolve(`${name}/package.json`);
    } catch {
      throw new Error(`Backend dependency "${name}" is not installed: run \`npm ci\` in backend/ before \`npm run test:contract\`.`);
    }
    if (relative(join(BACKEND, 'node_modules'), manifest).startsWith('..')) {
      throw new Error(`"${name}" resolves outside backend/node_modules (${manifest}): run \`npm ci\` in backend/.`);
    }
    const { version } = JSON.parse(readFileSync(manifest, 'utf-8')) as { version: string };
    const wanted = declared[name]?.match(/\d+/)?.[0];
    if (wanted && version.split('.')[0] !== wanted) {
      throw new Error(`backend/node_modules/${name} is ${version}, but backend/package.json wants ${declared[name]}: run \`npm ci\` in backend/.`);
    }
  }
}
