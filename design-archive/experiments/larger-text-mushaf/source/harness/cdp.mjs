// Minimal Chrome DevTools Protocol driver (Node built-ins only): a phone-sized viewport, real mouse input, screenshots.
// Used to capture the running Expo web app for the Mushaf visual review. Not part of the repository.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ port = 9333, profile }) {
  const proc = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--disable-gpu', '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore' });
  let version;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); }
  }
  if (!version) throw new Error('Chrome did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) for (const l of listeners) l(msg);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const consoleErrors = [];
  listeners.add((msg) => {
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text);
  });
  await send('Page.enable');
  await send('Runtime.enable');
  return { proc, send, consoleErrors, close: () => { try { ws.close(); } catch { /* closed */ } proc.kill(); } };
}

export function driver(browser) {
  const { send } = browser;
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  return {
    evaluate,
    async viewport({ width, height, scale = 3 }) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: false });
    },
    async colorScheme(dark) {
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
    },
    async goto(url) {
      await send('Page.navigate', { url });
      await sleep(400);
    },
    /** Waits until `predicate` (a JS expression) is true in the page. */
    async waitFor(predicate, timeout = 60000, label = predicate) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await evaluate(`Boolean(${predicate})`)) return; } catch { /* page navigating */ }
        await sleep(300);
      }
      const text = await evaluate('document.body ? document.body.innerText.slice(0, 600) : ""').catch(() => '');
      throw new Error(`timeout: ${label}\n${text}`);
    },
    /** The centre (or a point) of an element in CSS pixels; null if absent or not visible. */
    async rect(selector) {
      return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    },
    async mouse(type, x, y) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'mouse' });
    },
    async click(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
      await this.mouse('mousePressed', x, y);
      await sleep(60);
      await this.mouse('mouseReleased', x, y);
    },
    async clickSelector(selector, { dx = 0.5, dy = 0.5 } = {}) {
      const r = await this.rect(selector);
      if (!r) throw new Error(`no element ${selector}`);
      await this.click(r.x + r.width * dx, r.y + r.height * dy);
    },
    /** A press, a drag in `steps` moves, and a release (the RN-web responder system sees real mouse events). */
    async drag(from, to, steps = 12) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, pointerType: 'mouse' });
      await this.mouse('mousePressed', from.x, from.y);
      for (let i = 1; i <= steps; i++) {
        const x = from.x + ((to.x - from.x) * i) / steps;
        const y = from.y + ((to.y - from.y) * i) / steps;
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, pointerType: 'mouse' });
        await sleep(16);
      }
      await this.mouse('mouseReleased', to.x, to.y);
    },
    async type(text) {
      await send('Input.insertText', { text });
    },
    async shot(path) {
      mkdirSync(dirname(path), { recursive: true });
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(data, 'base64'));
      return path;
    },
    sleep,
  };
}
