// The launcher's state: settings, the apps on the device (Android apps and launcher apps
// together), pins, recents and the rows apps add to the home screen.

import { call } from './native.js';
import { colorOf } from './colors.js';

export const DEFAULT_REPO = 'https://raw.githubusercontent.com/MightyX3N/PlayBigScreen/main/repository/index.json';

export const BACKGROUNDS = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'dusk', name: 'Dusk' },
  { id: 'forest', name: 'Forest' },
  { id: 'ember', name: 'Ember' },
  { id: 'harbour', name: 'Harbour' },
  { id: 'slate', name: 'Slate' },
];

export const ACCENTS = ['#4fd8c4', '#9b8cff', '#ffb547', '#ff7a90', '#5cb8ff', '#a6e35a'];

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const defaults = {
  accent: ACCENTS[0],
  look: 'glass', // or 'flat' (no blur: lighter on slow TV boxes)
  clock: 'auto', // '12', '24'
  bgMode: 'app', // 'app': each app's own background; 'fixed': always `bg`
  bg: 'aurora',
  appBg: {}, // app key -> background id, chosen per app
  rows: [], // [{ id, on }] in order; rows not listed yet are added at the end
  repos: [DEFAULT_REPO],
  hidden: [], // app keys hidden from the home row and apps
};

export const settings = $state({ ...defaults, ...load('pbs-settings', {}) });
export function saveSettings() { save('pbs-settings', $state.snapshot(settings)); }

export const device = $state({ platform: 'web', version: '', name: '', tv: false, home: { isDefault: false, canSet: false }, helper: { available: false, on: false }, ready: false });

/** Every app on the device, as the launcher shows it. */
export const apps = $state({ list: [], loaded: false });

/** Pinned app keys in home-row order, or null for "not chosen yet" (then a sensible start). */
export const pins = $state({ keys: load('pbs-pins', null) });
export const recents = $state({ list: load('pbs-recents', []) }); // [{ key, at }]
const colors = load('pbs-colors', {});

/** Rows apps add to the home screen: appId -> [{ id, title, shape, items }] */
export const appRows = $state({});

export function bgUrl(id) {
  if (!id) return '';
  if (id.startsWith('url:')) return id.slice(4);
  return `/backgrounds/${id}.jpg`;
}

/** The background for an app (or for home with nothing focused). */
export function backgroundFor(app) {
  if (app && settings.appBg[app.key]) return bgUrl(settings.appBg[app.key]);
  if (settings.bgMode === 'app' && app && app.background) return app.background;
  return bgUrl(settings.bg);
}

function launcherApp(m) {
  const base = m.url;
  return {
    key: 'app:' + m.id,
    kind: 'app',
    id: m.id,
    name: m.name,
    subtitle: m.subtitle || m.description || '',
    icon: m.icon ? new URL(m.icon, base).href : '',
    color: m.color || '#334155',
    background: m.background ? new URL(m.background, base).href : '',
    mode: m.mode === 'window' ? 'window' : 'fullscreen',
    version: m.version,
    manifest: m,
    url: base,
  };
}

function androidApp(a) {
  const key = 'android:' + a.package;
  return {
    key,
    kind: 'android',
    pkg: a.package,
    name: a.name,
    subtitle: a.system ? 'System' : 'Android app',
    icon: a.icon,
    banner: a.banner || '',
    color: colors[key] || '#2b3445',
    background: '',
    system: !!a.system,
    versionCode: a.versionCode || 0,
    versionName: a.versionName || '',
  };
}

export async function loadDevice() {
  try {
    const info = await call('info');
    Object.assign(device, info, { ready: true });
  } catch (e) {
    console.error('info', e);
    device.ready = true;
  }
}

export async function loadApps() {
  const [android, mine] = await Promise.all([
    call('android.list').catch((e) => { console.error(e); return []; }),
    call('apps.list').catch((e) => { console.error(e); return []; }),
  ]);
  const list = [...mine.map(launcherApp), ...android.map(androidApp)];
  list.sort((a, b) => a.name.localeCompare(b.name));
  apps.list = list;
  apps.loaded = true;
  // Android icons don't come with a colour: take the strongest one from the icon.
  for (const a of list) {
    if (a.kind === 'android' && !colors[a.key] && a.icon) {
      colorOf(a.icon).then((c) => {
        if (!c) return;
        colors[a.key] = c;
        save('pbs-colors', colors);
        const live = apps.list.find((x) => x.key === a.key);
        if (live) live.color = c;
      });
    }
  }
}

export function appByKey(key) {
  return apps.list.find((a) => a.key === key);
}

/** The apps on the home row, in order. */
export function pinnedApps() {
  const byKey = new Map(apps.list.map((a) => [a.key, a]));
  const keys = pins.keys ?? startingPins();
  return keys.map((k) => byKey.get(k)).filter(Boolean);
}

function startingPins() {
  // Launcher apps first, then Android apps; leave out system ones like Settings.
  const mine = apps.list.filter((a) => a.kind === 'app');
  const android = apps.list.filter((a) => a.kind === 'android' && !a.system);
  return [...mine, ...android].slice(0, 12).map((a) => a.key);
}

export function isPinned(key) {
  return (pins.keys ?? startingPins()).includes(key);
}

export function setPins(keys) {
  pins.keys = [...keys];
  save('pbs-pins', pins.keys);
}

export function pin(key) {
  const keys = pins.keys ?? startingPins();
  if (!keys.includes(key)) setPins([...keys, key]);
}

export function unpin(key) {
  setPins((pins.keys ?? startingPins()).filter((k) => k !== key));
}

/** Moves a pinned app by `by` places (−1 left, +1 right). */
export function movePin(key, by) {
  const keys = [...(pins.keys ?? startingPins())];
  const i = keys.indexOf(key);
  const j = i + by;
  if (i < 0 || j < 0 || j >= keys.length) return false;
  [keys[i], keys[j]] = [keys[j], keys[i]];
  setPins(keys);
  return true;
}

export function noteRecent(key) {
  recents.list = [{ key, at: Date.now() }, ...recents.list.filter((r) => r.key !== key)].slice(0, 24);
  save('pbs-recents', recents.list);
}

export function clearRecents() {
  recents.list = [];
  save('pbs-recents', []);
}

/** Home rows in the chosen order, with the ones not placed yet at the end. */
export function homeRows() {
  const known = [{ id: 'apps', title: 'Apps', builtin: true }, { id: 'recents', title: 'Recently used', builtin: true }];
  for (const a of apps.list) {
    if (a.kind !== 'app') continue;
    for (const r of appRows[a.id] || []) known.push({ id: `app:${a.id}:${r.id}`, title: r.title, app: a, row: r });
  }
  const order = settings.rows;
  const out = [];
  for (const o of order) {
    const k = known.find((x) => x.id === o.id);
    if (k) out.push({ ...k, on: o.on });
  }
  for (const k of known) if (!order.some((o) => o.id === k.id)) out.push({ ...k, on: k.id !== 'recents' });
  return out;
}

export function setRowOrder(rows) {
  settings.rows = rows.map((r) => ({ id: r.id, on: r.on }));
  saveSettings();
}

export function applyLook() {
  const html = document.documentElement;
  html.style.setProperty('--accent', settings.accent);
  html.dataset.look = settings.look;
}

export function use24h() {
  if (settings.clock === '24') return true;
  if (settings.clock === '12') return false;
  try {
    return !new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;
  } catch { return true; }
}
