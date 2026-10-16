const root = new URL('../../../mobile/src/mushaf/unicode/', import.meta.url).href; // the restored prototype (restore/restore.mjs)
const { UNICODE_MUSHAF_FONTS } = await import(root + 'data.ts');
const { layoutPage } = await import(root + 'layout.ts');
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(new URL('../../../mobile/assets/quran/quran.sqlite', import.meta.url), { readOnly: true });
const texts = (db.prepare('SELECT arabic_text t FROM verses ORDER BY surah, ayah').all() as { t: string }[]).map((r) => r.t);
const B = UNICODE_MUSHAF_FONTS.madina;
const q = (a: number[], x: number) => a[Math.floor(x * (a.length - 1))].toFixed(2);
for (const M of [16.5, 17, 17.5, 18]) {
  const data = { ...B, measureEm: M, options: { ...B.options, measureEm: M, gapSoftMaxEm: 99 } };
  const deficits: number[] = []; const perGap: number[] = []; let shrunk = 0; let minScale = 1;
  for (let p = 3; p <= 604; p++) {
    const laid = layoutPage(data, p, 340, (i: number) => texts[i]);
    for (const r of laid.rows) {
      if (r.kind !== 'text' || r.centred || r.items.length < 2) continue;
      const fs = r.fontSize; const gaps = r.items.length - 1;
      if (fs < laid.fontSize - 1e-9) { shrunk++; minScale = Math.min(minScale, fs / laid.fontSize); continue; }
      const g = r.gap / fs; if (g <= 0.2 + 1e-9) { deficits.push(0); perGap.push(0); continue; }
      deficits.push((g - 0.2) * gaps); perGap.push(g - 0.2);
    }
  }
  deficits.sort((a, b) => a - b); perGap.sort((a, b) => a - b);
  console.log(`M=${M}: lines ${deficits.length + shrunk}, overflow ${shrunk} (min ×${minScale.toFixed(3)}); deficit em med ${q(deficits, .5)} p75 ${q(deficits, .75)} p90 ${q(deficits, .9)} p99 ${q(deficits, .99)} max ${q(deficits, 1)}; per gap med ${q(perGap, .5)} p90 ${q(perGap, .9)} p99 ${q(perGap, .99)}`);
}
