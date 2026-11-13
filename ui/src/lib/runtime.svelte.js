// Running launcher apps. Each runs in a frame on its own origin; it talks to the launcher
// with postMessage (sdk/playbigscreen.js) and the launcher checks where every message
// came from before doing anything for it. Apps that add home rows or search results also
// get a hidden "service" frame that stays loaded.

import { call, platformKind } from './native.js';
import { apps, appRows, device, noteRecent, settings } from './state.svelte.js';
import { toast } from './toast.svelte.js';

export const runner = $state({
  app: null, // the open launcher app
  url: '',
  title: '',
  web: null, // { url } a web page opened by an app (browser host only; Android opens its own view)
  video: null, // { url, title } the browser host's stand-in for the device player
});

/** Frames: app id -> { win, origin, kind: 'main'|'service' } kept by Runner.svelte. */
const frames = new Map();
const services = $state({}); // app id -> { url, ready, provides: [] }
export const serviceList = services;

let replySeq = 0;
const replies = new Map();
let backTimer = null;
let webDone = null;
let videoDone = null;

export function registerFrame(key, win, origin, appId, kind) {
  frames.set(key, { win, origin, appId, kind });
}
export function unregisterFrame(key) {
  frames.delete(key);
}

function frameOf(e) {
  for (const f of frames.values()) if (f.win === e.source) return f;
  return null;
}

function appById(id) {
  return apps.list.find((a) => a.kind === 'app' && a.id === id);
}

function post(f, msg) {
  try { f.win.postMessage({ __pbs: 1, ...msg }, f.origin); } catch (e) { console.error(e); }
}

export function openApp(app, params = {}) {
  noteRecent(app.key);
  const u = new URL(app.manifest.entry || 'index.html', app.url);
  u.searchParams.set('pbs-mode', app.mode);
  if (params.open) u.searchParams.set('pbs-open', params.open);
  runner.app = app;
  runner.title = app.name;
  runner.url = u.href;
}

export function closeApp() {
  runner.app = null;
  runner.url = '';
  runner.title = '';
}

/** Back while an app is open: the app gets it first; if it doesn't use it, the app closes. */
export function backToApp() {
  if (runner.web) { closeWeb(); return true; }
  if (runner.video) { closeVideo(); return true; }
  if (!runner.app) return false;
  const f = [...frames.values()].find((x) => x.kind === 'main' && x.appId === runner.app.id);
  if (!f) { closeApp(); return true; }
  post(f, { event: 'back' });
  clearTimeout(backTimer);
  // An app that doesn't answer (stuck, or not using the SDK) is closed anyway.
  backTimer = setTimeout(closeApp, 700);
  return true;
}

export function closeWeb() { const d = webDone; runner.web = null; webDone = null; d && d({ closed: true }); }
export function closeVideo(position = 0, duration = 0, ended = false) { const d = videoDone; runner.video = null; videoDone = null; d && d({ position, duration, ended }); }

function storageKey(appId, key) { return `pbs-app:${appId}:${key}`; }

