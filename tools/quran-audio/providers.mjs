// The audio providers the source registry knows, with the evidence for each permission (docs/audio/source-audit.md,
// "Rights and terms"). A permission is granted only on recorded evidence: a reachable file, or a file anyone can
// download, is never taken as a licence. generate-catalog.mjs refuses any playable source whose provider does not
// permit streaming, and the app checks the same flags again (mobile/src/audio/sourceRegistry.ts).
//
// To grant a permission: record where it was given (URL, letter or e-mail reference) and the date in `evidence`, then
// re-run generate-catalog.mjs. Offline storage is also gated by OFFLINE_DOWNLOADS_PERMITTED in mobile/src/audio/reciters.ts.
export const PROVIDERS = [
  {
    id: 'mp3quran',
    name: 'MP3Quran',
    website: 'https://www.mp3quran.net',
    streaming: {
      permitted: true,
      evidence: 'Privacy page, "Copyrights": "we allow any visitor or developer to copy any material or use any link on the websites" (https://www.mp3quran.net/eng/privacy, read 2026-10-17). Site-wide; per-recording rights not established.',
    },
    offline: {
      permitted: true,
      evidence: 'Owner decision (Hamza, 2026-10-24): downloads enabled on the basis of MP3Quran\'s published reuse statement, the same Privacy page "Copyrights" text as streaming (https://www.mp3quran.net/eng/privacy). No recording-specific written permission has been obtained.',
    },
    attribution: { required: false, text: 'Recitations: MP3Quran (mp3quran.net)', shownIn: 'Settings → Favorite Reciter; Quran Sources & Credits' },
    // MP3Quran's CDN answers an unlisted surah of an incomplete recording with a 302 to another Sheikh's file
    // (Minshawi r1): a URL is only ever built for a surah its catalogue lists for that recording.
    redirectsUnlisted: true,
  },
  {
    id: 'way2quran',
    name: 'Way2Quran',
    website: 'https://way2quran.com',
    streaming: { permitted: false, evidence: 'Pages state "Copyright reserved"; no grant for use in an app (checked 2026-10-17).' },
    offline: { permitted: false, evidence: 'No grant.' },
    attribution: null,
    redirectsUnlisted: false,
  },
  {
    id: 'assabile',
    name: 'Assabile',
    website: 'https://www.assabile.com',
    streaming: { permitted: false, evidence: '"© 2008–2026 Assabile"; no terms page (every terms URL tried returns 404, 2026-10-17); no grant.' },
    offline: { permitted: false, evidence: 'No grant.' },
    attribution: null,
    redirectsUnlisted: false,
  },
];
