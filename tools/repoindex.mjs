#!/usr/bin/env node
// Writes a repository's index.json from its folders:
//   apps/<id>/app.json (+ the app's files)  ->  "apps", with each file's sha256
//   apks.json                                 ->  "apks"
//   node tools/repoindex.mjs [repository] [--check]
// --check fails when index.json isn't up to date (CI runs it).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const check = args.includes('--check');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || 'repository');

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function filesOf(base, rel = '') {
  const out = {};
  for (const name of fs.readdirSync(path.join(base, rel)).sort()) {
    if (name.startsWith('.')) continue;
    const r = rel ? rel + '/' + name : name;
    const full = path.join(base, r);
    if (fs.statSync(full).isDirectory()) Object.assign(out, filesOf(base, r));
    else out[r] = sha(full);
  }
  return out;
}

const meta = fs.existsSync(path.join(dir, 'repository.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'repository.json'), 'utf8')) : {};
const index = { name: meta.name || path.basename(dir), description: meta.description || '', apps: [], apks: [] };

const appsDir = path.join(dir, 'apps');
for (const id of fs.existsSync(appsDir) ? fs.readdirSync(appsDir).sort() : []) {
  const base = path.join(appsDir, id);
  if (!fs.statSync(base).isDirectory()) continue;
  const m = JSON.parse(fs.readFileSync(path.join(base, 'app.json'), 'utf8'));
  if (m.id !== id) throw new Error(`apps/${id}/app.json has id "${m.id}"`);
  for (const k of ['name', 'version', 'entry']) if (!m[k]) throw new Error(`apps/${id}/app.json needs "${k}"`);
  const files = filesOf(base);
  for (const k of ['entry', 'icon', 'background', 'service']) if (m[k] && !files[m[k]]) throw new Error(`apps/${id}: ${k} ${m[k]} is missing`);
  index.apps.push({
    id, name: m.name, version: m.version, subtitle: m.subtitle || '', description: m.description || '', author: m.author || '',
    category: m.category || '', color: m.color || '', mode: m.mode || 'fullscreen', icon: m.icon || '',
    path: `apps/${id}/`, files,
  });
}

const apksFile = path.join(dir, 'apks.json');
if (fs.existsSync(apksFile)) {
  for (const a of JSON.parse(fs.readFileSync(apksFile, 'utf8'))) {
    for (const k of ['package', 'name', 'url', 'sha256']) if (!a[k]) throw new Error(`apks.json: ${a.package || a.name} needs "${k}"`);
    index.apks.push(a);
  }
}

const text = JSON.stringify(index, null, 2) + '\n';
const out = path.join(dir, 'index.json');
if (check) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (now !== text) { console.error(`${out} is out of date: run node tools/repoindex.mjs`); process.exit(1); }
  console.log('index.json is up to date');
} else {
  fs.writeFileSync(out, text);
  console.log(`${out}: ${index.apps.length} apps, ${index.apks.length} Android apps`);
}
