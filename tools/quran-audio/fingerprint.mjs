// The same fingerprint as mobile/src/audio/timingFingerprint.ts (kept identical; tests compare them): FNV-1a (32-bit)
// over "ayah:start:end;" for every entry of a surah's MP3Quran timing, ordered by ayah.
export function timingFingerprint(entries) {
  let hash = 0x811c9dc5;
  const sorted = [...entries].sort((a, b) => a.ayah - b.ayah);
  for (const e of sorted) {
    const text = `${e.ayah}:${Math.round(Number(e.startMs))}:${Math.round(Number(e.endMs))};`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
