#!/usr/bin/env node
// PlayBigScreen host for a browser: serves the launcher UI and its apps, and answers the
// launcher's calls to "the device" (the same calls the Android app answers). It's used to
// develop and test PlayBigScreen on a computer, and is where the Linux version starts.
//
//   node host/server.mjs [--port 8600] [--data host/.data] [--ui ui/dist]
//
// The launcher is at http://localhost:PORT/ and each launcher app gets its own origin,
// http://<id>.app.localhost:PORT/, so apps can't read each other's (or the launcher's) data.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const PORT = Number(arg('port', process.env.PORT || 8600));
const DATA = path.resolve(arg('data', path.join(here, '.data')));
const UI = path.resolve(arg('ui', path.join(root, 'ui', 'dist')));
const SDK = path.join(root, 'sdk', 'playbigscreen.js');
const VERSION = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const APPS = path.join(DATA, 'apps');
fs.mkdirSync(APPS, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };

// ---- "The device" ----------------------------------------------------------------------
// The Android apps here are pretend ones (with our own icons), so the launcher has
// something to show and tests have something to start.
const fakeAndroid = JSON.parse(fs.readFileSync(path.join(here, 'fake-android.json'), 'utf8'));
const state = { volume: 9, maxVolume: 15, muted: false, log: [], installedApks: [] };
const jar = new Map(); // host -> Map(name -> value), for http calls
const clients = new Set(); // event streams

function emit(event, data) {
  const line = `data: ${JSON.stringify({ event, data })}\n\n`;
  for (const c of clients) c.write(line);
}

function logCall(method, args) {
  state.log.push({ method, args, at: Date.now() });
  if (state.log.length > 500) state.log.shift();
}

function safeId(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(id || '')) throw new Error('bad app id');
  return id;
}

function inside(base, rel) {
  const p = path.resolve(base, '.' + path.posix.normalize('/' + rel));
  if (p !== base && !p.startsWith(base + path.sep)) throw new Error('bad path');
  return p;
}

async function readApps(port) {
  const out = [];
  for (const id of await fsp.readdir(APPS).catch(() => [])) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(APPS, id, 'app.json'), 'utf8'));
      out.push({ ...m, id, url: `http://${id}.app.localhost:${port}/` });
    } catch { /* half-installed or broken: skip */ }
  }
  return out;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function fetchBytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function installApp({ id, base, files }) {
  safeId(id);
  if (!files || !files['app.json']) throw new Error('an app needs app.json');
  const tmp = path.join(APPS, `.${id}.${process.pid}.${Date.now()}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    for (const [name, hash] of Object.entries(files)) {
      const body = await fetchBytes(new URL(name, base).href);
      if (sha256(body) !== hash) throw new Error(`${name} doesn't match its checksum`);
      const to = inside(tmp, name);
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.writeFile(to, body);
    }
    const m = JSON.parse(await fsp.readFile(path.join(tmp, 'app.json'), 'utf8'));
    if (m.id !== id) throw new Error('app.json has another id');
    const dest = path.join(APPS, id);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.rename(tmp, dest);
    return m;
  } catch (e) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw e;
  }
}

function cookieHeader(u) {
  const c = jar.get(u.host);
  return c && c.size ? [...c].map(([k, v]) => `${k}=${v}`).join('; ') : '';
}

function keepCookies(u, res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (!set.length) return;
  const c = jar.get(u.host) || new Map();
  for (const line of set) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) {
      const k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(line) || v === '') c.delete(k); else c.set(k, v);
    }
  }
  jar.set(u.host, c);
}

