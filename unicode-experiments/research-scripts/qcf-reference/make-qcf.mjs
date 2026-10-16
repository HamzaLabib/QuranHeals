// QCF V1 reference pages for visual comparison (local evaluation only; QF content stays in the scratchpad).
// node make-qcf.mjs <page...>  → qcf/page-<n>.html : the page's 15 lines in its QCF V1 page font, justified like the
// production reader (widest line fills the width, words space-between), text area 331.4 × 625.5 (iPhone 393 Normal).
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const records = JSON.parse(gunzipSync(readFileSync(`${repo}/backend/data/mushaf-sync/records-547614.json.gz`)).toString('utf8'));
const verses = new DatabaseSync(`${repo}/mobile/assets/quran/quran.sqlite`, { readOnly: true }).prepare('SELECT verse_key k FROM verses ORDER BY surah, ayah').all();
const W = 331.4, H = 625.5;
for (const page of process.argv.slice(2).map(Number)) {
  const words = records.filter((r) => r.record_type === 'mushaf_word' && r.mushaf_id === 2 && r.page_number === page).sort((a, b) => a.position_in_page - b.position_in_page);
  const lines = new Map();
  for (const w of words) {
    if (!lines.has(w.line_number)) lines.set(w.line_number, []);
    lines.get(w.line_number).push({ glyph: w.text, end: w.char_type_name === 'end', key: verses[w.verse_id - 1].k });
  }
  const opening = page <= 2;
  const rows = [...lines].map(([line, ws]) => `<div class="row${opening ? ' open' : ''}" data-line="${line}" style="top:${(opening ? line - 1 - (page === 1 ? 4 : 5) : line - 1) * H / 15}px">${ws.map((w) => `<span class="${w.end ? 'end' : 'w'}">${w.glyph}</span>`).join('')}</div>`).join('\n');
  writeFileSync(`page-${page}.html`, `<!doctype html><meta charset=utf-8><style>
@font-face{font-family:QCF;src:url('p${page}.ttf')}
body{margin:0;background:#F9EFD2}
#area{position:relative;width:${W}px;height:${H}px;margin:12px}
.row{position:absolute;left:0;width:${W}px;height:${H / 15}px;display:flex;flex-direction:row-reverse;justify-content:space-between;align-items:center;font-family:QCF;color:#231F20;white-space:nowrap}
.row.open{justify-content:center;gap:2px}
.end{color:#3E7D57}
</style><div id=area>${rows}</div>
<script>
document.fonts.ready.then(()=>{const rows=[...document.querySelectorAll('.row')];
 rows.forEach(r=>{r.style.fontSize='100px';r.style.justifyContent='flex-start'});
 const widest=Math.max(...rows.map(r=>[...r.children].reduce((s,c)=>s+c.getBoundingClientRect().width,0)));
 const size=${opening ? `${W} * 0.0692 * (1 - 2/20 - 2*25/593) / (1 - 2/20 - 2*25/593) ` : `100*${W}*0.985/widest`};
 rows.forEach(r=>{r.style.fontSize=size+'px';r.style.justifyContent=r.classList.contains('open')?'center':'space-between'});
 document.body.dataset.ready=1;});
</script>`);
  console.log(page, lines.size, 'lines', words.length, 'glyphs');
}
