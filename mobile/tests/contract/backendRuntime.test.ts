import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * What the contract tests actually run is the backend's code on the backend's
 * own dependencies (backendDependencies.ts checks they are installed; this
 * checks the module loaded here is the one they resolve to). Without it, the
 * backend validator's `zod` was silently taken from this app's node_modules
 * (zod 3, a tooling dependency) instead of the backend's zod 4.
 */
describe('backend contract tests run the backend`s own dependencies', () => {
  it('the request validator is built on the zod major the backend declares', async () => {
    const declared = (JSON.parse(readFileSync(resolve(__dirname, '../../../backend/package.json'), 'utf-8')) as { dependencies: Record<string, string> }).dependencies.zod;
    const major = Number(declared.match(/\d+/)?.[0]);
    const { putPreferencesSchema } = await import('../../../backend/src/validators/syncValidators');
    // zod 4 schemas carry `_zod`; zod 3 ones do not.
    expect('_zod' in (putPreferencesSchema as object)).toBe(major >= 4);
    expect(major).toBeGreaterThanOrEqual(4);
  });
});
