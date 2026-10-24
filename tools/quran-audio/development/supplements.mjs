// Reciters whose EveryAyah per-ayah set is cut from the app's own MP3Quran recording (probe 2026-10-18, surahs 103 and
// 112, every 3 s chunk located: Minshawi 0.946-0.947, Husary 0.940-0.942, Shuraim 0.874-0.907, Shatri 0.871-0.902,
// Naina 0.827-0.864; two encodings of one recording score ~0.8-1, other audio below ~0.6). Ajmi (0.157) and Basfar
// (0.162-0.512) are other recordings and are not listed. `surahs`: the catalogue surahs with no verified timing.
export const SUPPLEMENTS = [
  { id: 'minshawi', reference: 'https://everyayah.com/data/Minshawy_Murattal_128kbps/', surahs: [9, 52, 53, 54, 55, 56, 57] },
  { id: 'husary', reference: 'https://everyayah.com/data/Husary_128kbps/', surahs: [1, 21, 27, 28, 31, 46, 47, 49, 58, 66, 98] },
  { id: 'shuraim', reference: 'https://everyayah.com/data/Saood_ash-Shuraym_128kbps/', surahs: [9, 12, 17, 19, 25, 40, 65, 80, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 101, 103, 107, 113] },
  { id: 'shatri', reference: 'https://everyayah.com/data/Abu_Bakr_Ash-Shaatree_128kbps/', surahs: [7, 19, 32, 36, 41, 42, 103, 106, 107, 108, 110, 112, 113] },
  { id: 'naina', reference: 'https://everyayah.com/data/Ahmed_Neana_128kbps/', surahs: [18] },
];
