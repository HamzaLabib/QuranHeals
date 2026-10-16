import { readFileSync } from 'node:fs';
const root = process.argv[2];
const pages = JSON.parse(readFileSync(process.argv[3], 'utf8')).pages;
const wsrc = readFileSync(`${root}/mobile/src/mushaf/unicode/generated/${process.argv[4] ?? 'hafs'}WordWidths.ts`, 'utf8');
const widths = [...wsrc.matchAll(/^"([^"]*)",$/gm)].map((m) => m[1].split(',').map((c) => parseFloat(c)));
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync(`${root}/mobile/assets/quran/quran.sqlite`, { readOnly: true });
const texts = db.prepare('SELECT arabic_text t FROM verses ORDER BY surah, ayah').all().map((r) => r.t);
const PAUSE = /^[ۖ-ۜ۞۩]+$/;
// token index -> group index per verse
const groupOf = texts.map((t) => { let g = -1; return t.split(' ').map((tok) => (PAUSE.test(tok) && g >= 0 ? g : ++g)); });
const M = 1.15; // marker slot em
const rows = [];
pages.forEach((p, pi) => {
  const lines = p.split('|');
  lines.forEach((l, li) => {
    if (/^[hb]/.test(l)) return;
    let em = 0, words = 0, markers = 0;
    for (const seg of l.split(';')) {
      const [v, f, t, m] = seg.split(',');
      const gs = new Set();
      for (let k = +f; k <= +t; k++) gs.add(groupOf[+v][k]);
      for (const g of gs) { em += widths[+v][g] / 1000; words++; }
      if (m) { markers++; }
    }
    const next = lines[li + 1] ?? pages[pi + 1]?.split('|')[0] ?? 'END';
    rows.push({ page: pi + 1, line: li + 1, em: em + markers * M, words: words + markers, surahEnd: /^h/.test(next) || next === 'END' });
  });
});
const reg = rows.filter((r) => r.page > 2);
const sorted = [...reg].map((r) => r.em).sort((a, b) => a - b);
const q = (x) => sorted[Math.floor(x * (sorted.length - 1))].toFixed(2);
console.log('lines', reg.length, 'natural em: min', q(0), 'p5', q(.05), 'p25', q(.25), 'med', q(.5), 'p75', q(.75), 'p95', q(.95), 'p99', q(.99), 'max', q(1));
const perPageMax = new Map(); for (const r of reg) perPageMax.set(r.page, Math.max(perPageMax.get(r.page) ?? 0, r.em));
const pm = [...perPageMax.values()].sort((a, b) => a - b);
console.log('per-page widest: min', pm[0].toFixed(2), 'med', pm[Math.floor(pm.length/2)].toFixed(2), 'max', pm.at(-1).toFixed(2));
const top = [...reg].sort((a, b) => b.em - a.em).slice(0, 8).map((r) => `${r.page}:${r.line}=${r.em.toFixed(2)}`); console.log('widest', top.join(' '));
const ends = reg.filter((r) => r.surahEnd); console.log('surah-end lines', ends.length, ends.filter(r=>r.em<sorted[Math.floor(.05*sorted.length)]).length, 'short');
// fill ratio if global width = p99 vs max
for (const W of [+q(.99), +q(1)]) { const fill = reg.filter(r=>!r.surahEnd).map(r=>r.em/W).sort((a,b)=>a-b); console.log('W',W,'fill p1',fill[Math.floor(fill.length*.01)].toFixed(3),'p5',fill[Math.floor(fill.length*.05)].toFixed(3),'med',fill[Math.floor(fill.length*.5)].toFixed(3), 'over1', fill.filter(f=>f>1).length); }
for (const p of [3,187,319,560,595,604]) console.log(p, reg.filter(r=>r.page===p).map(r=>r.em.toFixed(1)).join(' '));
console.log('--- with natural spaces (0.22em) between items');
const nat = reg.map((r) => ({ ...r, nat: r.em + (r.words - 1) * SP }));
const ns = nat.map((r) => r.nat).sort((a, b) => a - b);
const nq = (x) => ns[Math.floor(x * (ns.length - 1))].toFixed(2);
console.log('nat em: p5', nq(.05), 'med', nq(.5), 'p90', nq(.9), 'p95', nq(.95), 'p98', nq(.98), 'p99', nq(.99), 'p99.5', nq(.995), 'max', nq(1));
const SP = +(process.argv[5] ?? 0.22); for (const W of [16, 17, 18, 19, 20, 21]) {
  const over = nat.filter((r) => r.em + (r.words - 1) * 0.12 > W); // even with 0.12em gaps
  const worst = Math.min(...over.map((r) => W / (r.em + (r.words - 1) * 0.12)), 1);
  const need = nat.filter((r) => !r.surahEnd).map((r) => (W - r.nat) / Math.max(1, r.words - 1)).sort((a, b) => a - b);
  console.log(`W=${W}: over even at 0.12 gaps ${over.length} (worst scaleX ${worst.toFixed(3)}); extra per gap if spaces only: med ${need[Math.floor(need.length/2)].toFixed(2)} p90 ${need[Math.floor(need.length*.9)].toFixed(2)} p99 ${need[Math.floor(need.length*.99)].toFixed(2)} em`);
}
