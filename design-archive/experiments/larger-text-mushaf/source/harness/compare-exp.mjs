// Comparison images for the larger-text experiment, built ONLY from the real captures: side-by-side screenshots at
// equal size, and 1:1 device-pixel crops (never enlarged) of the same region. Every panel is labelled with its file.
import { readFileSync, writeFileSync } from 'node:fs';
import { driver, launch } from './cdp.mjs';

const OUT = 'C:/Users/hamzalabib/OneDrive - McGill University/Documents/Personal/My App/QuranHeals/design-archive/experiments/larger-text-mushaf';
const S = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const meas = JSON.parse(readFileSync(`${OUT}/calculations/measurements.json`, 'utf8'));
const uri = (f) => `data:image/png;base64,${readFileSync(`${OUT}/screenshots/${f}`).toString('base64')}`;
const SOURCE = 'Expo Web / headless Chrome capture (not a device). Device-equivalent reading area.';
const label = (id) => ({ 'A-original': 'A — Original', 'B-3pct': 'B — +3%', 'C-5pct': 'C — +5%', 'E-6pct-balanced': 'E — +6.2% (balanced margins)', 'D-8pct': 'D — +8%', 'F-frame-only': 'F — taller frame only (0%)' })[id];
const stat = (file) => {
  const m = meas.find((x) => x.file === file);
  if (!m) return '';
  return `glyph ${m.fontSize.toFixed(2)} pt · text width ${m.textAreaWidth.toFixed(1)} pt · frame ${m.frameWidth.toFixed(0)}×${m.frameHeight.toFixed(0)} pt (${m.frameTiles} tiles) · ink to rule L ${m.inkClearLeft} / R ${m.inkClearRight} pt · lines ${m.quranLines}, match dataset: ${m.linesMatchDataset ? 'yes' : 'NO'}`;
};

const sideBySide = [
  ['01-page004-original-vs-best-C', 'Page 4 — original vs best demonstrably safe (C, +5%) — iPhone 14 reading area', ['p004-standard-iphone-14-A-original.png', 'p004-standard-iphone-14-C-5pct.png']],
  ['02-page604-original-vs-best-C', 'Page 604 — original vs best demonstrably safe (C, +5%) — iPhone 14 reading area', ['p604-standard-iphone-14-A-original.png', 'p604-standard-iphone-14-C-5pct.png']],
  ['03-page004-original-vs-3pct', 'Page 4 — original vs B (+3%) — iPhone 14 reading area', ['p004-standard-iphone-14-A-original.png', 'p004-standard-iphone-14-B-3pct.png']],
  ['04-page004-original-vs-5pct', 'Page 4 — original vs C (+5%) — iPhone 14 reading area', ['p004-standard-iphone-14-A-original.png', 'p004-standard-iphone-14-C-5pct.png']],
  ['05-page004-original-vs-8pct-FAIL', 'Page 4 — original vs D (+8%, FAIL: ink within 1 pt of the inner rule) — iPhone 14 reading area', ['p004-standard-iphone-14-A-original.png', 'p004-standard-iphone-14-D-8pct.png']],
  ['06-page604-original-vs-3pct', 'Page 604 — original vs B (+3%)', ['p604-standard-iphone-14-A-original.png', 'p604-standard-iphone-14-B-3pct.png']],
  ['07-page604-original-vs-8pct-FAIL', 'Page 604 — original vs D (+8%, FAIL)', ['p604-standard-iphone-14-A-original.png', 'p604-standard-iphone-14-D-8pct.png']],
  ['08-page004-all-candidates-iphone14', 'Page 4 — every candidate, same viewport', ['p004-standard-iphone-14-A-original.png', 'p004-standard-iphone-14-B-3pct.png', 'p004-standard-iphone-14-C-5pct.png', 'p004-standard-iphone-14-E-6pct-balanced.png', 'p004-standard-iphone-14-D-8pct.png', 'p004-standard-iphone-14-F-frame-only.png']],
  ['09-page604-all-candidates-iphone14', 'Page 604 — every candidate, same viewport', ['p604-standard-iphone-14-A-original.png', 'p604-standard-iphone-14-B-3pct.png', 'p604-standard-iphone-14-C-5pct.png', 'p604-standard-iphone-14-E-6pct-balanced.png', 'p604-standard-iphone-14-D-8pct.png', 'p604-standard-iphone-14-F-frame-only.png']],
  ['10-page004-small-iphone-se', 'Page 4 — iPhone SE reading area: original vs C (+5%; the band reclaimed also widens this height-limited page)', ['p004-small-iphone-se-A-original.png', 'p004-small-iphone-se-C-5pct.png']],
  ['11-page004-large-iphone-16-pro-max', 'Page 4 — iPhone 16 Pro Max reading area: original vs C (+5%)', ['p004-large-iphone-16-pro-max-A-original.png', 'p004-large-iphone-16-pro-max-C-5pct.png']],
  ['12-page004-android-pixel', 'Page 4 — Android Pixel reading area (Chrome, not Android): original vs C (+5%)', ['p004-android-pixel-A-original.png', 'p004-android-pixel-C-5pct.png']],
  ['13-page604-dark', 'Page 604 — Dark Mode: original vs C (+5%)', ['p604-standard-iphone-14-A-original-dark.png', 'p604-standard-iphone-14-C-5pct-dark.png']],
  ['14-page004-dark', 'Page 4 — Dark Mode: original vs C (+5%)', ['p004-standard-iphone-14-A-original-dark.png', 'p004-standard-iphone-14-C-5pct-dark.png']],
];

