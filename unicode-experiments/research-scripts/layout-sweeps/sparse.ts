const root = new URL('../../../mobile/src/mushaf/unicode/', import.meta.url).href; // the restored prototype (restore/restore.mjs)
const { UNICODE_MUSHAF_FONTS } = await import(root + 'data.ts');
const { layoutPage } = await import(root + 'layout.ts');
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(new URL('../../../mobile/assets/quran/quran.sqlite', import.meta.url), { readOnly: true });
const texts = (db.prepare('SELECT arabic_text t FROM verses ORDER BY surah, ayah').all() as { t: string }[]).map((r) => r.t);
const rows: any[] = [];
for (let p = 3; p <= 604; p++) {
  const c = layoutPage(UNICODE_MUSHAF_FONTS.madinaCalligraphic, p, 340, (i: number) => texts[i]).stats;
  const n = layoutPage(UNICODE_MUSHAF_FONTS.madinaNatural, p, 340, (i: number) => texts[i]).stats;
  rows.push({ p, cStretch: c.longestStretchEm, cEl: c.elongations, cGap: c.widestGapEm, nGap: n.widestGapEm, nUnder: n.underfilled, nEl: n.elongations });
}
console.log('most C elongation:', [...rows].sort((a, b) => b.cEl - a.cEl).slice(0, 6).map((r) => `${r.p}(${r.cEl})`).join(' '));
console.log('widest C2 gaps:', [...rows].sort((a, b) => b.nGap - a.nGap).slice(0, 8).map((r) => `${r.p}(${r.nGap.toFixed(2)})`).join(' '));
console.log('most C2 short lines:', [...rows].sort((a, b) => b.nUnder - a.nUnder).slice(0, 6).map((r) => `${r.p}(${r.nUnder})`).join(' '));
for (const p of [5, 254, 595, 604]) console.log(p, JSON.stringify(rows.find((r) => r.p === p)));
