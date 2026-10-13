// Metro's static requires bundle these original files on native and web. The
// expo-asset config plugin supports .db, but rejects .sqlite and .txt; use Metro
// assetExts rather than renaming or regenerating this verified release asset.
/* eslint-disable @typescript-eslint/no-require-imports */
export const bundledQuranAssets = {
  database: require('../../assets/quran/quran.sqlite') as number,
  notice: require('../../assets/quran/TANZIL-NOTICE.txt') as number,
  amiriFontLicense: require('../../assets/licenses/OFL-Amiri.txt') as number,
};
