// Structural audit of MP3Quran recordings for the 16 Quran Heals reciters that have one (the 17th, Ahmed Mohamed Salama, has none).
import fs from 'fs'; import path from 'path';
const D = process.argv[2]; const counts = JSON.parse(fs.readFileSync(D + '/ayah_counts.json'));
const cache = D + '/timing'; fs.mkdirSync(cache, { recursive: true });
const ar = JSON.parse(fs.readFileSync(D + '/reciters_ar.json', 'utf8')).reciters;
const timingReads = JSON.parse(fs.readFileSync(D + '/timing_reads.json', 'utf8'));
// [reciterId, moshafId]
const targets = [[51, 53], [51, 51], [112, 112], [9, 9], [118, 118], [121, 121], [121, 122], [152, 152], [31, 31], [64, 258], [74, 74], [4, 4], [5, 5], [102, 102], [102, 133], [60, 60], [41, 41], [241, 241], [253, 253]];
const UA = { 'User-Agent': 'QuranHeals-audit/1.0' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchRetry(url, opts = {}, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }); if (r.ok || r.status === 404 || r.status === 206) return r; last = r.status; } catch (e) { last = String(e); }
    await sleep(800 * (i + 1));
  }
  throw new Error('fail ' + url + ' ' + last);
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
export function mp3Info(buf) {
  let o = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) o = 10 + (((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f));
  const id3 = o;
  while (o < buf.length - 4 && !(buf[o] === 0xff && (buf[o + 1] & 0xe0) === 0xe0 && ((buf[o + 2] >> 4) & 15) !== 15 && ((buf[o + 2] >> 4) & 15) !== 0)) o++;
  if (o >= buf.length - 4) return { id3, error: 'nosync' };
  const v = (buf[o + 1] >> 3) & 3, bi = (buf[o + 2] >> 4) & 15, si = (buf[o + 2] >> 2) & 3, ch = (buf[o + 3] >> 6) & 3;
  const br1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], br2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const sr = ({ 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] })[v]?.[si];
  const bitrate = (v === 3 ? br1 : br2)[bi]; const spf = v === 3 ? 1152 : 576;
  const side = v === 3 ? (ch === 3 ? 17 : 32) : (ch === 3 ? 9 : 17);
  const tag = buf.slice(o + 4 + side, o + 8 + side).toString('latin1');
  let frames = null;
  if (tag === 'Xing' || tag === 'Info') { const fl = buf.readUInt32BE(o + 8 + side); if (fl & 1) frames = buf.readUInt32BE(o + 12 + side); }
  return { id3, first: o, bitrate, sr, spf, vbrTag: tag === 'Xing' || tag === 'Info' ? tag : null, frames };
}
if (process.argv[1].endsWith('audit.mjs')) {
  const report = [];
  for (const [rid, mid] of targets) {
    const r = ar.find((x) => x.id === rid); const m = r.moshaf.find((x) => x.id === mid);
    const surahs = m.surah_list.split(',').map(Number).sort((a, b) => a - b);
    const tread = timingReads.find((t) => t.id === mid);
    const rec = { reciterId: rid, reciter: r.name, moshafId: mid, moshafName: m.name, moshafType: m.moshaf_type, server: m.server, surahTotal: m.surah_total, surahList: surahs, timingRead: tread ? tread.id : null, timingRewaya: tread?.rewaya ?? null, timingFolder: tread?.folder_url ?? null, files: {}, timing: {} };
    rec.missingSurahs = []; for (let s = 1; s <= 114; s++) if (!surahs.includes(s)) rec.missingSurahs.push(s);
    await pool(surahs, 6, async (s) => {
      const url = m.server + String(s).padStart(3, '0') + '.mp3';
      const info = { url, status: null };
      try {
        const rr = await fetchRetry(url, { headers: { Range: 'bytes=0-65535' } });
        info.status = rr.status; const cr = rr.headers.get('content-range'); info.size = cr ? +cr.split('/')[1] : +rr.headers.get('content-length');
        info.cors = rr.headers.get('access-control-allow-origin'); info.ranges = rr.status === 206; info.type = rr.headers.get('content-type');
        const buf = Buffer.from(await rr.arrayBuffer()); Object.assign(info, mp3Info(buf));
        if (info.frames) info.durationMs = Math.round(info.frames * info.spf / info.sr * 1000);
        else if (info.bitrate) info.durationMs = Math.round((info.size - info.first) * 8 / info.bitrate);
      } catch (e) { info.error = String(e); }
      rec.files[s] = info;
    });
    if (tread) {
      await pool(Array.from({ length: 114 }, (_, i) => i + 1), 6, async (s) => {
        const f = path.join(cache, `${mid}_${s}.json`); let j;
        if (fs.existsSync(f)) j = JSON.parse(fs.readFileSync(f, 'utf8'));
        else { const res = await fetchRetry(`https://www.mp3quran.net/api/v3/ayat_timing?surah=${s}&read=${mid}`); const t = await res.text(); try { j = JSON.parse(t); } catch { j = { parseError: t.slice(0, 200) }; } fs.writeFileSync(f, JSON.stringify(j)); }
        const t = { ok: true, problems: [] };
        if (!Array.isArray(j) || j.length === 0) { t.ok = false; t.problems.push('no timing'); rec.timing[s] = t; return; }
        const ay = j.filter((x) => x.ayah > 0); const n = counts[s - 1];
        const nums = ay.map((x) => x.ayah);
        if (nums.length !== n || nums.some((v, i) => v !== i + 1)) { t.ok = false; t.problems.push(`ayah set ${nums.length}/${n} first=${nums[0]} last=${nums.at(-1)}`); }
        t.hasIntro = j.some((x) => x.ayah === 0);
        let prevEnd = null, minDur = Infinity, maxGap = 0, overlaps = 0;
        for (const x of j) {
          const st = +x.start_time, en = +x.end_time;
          if (!(en > st)) { t.ok = false; t.problems.push(`ayah ${x.ayah} non-positive ${st}-${en}`); }
          if (x.ayah > 0) minDur = Math.min(minDur, en - st);
          if (prevEnd !== null) { const gap = st - prevEnd; if (gap < 0) overlaps++; maxGap = Math.max(maxGap, Math.abs(gap)); }
          prevEnd = en;
        }
        Object.assign(t, { minAyahMs: minDur, maxGapMs: maxGap, overlaps, lastEnd: prevEnd, firstAyahStart: ay[0] ? +ay[0].start_time : null });
        if (overlaps) { t.ok = false; t.problems.push(`${overlaps} overlaps`); }
        if (minDur < 700) t.problems.push(`short ayah ${minDur}ms`);
        const fi = rec.files[s];
        if (fi?.durationMs) {
          t.audioMs = fi.durationMs; const over = prevEnd - fi.durationMs; t.endVsAudioMs = over;
          if (over > 1500) { t.ok = false; t.problems.push(`timing ends ${over}ms after audio`); }
          if (over < -30000) t.problems.push(`timing ends ${-over}ms before audio end`);
        } else if (!surahs.includes(s)) t.problems.push('no mp3 for surah');
        rec.timing[s] = t;
      });
      rec.timingBadSurahs = Object.entries(rec.timing).filter(([, t]) => !t.ok).map(([s, t]) => `${s}:${t.problems.join(';')}`);
      rec.timingWarnSurahs = Object.entries(rec.timing).filter(([, t]) => t.ok && t.problems.length).map(([s, t]) => `${s}:${t.problems.join(';')}`);
    }
    rec.fileBadSurahs = Object.entries(rec.files).filter(([, f]) => !(f.status === 206 || f.status === 200)).map(([s]) => +s);
    const files = Object.values(rec.files);
    rec.bitrates = [...new Set(files.map((f) => f.bitrate))]; rec.vbrFiles = files.filter((f) => f.vbrTag === 'Xing').length;
    rec.totalBytes = files.reduce((a, f) => a + (f.size || 0), 0);
    rec.cors = [...new Set(files.map((f) => f.cors))]; rec.rangeSupport = files.every((f) => f.ranges);
    console.log(`${mid} ${r.name} | ${m.name} | surahs ${surahs.length} | files bad ${rec.fileBadSurahs.length} | ${tread ? `timing bad ${rec.timingBadSurahs.length} warn ${rec.timingWarnSurahs.length}` : 'NO TIMING'} | br ${rec.bitrates} vbr ${rec.vbrFiles} | ${(rec.totalBytes / 1e6).toFixed(0)} MB`);
    report.push(rec);
  }
  fs.writeFileSync(D + '/audit.json', JSON.stringify(report, null, 1));
}