const browser = await launch({ port: 9342, profile: `${S}chrome-compare` });
const d = driver(browser);
const write = async (name, html, width) => {
  await d.goto('about:blank');
  await d.sleep(300);
  await d.viewport({ width, height: 800, scale: 1 });
  await d.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close(); true`);
  await d.waitFor('[...document.images].every((i) => i.complete && i.naturalWidth) && [...document.querySelectorAll("canvas")].every((c) => c.dataset.done)', 30000).catch(async (e) => { console.log('errors', browser.consoleErrors, await d.evaluate('[...document.querySelectorAll("canvas")].map((c) => c.dataset.r + " " + c.dataset.done)')); throw e; });
  if (browser.consoleErrors.length) console.log('page errors', browser.consoleErrors.splice(0));
  const h = await d.evaluate('document.body.scrollHeight');
  await d.viewport({ width, height: h, scale: 1 });
  await d.shot(`${OUT}/comparisons/${name}.png`);
  console.log('saved', name);
};
try {
  await d.goto('about:blank');
  for (const [name, title, files] of sideBySide) {
    const each = files.length > 2 ? 300 : 460;
    const html = `<body style="margin:0;background:#fff;font:600 18px system-ui,sans-serif;color:#222">
      <div style="padding:14px 18px 2px">${title}</div><div style="padding:0 18px 10px;font:400 13px system-ui;color:#555">${SOURCE} Panels at equal size, unscaled relative to each other.</div>
      <div style="display:flex;gap:16px;padding:0 18px 18px;align-items:flex-start">${files.map((f) => `
        <figure style="margin:0;width:${each}px"><figcaption style="font-size:15px;min-height:22px">${label(/-(A-original|B-3pct|C-5pct|E-6pct-balanced|D-8pct|F-frame-only)/.exec(f)[1])}${f.includes('-dark') ? ' · Dark' : ''}</figcaption>
        <img src="${uri(f)}" style="width:${each}px;border:1px solid #bbb;display:block">
        <div style="font:400 11px system-ui;color:#444;padding-top:4px;min-height:44px">${stat(f)}<br>${f}</div></figure>`).join('')}</div></body>`;
    await write(name, html, files.length * (each + 16) + 36);
  }

  // 1:1 device-pixel crops (iPhone 14, 3×): the line starts at the right edge (the tightest ink), and a line middle.
  const crop = (file, region) => {
    const m = meas.find((x) => x.file === file);
    return { file, m, region };
  };
  const cropSets = [
    ['20-crop-right-edge-page004', 'Page 4 — right edge of lines 3–6 at 1:1 device pixels (no enlargement): ink vs the inner rule', 'right'],
    ['21-crop-line-middle-page004', 'Page 4 — the middle of lines 4–5 at 1:1 device pixels: glyph size (ظلمت ورعد وبرق يجعلون أصابعهم … الموت والله محيط)', 'middle'],
    ['22-crop-right-edge-page604', 'Page 604 — right edge, Surat al-Falaq at 1:1 device pixels', 'right604'],
  ];
  for (const [name, title, kind] of cropSets) {
    const page = kind === 'right604' ? 'p604' : 'p004';
    const ids = ['A-original', 'C-5pct', 'E-6pct-balanced', 'D-8pct'];
    const panels = ids.map((id) => crop(`${page}-standard-iphone-14-${id}.png`));
    const canvases = panels.map(({ file, m }, i) => {
      const W = m.pageWidth, s = 3;
      // Region in CSS pt, relative to the page's top-left (x 3, y 36 at this viewport).
      const frameTop = 36 + W * (18 / 593) * 1.6 + W * (20.6 / 593);
      let r;
      if (kind === 'middle') r = { x: 3 + W * 0.25, y: frameTop + W * 0.05 + m.linePitch * 3, w: W * 0.5, h: m.linePitch * 2.2 };
      else if (kind === 'right') r = { x: 3 + W * 0.62, y: frameTop + W * 0.05 + m.linePitch * 2, w: W * 0.38, h: m.linePitch * 4 };
      else r = { x: 3 + W * 0.62, y: frameTop + m.frameHeight * 0.38, w: W * 0.38, h: m.linePitch * 4 };
      return `<figure style="margin:0"><figcaption style="font-size:14px">${label(ids[i])} — ${stat(file).split(' · ').slice(0, 1)} · R ink ${m.inkClearRight} pt</figcaption>
        <canvas id="c${i}" data-src="${i}" data-r='${JSON.stringify({ x: r.x * s, y: r.y * s, w: Math.round(r.w * s), h: Math.round(r.h * s) })}' style="border:1px solid #bbb;display:block"></canvas>
        <div style="font:400 11px system-ui;color:#444">${file}</div></figure>`;
    });
    const srcs = panels.map(({ file }) => uri(file));
    const html = `<body style="margin:0;background:#fff;font:600 18px system-ui,sans-serif;color:#222">
      <div style="padding:14px 18px 2px">${title}</div><div style="padding:0 18px 10px;font:400 13px system-ui;color:#555">${SOURCE} Each crop copies the capture's own device pixels 1:1.</div>
      <div style="display:flex;flex-wrap:wrap;gap:14px;padding:0 18px 18px">${canvases.join('')}</div>
      <script>const srcs=${JSON.stringify(srcs)};document.querySelectorAll('canvas').forEach((c)=>{const r=JSON.parse(c.dataset.r);const i=new Image();i.onload=()=>{c.width=r.w;c.height=r.h;c.style.width=r.w+'px';c.getContext('2d').drawImage(i,r.x,r.y,r.w,r.h,0,0,r.w,r.h);c.dataset.done='1'};i.src=srcs[Number(c.dataset.src)];});</script></body>`;
    await write(name, html, 1100);
  }
} finally {
  browser.close();
}
