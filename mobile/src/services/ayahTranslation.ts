import type { Ayah } from '@/types/domain';

/** Saved or shared while offline (services/ayahForAction.ts): its translation hasn't been fetched yet. */
export function translationPending(ayah: Pick<Ayah, 'englishTranslation'>): boolean {
  return ayah.englishTranslation.trim() === '';
}
