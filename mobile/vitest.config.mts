import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: {
    '@/assets': fileURLToPath(new URL('./assets', import.meta.url)),
    '@': fileURLToPath(new URL('./src', import.meta.url)),
  } },
  // Metro/Babel normally replace this global at build time; some
  // expo-modules-core-based packages (e.g. expo-secure-store, pulled in
  // transitively by auth/sessionStorage.ts) reference it at module-eval
  // time, which otherwise throws under vitest's plain Node environment.
  define: { __DEV__: 'false' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], restoreMocks: true },
});