async function handle(f, m) {
  const app = appById(f.appId);
  if (!app) throw new Error('this app is not installed');
  const a = m.args || {};
  switch (m.method) {
    case 'hello':
      return { app: { id: app.id, name: app.name, version: app.version }, platform: device.platform, device: device.device || device.name || '', tv: !!device.tv, launcher: device.version, accent: settings.accent, look: settings.look };
    case 'http':
      return call('http', { url: a.url, method: a.method || 'GET', headers: a.headers || {}, body: a.body ?? null, as: a.as === 'base64' ? 'base64' : 'text' });
    case 'storage.get': {
      const v = localStorage.getItem(storageKey(app.id, String(a.key)));
      return v == null ? null : JSON.parse(v);
    }
    case 'storage.set':
      if (a.value == null) localStorage.removeItem(storageKey(app.id, String(a.key)));
      else localStorage.setItem(storageKey(app.id, String(a.key)), JSON.stringify(a.value));
      return true;
    case 'play':
      if (platformKind === 'android') return call('player.play', { url: a.url, title: a.title || '', subtitle: a.subtitle || '', headers: a.headers || {}, start: a.start || 0 });
      return new Promise((resolve) => { videoDone = resolve; runner.video = { url: a.url, title: a.title || '', start: a.start || 0 }; });
    case 'openWeb':
      if (!/^https?:\/\//.test(a.url || '')) throw new Error('only http and https pages');
      if (platformKind === 'android') return call('web.open', { url: a.url, userAgent: a.userAgent || '' });
      return new Promise((resolve) => { webDone = resolve; runner.web = { url: a.url }; });
    case 'close':
      if (f.kind === 'main' && runner.app?.id === app.id) closeApp();
      return true;
    case 'setTitle':
      if (f.kind === 'main' && runner.app?.id === app.id) runner.title = String(a.title || app.name).slice(0, 80);
      return true;
    case 'toast':
      toast(String(a.text || '').slice(0, 200));
      return true;
    case 'refreshRows':
      refreshRows(app.id);
      return true;
    default:
      throw new Error('unknown call ' + m.method);
  }
}

window.addEventListener('message', async (e) => {
  const f = frameOf(e);
  if (!f || e.origin !== f.origin) return; // not one of our apps' frames
  const m = e.data;
  if (!m || m.__pbs !== 1) return;
  if (m.method) {
    try {
      const result = await handle(f, m);
      post(f, { id: m.id, result });
    } catch (err) {
      post(f, { id: m.id, error: String(err?.message || err) });
    }
    return;
  }
  if (m.reply) {
    const r = replies.get(m.reply);
    if (r) { replies.delete(m.reply); clearTimeout(r.timer); m.error ? r.reject(new Error(m.error)) : r.resolve(m.result); }
    return;
  }
  if (m.event === 'back-result' && f.kind === 'main') {
    clearTimeout(backTimer);
    if (!m.handled) closeApp();
    return;
  }
  if (m.event === 'provides' && f.kind === 'service') {
    const s = services[f.appId];
    if (s) {
      const first = !s.ready;
      s.ready = true;
      s.provides = Array.isArray(m.data) ? m.data : [];
      if (first || s.provides.includes('rows')) refreshRows(f.appId);
    }
  }
});

/** Asks an app's service frame for something it provides. */
export function ask(appId, what, args, timeout = 15000) {
  const f = [...frames.values()].find((x) => x.kind === 'service' && x.appId === appId);
  const s = services[appId];
  if (!f || !s?.ready || !s.provides.includes(what)) return Promise.resolve(null);
  const id = ++replySeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { replies.delete(id); reject(new Error('no answer')); }, timeout);
    replies.set(id, { resolve, reject, timer });
    post(f, { provide: what, reply: id, args });
  });
}

const ROW_SHAPES = ['wide', 'poster', 'square'];

function cleanItems(items) {
  return (Array.isArray(items) ? items : []).slice(0, 40).map((it) => ({
    id: String(it.id ?? ''),
    title: String(it.title ?? ''),
    subtitle: String(it.subtitle ?? ''),
    image: typeof it.image === 'string' ? it.image : '',
    backdrop: typeof it.backdrop === 'string' ? it.backdrop : '',
    progress: typeof it.progress === 'number' ? Math.max(0, Math.min(1, it.progress)) : null,
  })).filter((it) => it.id && it.title);
}

export async function refreshRows(appId) {
  try {
    const rows = await ask(appId, 'rows');
    if (!rows) return;
    appRows[appId] = (Array.isArray(rows) ? rows : []).slice(0, 6).map((r) => ({
      id: String(r.id || 'row'),
      title: String(r.title || ''),
      shape: ROW_SHAPES.includes(r.shape) ? r.shape : 'wide',
      items: cleanItems(r.items),
    })).filter((r) => r.items.length);
  } catch (e) {
    console.warn('rows from', appId, e.message);
  }
}

export function refreshAllRows() {
  for (const id of Object.keys(services)) if (services[id].ready) refreshRows(id);
}

export async function searchApps(q) {
  const out = [];
  await Promise.all(Object.keys(services).map(async (id) => {
    try {
      const items = await ask(id, 'search', { query: q }, 8000);
      const app = appById(id);
      if (items && app) out.push({ app, items: cleanItems(items) });
    } catch {}
  }));
  return out.filter((r) => r.items.length);
}

/** Keeps a service frame for every launcher app that says it provides rows or search. */
export function syncServices() {
  const want = apps.list.filter((a) => a.kind === 'app' && Array.isArray(a.manifest.provides) && a.manifest.provides.length);
  for (const id of Object.keys(services)) {
    if (!want.some((a) => a.id === id)) { delete services[id]; delete appRows[id]; }
  }
  for (const a of want) {
    const u = new URL(a.manifest.service || a.manifest.entry || 'index.html', a.url);
    u.searchParams.set('pbs-mode', 'service');
    const url = u.href + '#v=' + encodeURIComponent(a.version || '');
    if (!services[a.id] || services[a.id].url !== url) services[a.id] = { url, ready: false, provides: [] };
  }
}
