import { configDefaults, defineConfig } from 'vitest/config';

import app from './vitest.config.mts';

/**
 * The backend contract tests (tests/contract/): the app's sync code against
 * the backend's own request validator and merge, imported from backend/src.
 * Same settings as the app's tests (vitest.config.mts), these files only.
 * `npm run test:contract`, after `npm ci` in backend/ as well as here
 * (tests/contract/backendDependencies.ts refuses to run otherwise).
 */
export default defineConfig({
  ...app,
  test: {
    ...app.test,
    include: ['tests/contract/**/*.test.ts'],
    exclude: [...configDefaults.exclude],
    globalSetup: ['tests/contract/backendDependencies.ts'],
  },
});
