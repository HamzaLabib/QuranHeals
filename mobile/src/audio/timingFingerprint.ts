/** One entry of a surah's ayah timing, in milliseconds into the surah's audio file (ayah 0: the opening before ayah 1). */
export type TimingEntry = { ayah: number; startMs: number; endMs: number };

/**
 * The fingerprint of a surah's timing as audited (tools/quran-audio/fingerprint.mjs, kept identical): FNV-1a (32-bit)
 * over "ayah:start:end;" for every entry, ordered by ayah. Timing that differs in any value from the audited copy has a
 * different fingerprint, so it is never used unchecked.
 */
export function timingFingerprint(entries: readonly TimingEntry[]): string {
  let hash = 0x811c9dc5;
  const sorted = [...entries].sort((a, b) => a.ayah - b.ayah);
  for (const entry of sorted) {
    const text = `${entry.ayah}:${Math.round(entry.startMs)}:${Math.round(entry.endMs)};`;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}
