// Seek lab host server (Phase 4.4, local only): GET /plan.json, GET /files/<variant>/<name> (HTTP Range, as a CDN),
// POST /result/<id> (saved to ./results). Variants: mllt = p43/mllt, cbr = p43/cbr. Listens on 0.0.0.0:8099 so the
// emulator reaches it at 10.0.2.2:8099; nothing is published anywhere.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = { mllt: path.join(here, '..', '..', 'p43', 'mllt'), cbr: path.join(here, '..', '..', 'p43', 'cbr'), orig: path.join(here, '..', '..', 'p41', 'batch', '_audio') };
fs.mkdirSync(path.join(here, 'results'), { recursive: true });

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname.startsWith('/result/')) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const id = path.basename(url.pathname);
      fs.writeFileSync(path.join(here, 'results', `${id}.json`), Buffer.concat(chunks));
      console.log('result', id, Buffer.concat(chunks).length);
      res.end('ok');
    });
    return;
  }
  if (url.pathname === '/plan.json') {
    res.setHeader('content-type', 'application/json');
    res.end(fs.readFileSync(path.join(here, 'plan.json')));
    return;
  }
  const h = url.pathname.match(/^\/files\/hls\/([\w.-]+\.m3u8)$/);
  if (h) {
    res.setHeader('content-type', 'application/vnd.apple.mpegurl');
    res.end(fs.readFileSync(path.join(here, 'hls', h[1])));
    return;
  }
  if (url.pathname === '/log') {
    console.log('log', Date.now(), url.searchParams.get('m'));
    res.end('ok');
    return;
  }
  const m = url.pathname.match(/^\/files\/(mllt|cbr|orig)\/([\w.-]+\.mp3)$/);
  if (!m) { res.statusCode = 404; res.end(); return; }
  const file = path.join(roots[m[1]], m[2]);
  const size = fs.statSync(file).size;
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-type', 'audio/mpeg');
  const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
  if (range) {
    const a = Number(range[1]);
    const b = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.statusCode = 206;
    res.setHeader('content-range', `bytes ${a}-${b}/${size}`);
    res.setHeader('content-length', b - a + 1);
    fs.createReadStream(file, { start: a, end: b }).pipe(res);
  } else {
    res.setHeader('content-length', size);
    fs.createReadStream(file).pipe(res);
  }
}).listen(8099, '0.0.0.0', () => console.log('seek lab on :8099'));
