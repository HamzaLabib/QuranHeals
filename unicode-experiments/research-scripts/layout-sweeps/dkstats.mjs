import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const [root, layoutJson, widthsFile] = process.argv.slice(2);
const pages = JSON.parse(readFileSync(layoutJson, 'utf8')).pages;
const src = readFileSync(widthsFile, 'utf8');
const SP = +src.match(/spaceEm: ([\d.]+)/)[1];
const rows = [...src.matchAll(/^"([^"]*)",$/gm)].map((m) => m[1].split(',').map((c) => {
  const [base, el] = c.split('~'); const w = parseFloat(base) / 1000; const steps = el ? el.split('.').map((x) => parseInt(x, 36) / 1000) : [];
  const cum = [0]; for (const s of steps) cum.push(cum.at(-1) + s); return { w, cum };
}));
const texts = new DatabaseSync(`${root}/mobile/assets/quran/quran.sqlite`, { readOnly: true }).prepare('SELECT arabic_text t FROM verses ORDER BY surah, ayah').all().map((r) => r.t);
const PAUSE = /^[ۖ-ۜ۞۩]+$/;
const groupOf = texts.map((t) => { let g = -1; return t.split(' ').map((tok) => (PAUSE.test(tok) && g >= 0 ? g : ++g)); });
const M = 1.0 * 0.76 + 0.06 + 0.2;
const lines = [];
pages.forEach((p, pi) => p.split('|').forEach((l, li, arr) => {
  if (/^[hb]/.test(l) || pi < 2) return;
  const items = [];
  for (const seg of l.split(';')) { const [v, f, t, m] = seg.split(','); const gs = new Set(); for (let k = +f; k <= +t; k++) gs.add(groupOf[+v][k]); for (const g of gs) items.push(rows[+v][g]); if (m) items.push({ w: M, cum: [0] }); }
  const next = arr[li + 1] ?? pages[pi + 1]?.split('|')[0] ?? 'END';
  lines.push({ items, end: /^h/.test(next) || next === 'END' });
}));
const nat = (l) => l.items.reduce((s, i) => s + i.w, 0) + (l.items.length - 1) * SP;
const ns = lines.map(nat).sort((a, b) => a - b); const q = (x) => ns[Math.floor(x * (ns.length - 1))].toFixed(2);
console.log('natural em (with spaces): p5', q(.05), 'med', q(.5), 'p95', q(.95), 'p99', q(.99), 'max', q(1));
for (const W of [17, 17.5, 18, 18.5, 19, 20]) {
  let over = 0, worst = 1, levelsNeeded = [], wideGap = 0;
  for (const l of lines) {
    const n = nat(l); if (l.end && n < 0.8 * W) continue;
    if (n > W) { const ink = n - (l.items.length - 1) * SP; const s = Math.min(1, W / (ink + (l.items.length - 1) * 0.1)); if (s < 1) { over++; worst = Math.min(worst, s); } continue; }
    // Elongate: 2 longest-capable words first, level by level, up to 12; then spaces to 0.35em; record levels.
    let room = W - n; const cand = l.items.filter((i) => i.cum.length > 1).sort((a, b) => b.w - a.w); const lv = new Map();
    const budgetGap = (l.items.length - 1) * (0.35 - SP);
    let target = Math.max(0, room - budgetGap * 0.5);
    for (let lev = 1; lev <= 12 && target > 0.01; lev++) for (const c of cand.slice(0, lev <= 6 ? 2 : 4)) { const cur = lv.get(c) ?? 0; if (cur + 1 >= c.cum.length) continue; const add = c.cum[cur + 1] - c.cum[cur]; if (add <= target + 0.02) { lv.set(c, cur + 1); target -= add; room -= add; } }
    levelsNeeded.push(Math.max(0, ...lv.values()));
    wideGap = Math.max(wideGap, SP + room / (l.items.length - 1));
  }
  const ln = levelsNeeded.sort((a, b) => a - b);
  console.log(`W=${W}: lines over measure ${over} (worst x${worst.toFixed(3)}); max level p50 ${ln[ln.length >> 1]} p90 ${ln[Math.floor(ln.length * 0.9)]} p99 ${ln[Math.floor(ln.length * 0.99)]}; widest gap ${wideGap.toFixed(2)} em`);
}
