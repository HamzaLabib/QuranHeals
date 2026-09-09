import type { Ayah } from '@/types/domain';
import { openBundledQuran } from './quranAsset';
import { composeLocalAyah, createQuranRepository } from './quranRepository';

export const quranRepository = createQuranRepository(openBundledQuran);
export const getVerseByKey = quranRepository.getVerseByKey;
export const getVerse = quranRepository.getVerse;
export const resolveAyahArabic = <T extends Ayah>(ayah: T) => composeLocalAyah(ayah, quranRepository);
