const root = new URL('../../../mobile/src/mushaf/unicode/', import.meta.url).href; // the restored prototype (restore/restore.mjs)
const { UNICODE_MUSHAF_FONTS } = await import(root + 'data.ts');
const { groupMetrics } = await import(root + 'layout.ts');
const C = UNICODE_MUSHAF_FONTS.madinaCalligraphic;
console.log(C.fontMetrics);
for (const v of [7, 8, 300]) for (const m of groupMetrics(C, v).slice(0, 4)) console.log(m.width.toFixed(3), m.stretch.map((s: number) => s.toFixed(2)).join(' '));
