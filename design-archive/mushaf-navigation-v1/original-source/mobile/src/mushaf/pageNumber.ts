import { MUSHAF_PAGE_COUNT } from './mushafPage';

/** Western or Arabic-Indic digits → a page number, or null. */
export function parsePageNumber(input: string): number | null {
  const western = input.trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d{1,3}$/.test(western)) return null;
  const page = Number(western);
  return page >= 1 && page <= MUSHAF_PAGE_COUNT ? page : null;
}
