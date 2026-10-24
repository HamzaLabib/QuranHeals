// Per-ayah recordings (one file per ayah) under evaluation. Kept apart from ../reciters.mjs, which is the production
// catalogue's input (generate-catalog.mjs): nothing here reaches a release. The review dashboard knows these reciters
// (dashboard-lib.mjs), and generate-preview.mjs writes the app's DEVELOPMENT-ONLY catalogue from their risk reports.
//
// rights: what is known about permission to use the files in an app. A file anyone can download is never a licence.
export const PER_AYAH_RECORDINGS = [
  {
    id: 'gebril',
    // On hold (owner, 2026-10-24): kept for future work, never released (release-gate.mjs refuses it).
    onHold: 'owner, 2026-10-24',
    nameEn: 'Mohamed Gebril',
    nameAr: 'محمد جبريل',
    style: 'murattal',
    riwaya: 'Hafs an Asim, by inference only: EveryAyah lists the set without a riwaya prefix (its non-Hafs sets are prefixed, e.g. "(Warsh)"; recitations_ayat.html, 2026-10-23), and the folder has exactly the 6,236 files of the Kufan count. Not confirmed by ear.',
    provider: 'everyayah',
    folder: 'Muhammad_Jibreel_128kbps',
    base: 'https://everyayah.com/data/Muhammad_Jibreel_128kbps/',
    alternative: 'https://everyayah.com/data/Muhammad_Jibreel_64kbps/',
    requestedBy: 'owner, 2026-10-23 (development preview with risk-based review)',
    // ID3 tags the recording's own files carry (classify.mjs: any other artist or album is a finding).
    tags: { artist: 'jibreel|jibril|gebril', album: 'versebyverse|^quran$' },
    rights: {
      cleared: false,
      evidence: 'EveryAyah publishes no licence or terms for its audio (checked 2026-10-23). The files\' ID3 album tag reads "(C) VerseByVerseQuran.Com" (9 files) and their artist tag "Muhammad Jibreel"; 8:73 was replaced by a file tagged "everyayah.com". No permission for use in an app is recorded: development preview only.',
    },
  },
  {
    id: 'jaber',
    // A release candidate (owner, 2026-10-24): released only once every gate of release-gate.mjs passes and the owner approves.
    releaseCandidate: true,
    nameEn: 'Ali Abdullah Jaber',
    nameAr: 'علي عبد الله جابر',
    style: 'murattal',
    riwaya: 'Hafs an Asim: MP3Quran labels Ali Jaber\'s complete recording (reciter 76, moshaf 76) "حفص عن عاصم - مرتل"; whether EveryAyah\'s files are cut from that performance is checked per surah (per-ayah README, "Identity"). EveryAyah lists the set without a riwaya prefix. Not confirmed by ear.',
    provider: 'everyayah',
    folder: 'Ali_Jaber_64kbps',
    base: 'https://everyayah.com/data/Ali_Jaber_64kbps/',
    reference: { provider: 'mp3quran', reciterId: 76, moshafId: 76, server: 'https://cdn.mp3quran.net/audio/ali-jaber/r1/', label: 'حفص عن عاصم - مرتل' },
    requestedBy: 'owner, 2026-10-23 (Phase 3: development preview with risk-based review)',
    // Set from the scan's tag census (classify.mjs flags any other artist or album).
    tags: { artist: 'jaber|jabir|جابر', album: '^$' },
    // Graded tiers (classify.mjs TIER_OF): only credible structural evidence is Very High, as very-high.mjs defines it.
    graded: true,
    rights: {
      cleared: false,
      evidence: 'EveryAyah publishes no licence or terms for its audio (checked 2026-10-23); MP3Quran\'s permission is site-wide and covers its own files, not EveryAyah\'s. No permission for use in an app is recorded: development preview only.',
    },
  },
];
