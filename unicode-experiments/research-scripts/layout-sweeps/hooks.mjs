import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = fileURLToPath(new URL('../../../mobile/src/', import.meta.url));
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) specifier = pathToFileURL(SRC + specifier.slice(2)).href;
  const rel = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
  if (rel && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier) && context.parentURL) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const url = new URL(specifier + ext, context.parentURL);
      if (existsSync(fileURLToPath(url))) return next(url.href, context);
    }
  }
  return next(specifier, context);
}
