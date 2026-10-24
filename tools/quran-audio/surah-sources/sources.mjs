// Candidate whole-surah sources for reciters the catalogue has no recording for. A source listed here is a CANDIDATE:
// nothing is used before fetch.mjs, compare.mjs and the alignment check it, and the app plays it only as a development
// preview (mobile/src/audio/timedPreview.ts). Rights are recorded per source; none here grants use in an app.
//
// `ahmed-salama` is the catalogue's existing id for Ahmed Mohamed Salama (أحمد محمد سلامة; ../reciters.mjs, no recording
// until now). He is NOT Yasser Mahmoud Salama (`yasser-salama`): docs/audio/missing-surah-source-discovery-phase-4-6.
const pad = (n) => String(n).padStart(3, '0');
const UA = { 'User-Agent': 'Mozilla/5.0 (QuranHeals audio audit)' };

export const SURAH_SOURCES = {
  'ahmed-salama': {
    nameEn: 'Ahmed Mohamed Salama',
    nameAr: 'أحمد محمد سلامة',
    sources: {
      way2quran: {
        listing: 'https://way2quran.com/ar/reciters/ahmed-mohamed-salama',
        label: 'Way2Quran «حفص عن عاصم» (114 surahs listed)',
        rights: 'Way2Quran pages state "Copyright reserved"; no grant for use in an app (../providers.mjs, 2026-10-17).',
        // The listing page links 107 files directly; every surah follows the same pattern (checked file by file).
        urls: async () => Object.fromEntries(Array.from({ length: 114 }, (_, i) => [i + 1, `https://media.way2quran.com/ahmed-mohamed-salama/hafs-an-asim/${pad(i + 1)}.mp3`])),
      },
      assabile: {
        listing: 'https://ar.assabile.com/ahmed-mohamed-salama/quran',
        label: 'Assabile reciter 367 «المصحف المرتل»',
        rights: 'Assabile publishes no terms (every terms URL 404, 2026-10-17); no grant (../providers.mjs).',
        // File names carry the surah number (…-ahmed-mohamed-salama-001-al-fatiha-…): read from the live listing.
        urls: async () => {
          const html = await (await fetch('https://ar.assabile.com/ahmed-mohamed-salama/quran', { headers: UA })).text();
          const out = {};
          for (const m of html.matchAll(/https:\/\/media\.assabile\.com\/[^"' ]+?\/ahmed-mohamed-salama-(\d{3})-[^"' ]+?\.mp3/g)) out[Number(m[1])] ??= m[0];
          return out;
        },
      },
    },
  },
};
