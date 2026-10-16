const root = new URL('../../../mobile/src/mushaf/unicode/', import.meta.url).href; // the restored prototype (restore/restore.mjs)
const { UNICODE_MUSHAF_FONTS } = await import(root + 'data.ts');
const { layoutPage } = await import(root + 'layout.ts');
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(new URL('../../../mobile/assets/quran/quran.sqlite', import.meta.url), { readOnly: true });
const texts = (db.prepare('SELECT arabic_text t FROM verses ORDER BY surah, ayah').all() as { t: string }[]).map((r) => r.t);
const C = UNICODE_MUSHAF_FONTS.madinaCalligraphic;
const q = (a: number[], x: number) => (a.length ? a[Math.floor(x * (a.length - 1))] : 0).toFixed(2);
const W = 340; const baseFont = W / 18;
export function run(name: string, options: any) {
  const data = { ...C, measureEm: options.measureEm, options };
  const stretches: number[] = []; const gaps: number[] = []; const under: number[] = []; const words: number[] = [];
  let shrunk = 0, minScale = 1, lines = 0, fs = 0;
  for (let p = 1; p <= 604; p++) {
    const laid = layoutPage(data, p, W, (i: number) => texts[i]); fs = laid.fontSize;
    for (const r of laid.rows) {
      if (r.kind !== 'text' || r.centred || r.items.length < 2) continue;
      lines++;
      if (r.fontSize < laid.fontSize - 1e-9) { shrunk++; minScale = Math.min(minScale, r.fontSize / laid.fontSize); }
      gaps.push(r.gap / r.fontSize); if (r.underfill > 0) under.push(r.underfill / laid.fontSize);
      for (const it of r.items) if (it.kind === 'word') { words.push(1); if (it.elongation > 0) { const m = (data.groupWidths as any); stretches.push(it.width / r.fontSize); } }
    }
  }
  // stretch amount per elongated word, from widths: recompute via metrics
  return { name, fs, lines, shrunk, minScale, gaps, under, stretches };
}
const { groupMetrics } = await import(root + 'layout.ts');
export function report(name: string, options: any) {
  const data = { ...C, measureEm: options.measureEm, options };
  const st: number[] = []; const share: number[] = []; const gaps: number[] = []; const under: number[] = [];
  let shrunk = 0, minScale = 1, lines = 0, fs = 0, nwords = 0;
  for (let p = 1; p <= 604; p++) {
    const laid = layoutPage(data, p, W, (i: number) => texts[i]); fs = laid.fontSize;
    for (const r of laid.rows) {
      if (r.kind !== 'text' || r.centred || r.items.length < 2) continue;
      lines++;
      if (r.fontSize < laid.fontSize - 1e-9) { shrunk++; minScale = Math.min(minScale, r.fontSize / laid.fontSize); }
      gaps.push(r.gap / r.fontSize); if (r.underfill > 0.01) under.push(r.underfill / laid.fontSize);
      for (const it of r.items) if (it.kind === 'word') { nwords++; if (it.elongation > 0) { const m = groupMetrics(data, it.verseIndex)[it.group]; st.push(m.stretch[it.elongation]); share.push(m.stretch[it.elongation] / m.width); } }
    }
  }
  [st, share, gaps, under].forEach((a) => a.sort((x, y) => x - y));
  console.log(`${name.padEnd(28)} font ×${(fs / baseFont).toFixed(3)} | shrunk ${shrunk} min×${minScale.toFixed(3)} | elongated ${st.length} (${(100 * st.length / nwords).toFixed(1)}%) em med ${q(st, .5)} p90 ${q(st, .9)} max ${q(st, 1)}, >0.45em ${st.filter((s) => s > 0.45).length}, share max ${q(share, 1)} | gap med ${q(gaps, .5)} p90 ${q(gaps, .9)} p99 ${q(gaps, .99)} max ${q(gaps, 1)}, >0.6 ${gaps.filter((g) => g > 0.6).length} | short ${under.length} med ${q(under, .5)} max ${q(under, 1)}`);
}
const nat = (o: any, n: any = {}, e: any = {}) => ({ ...C.options, ...o, natural: { gapEm: 0.3, gapMaxEm: 0.5, underfillMaxEm: 1, ...n, elongation: { maxLevel: 3, maxEm: 0.42, maxShare: 0.35, minWordEm: 1, wordsPerElongation: 3, ...e } } });
const v: [string, any][] = [['C2 now', UNICODE_MUSHAF_FONTS.madinaNatural.options]];
for (const M of [17.5, 17.25, 17]) for (const [gs, gm, ue] of [[0.25, 0.45, 1.5], [0.25, 0.45, 2], [0.25, 0.4, 2]]) v.push([`M${M} g${gs}/${gm} u${ue}`, nat({ measureEm: M, widthShare: 1.02 }, { gapEm: gs, gapMaxEm: gm, underfillMaxEm: ue })]);
v.push(['M17.25 g.25/.45 u2 wpe2', nat({ measureEm: 17.25, widthShare: 1.02 }, { gapEm: 0.25, gapMaxEm: 0.45, underfillMaxEm: 2 }, { wordsPerElongation: 2 })]);
for (const [n, o] of v) report(n, o);