async function httpCall({ url, method = 'GET', headers = {}, body = null, as = 'text' }) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('only http and https');
  const h = { ...headers };
  const ck = cookieHeader(u);
  if (ck && !Object.keys(h).some((k) => k.toLowerCase() === 'cookie')) h.Cookie = ck;
  let res;
  try {
    res = await fetch(u, { method, headers: h, body: body == null || method === 'GET' ? undefined : body, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  } catch (e) {
    return { status: 0, headers: {}, body: '', error: String(e.cause?.code || e.message) };
  }
  keepCookies(u, res);
  const buf = Buffer.from(await res.arrayBuffer());
  const hs = {};
  res.headers.forEach((v, k) => { if (k !== 'set-cookie') hs[k] = v; });
  return { status: res.status, headers: hs, url: res.url, body: as === 'base64' ? buf.toString('base64') : buf.toString('utf8') };
}

const bridge = {
  async info(_, req) {
    return { platform: 'web', host: 'browser', version: VERSION, device: 'This computer', tv: false, home: { isDefault: false, canSet: false }, helper: { available: false } };
  },
  'android.list': async () => fakeAndroid.map((a) => ({ package: a.package, name: a.name, icon: `/__icon/${a.package}.svg`, banner: null, system: !!a.system, versionCode: a.versionCode || 0, versionName: a.versionName || '' })),
  'android.launch': async ({ package: pkg }) => {
    if (!fakeAndroid.some((a) => a.package === pkg)) throw new Error('no such app');
    return { started: true };
  },
  'android.uninstall': async () => ({ asked: true }),
  'android.details': async () => ({ opened: true }),
  'apps.list': async (_, req) => readApps(PORT),
  'apps.install': async (a) => installApp(a),
  'apps.remove': async ({ id }) => { await fsp.rm(path.join(APPS, safeId(id)), { recursive: true, force: true }); return { removed: true }; },
  http: httpCall,
  'apk.install': async ({ url, sha256: want, package: pkg }) => {
    const buf = await fetchBytes(url);
    if (want && sha256(buf) !== want) throw new Error("the download doesn't match its checksum");
    state.installedApks.push(pkg);
    return { status: 'pending-user' };
  },
  status: async () => ({ network: { type: 'ethernet', connected: true }, bluetooth: { on: true } }),
  'volume.get': async () => ({ level: state.volume, max: state.maxVolume, muted: state.muted }),
  'volume.set': async ({ level, muted }) => {
    if (typeof level === 'number') state.volume = Math.max(0, Math.min(state.maxVolume, Math.round(level)));
    if (typeof muted === 'boolean') state.muted = muted;
    return { level: state.volume, max: state.maxVolume, muted: state.muted };
  },
  'settings.open': async ({ page }) => ({ opened: page }),
  exit: async () => ({ ok: true }),
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function send(res, status, type, data, extra = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
  res.end(data);
}

async function serveFile(res, file, extra) {
  try {
    const st = await fsp.stat(file);
    if (st.isDirectory()) return serveFile(res, path.join(file, 'index.html'), extra);
    send(res, 200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', await fsp.readFile(file), extra);
    return true;
  } catch {
    return false;
  }
}

// The SDK files every app can load from its own origin: /__pbs/sdk.js, pbs.css, lexend.woff2
async function serveSdk(res, name) {
  const file = name === 'sdk.js' ? SDK : ['pbs.css', 'lexend.woff2'].includes(name) ? path.join(root, 'sdk', name) : null;
  if (!file || !(await serveFile(res, file, { 'Access-Control-Allow-Origin': '*' }))) send(res, 404, 'text/plain', 'not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const host = url.hostname;
  try {
    // A launcher app's own origin.
    const m = /^([a-z0-9][a-z0-9-]*)\.app\.localhost$/.exec(host);
    if (m) {
      const id = m[1];
      if (url.pathname.startsWith('/__pbs/')) return void (await serveSdk(res, url.pathname.slice(7)));
      const file = inside(path.join(APPS, id), decodeURIComponent(url.pathname));
      // Apps can't be framed by anyone but the launcher.
      const extra = { 'Content-Security-Policy': `frame-ancestors http://localhost:${PORT} http://127.0.0.1:${PORT}` };
      if (!(await serveFile(res, file, extra))) send(res, 404, 'text/plain', 'not found');
      return;
    }

    if (url.pathname === '/bridge' && req.method === 'POST') {
      const { method, args } = JSON.parse(await body(req) || '{}');
      const fn = bridge[method];
      logCall(method, args);
      if (!fn) return send(res, 404, 'application/json', JSON.stringify({ error: 'unknown call ' + method }));
      try {
        const result = await fn(args || {}, req);
        send(res, 200, 'application/json', JSON.stringify({ result }));
      } catch (e) {
        send(res, 200, 'application/json', JSON.stringify({ error: String(e.message || e) }));
      }
      return;
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    // For tests: what the launcher asked the device to do, and pretend device events.
    if (url.pathname === '/__test/log') return send(res, 200, 'application/json', JSON.stringify(state.log));
    if (url.pathname === '/__test/clear') { state.log.length = 0; jar.clear(); return send(res, 200, 'text/plain', 'ok'); }
    if (url.pathname === '/__test/emit') { emit(url.searchParams.get('event'), JSON.parse(url.searchParams.get('data') || 'null')); return send(res, 200, 'text/plain', 'ok'); }

    const icon = /^\/__icon\/([\w.]+)\.svg$/.exec(url.pathname);
    if (icon) {
      const a = fakeAndroid.find((x) => x.package === icon[1]);
      if (!a || !(await serveFile(res, path.join(here, 'icons', a.icon)))) send(res, 404, 'text/plain', 'no icon');
      return;
    }
    if (url.pathname.startsWith('/__pbs/')) return void (await serveSdk(res, url.pathname.slice(7)));

    const file = inside(UI, decodeURIComponent(url.pathname));
    if (await serveFile(res, file)) return;
    if (!path.extname(url.pathname) && (await serveFile(res, path.join(UI, 'index.html')))) return;
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 400, 'text/plain', String(e.message || e));
  }
});

server.listen(PORT, () => console.log(`PlayBigScreen host on http://localhost:${PORT}/ (data in ${DATA})`));
