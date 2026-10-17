import fs from 'fs';
const d = process.argv[2];
const ar = JSON.parse(fs.readFileSync(d+'/reciters_ar.json','utf8')).reciters;
const en = JSON.parse(fs.readFileSync(d+'/reciters_en.json','utf8')).reciters;
const tr = JSON.parse(fs.readFileSync(d+'/timing_reads.json','utf8'));
const keys = ['عبد الباسط','المنشاوي','نعينع','الحصري','البنا','سلامة','الشريم','صوفي','الحذيفي','الشاطري','العجمي','المعيقلي','بصفر','طالب','رفعت','صبحي','العفاسي','السديس'];
const norm = s => s.replace(/[أإآ]/g,'ا');
for (const k of keys) {
  console.log('\n=== '+k);
  for (const r of ar.filter(r=>norm(r.name).includes(norm(k)))) {
    const e = en.find(x=>x.id===r.id);
    console.log(`R ${r.id} | ${r.name} | ${e?.name}`);
    for (const m of r.moshaf) console.log(`   moshaf ${m.id} type=${m.moshaf_type} | ${m.name} | n=${m.surah_total} | ${m.server}`);
  }
  for (const t of tr.filter(t=>norm(t.name).includes(norm(k)))) console.log(`T read=${t.id} | ${t.name} | ${t.rewaya} | ${t.folder_url} | soar=${t.soar_count}`);
}
