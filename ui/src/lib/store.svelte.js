// The Store: launcher apps and Android apps from the repositories in Settings.

import { call } from './native.js';
import { apps, settings, saveSettings, loadApps, pin } from './state.svelte.js';
import { syncServices } from './runtime.svelte.js';

export const store = $state({
  loading: false,
  loaded: false,
  repos: [], // [{ url, name, error }]
  apps: [], // launcher apps on offer
  apks: [], // Android apps on offer
  busy: {}, // entry key -> 'installing' | 'removing'
});

function abs(u, base) {
  try { return u ? new URL(u, base).href : ''; } catch { return ''; }
}

export async function loadStore() {
  store.loading = true;
  const repos = [], offered = [], apks = [];
  await Promise.all(settings.repos.map(async (url) => {
    try {
      const r = await call('http', { url, as: 'text' });
      if (r.status !== 200) throw new Error(r.error || 'HTTP ' + r.status);
      const idx = JSON.parse(r.body);
      repos.push({ url, name: idx.name || new URL(url).host });
      for (const a of idx.apps || []) {
        if (!a.id || !a.path || !a.files) continue;
        const base = new URL(a.path, url).href;
        offered.push({
          key: 'app:' + a.id, kind: 'app', id: a.id, name: a.name || a.id, version: a.version || '', subtitle: a.subtitle || '',
          description: a.description || '', author: a.author || '', color: a.color || '#334155', mode: a.mode || 'fullscreen',
          icon: abs(a.icon, base), base, files: a.files, repo: url, category: a.category || 'Apps',
        });
      }
      for (const p of idx.apks || []) {
        if (!p.package || !p.url) continue;
        apks.push({
          key: 'android:' + p.package, kind: 'apk', pkg: p.package, name: p.name || p.package, version: p.version || '', versionCode: p.versionCode || 0,
          subtitle: p.subtitle || '', description: p.description || '', author: p.author || '', color: p.color || '#334155',
          icon: abs(p.icon, url), url: abs(p.url, url), sha256: p.sha256 || '', size: p.size || 0, repo: url, category: p.category || 'Apps',
        });
      }
    } catch (e) {
      repos.push({ url, name: url, error: String(e.message || e) });
    }
  }));
  // The first repository wins when two offer the same app.
  const order = (x) => settings.repos.indexOf(x.repo);
  const dedupe = (list) => {
    const seen = new Map();
    for (const x of list.sort((a, b) => order(a) - order(b))) if (!seen.has(x.key)) seen.set(x.key, x);
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  store.repos = repos.sort((a, b) => settings.repos.indexOf(a.url) - settings.repos.indexOf(b.url));
  store.apps = dedupe(offered);
  store.apks = dedupe(apks);
  store.loading = false;
  store.loaded = true;
}

function cmpVersion(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** installed (the app on the device, or null) and whether the Store has a newer one. */
export function statusOf(entry) {
  const installed = apps.list.find((a) => a.key === entry.key) || null;
  let update = false;
  if (installed && entry.kind === 'app') update = cmpVersion(entry.version, installed.version) > 0;
  if (installed && entry.kind === 'apk') update = entry.versionCode > 0 && installed.versionCode > 0 && entry.versionCode > installed.versionCode;
  return { installed, update };
}

export function updates() {
  return [...store.apps, ...store.apks].filter((e) => statusOf(e).update);
}

export async function install(entry) {
  store.busy[entry.key] = 'installing';
  try {
    if (entry.kind === 'app') {
      const had = apps.list.some((a) => a.key === entry.key);
      await call('apps.install', { id: entry.id, base: entry.base, files: $state.snapshot(entry.files), version: entry.version });
      await loadApps();
      syncServices();
      if (!had) pin(entry.key);
      return { status: 'installed' };
    }
    // Android asks the person to confirm every install itself.
    return await call('apk.install', { url: entry.url, sha256: entry.sha256, package: entry.pkg, name: entry.name });
  } finally {
    delete store.busy[entry.key];
  }
}

export async function remove(entry) {
  store.busy[entry.key] = 'removing';
  try {
    if (entry.kind === 'app') {
      await call('apps.remove', { id: entry.id });
      await loadApps();
      syncServices();
    } else {
      await call('android.uninstall', { package: entry.pkg });
    }
  } finally {
    delete store.busy[entry.key];
  }
}

export function addRepo(url) {
  url = url.trim();
  if (!/^https?:\/\//.test(url)) throw new Error('A repository address starts with http:// or https://');
  if (!settings.repos.includes(url)) settings.repos = [...settings.repos, url];
  saveSettings();
}

export function removeRepo(url) {
  settings.repos = settings.repos.filter((u) => u !== url);
  saveSettings();
}
