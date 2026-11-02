/**
 * QCF V1 (QPC V1, 1405 AH Madani Mushaf) page 61's font, registered by the
 * reader when it opens. All 604 page fonts are bundled with the app
 * (generated/qpcV1PageFonts.ts, the same p61.ttf among them); the others are
 * registered per page through the offline Mushaf (offline/fonts.ts).
 *
 * p61.ttf: "QCF_P061" version 5.10, © King Fahd Glorious Qur'an Printing
 * Complex, from Quran Foundation's documented CDN
 * (https://verses.quran.foundation/fonts/quran/hafs/v1/ttf/p61.ttf),
 * 155,996 bytes, SHA-256 34d6a665c9ac4e36539d389571f897ec8622fa795d40359f266a77b2451fc486.
 * Bundled under Quran Foundation's Mushaf font terms (active Developer
 * Console account; credited in the app; distributed only inside the app).
 *
 * Not in git: the repository is public and the terms forbid offering the
 * fonts as a standalone download. scripts/restore-mushaf-fonts.mjs restores
 * them from the CDN, pinned in assets/mushaf/qpc-v1/fonts.lock.json (this same
 * hash for p61), on install, before tests and app starts, in CI and before EAS builds.
 */
export const QPC_V1_FONTS = {
  QCF_P061: require('../../assets/mushaf/qpc-v1/p61.ttf'),
};

export const QPC_V1_FONT_SHA256: Readonly<Record<number, string>> = {
  61: '34d6a665c9ac4e36539d389571f897ec8622fa795d40359f266a77b2451fc486',
};
