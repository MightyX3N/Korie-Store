// A stand-in for a RomM server, answering the API calls the RomM app makes (shapes taken
// from RomM's own API): node tests/fake-romm.mjs [port]
import http from 'node:http';
const PORT = Number(process.argv[2] || 8620);
const SESSION = 'sess-' + Math.random().toString(36).slice(2);
const TOKEN = 'rmm_' + 'ab'.repeat(32);
const platforms = [
  { id: 1, slug: 'nes', fs_slug: 'nes', name: 'Nintendo Entertainment System', display_name: 'NES', custom_name: null, rom_count: 3, url_logo: '' },
  { id: 2, slug: 'snes', fs_slug: 'snes', name: 'Super Nintendo', display_name: 'SNES', custom_name: null, rom_count: 2, url_logo: '' },
  { id: 3, slug: 'ps2', fs_slug: 'ps2', name: 'PlayStation 2', display_name: 'PlayStation 2', custom_name: null, rom_count: 1, url_logo: '' },
  { id: 4, slug: 'gb', fs_slug: 'gb', name: 'Game Boy', display_name: 'Game Boy', custom_name: null, rom_count: 0, url_logo: '' },
];
const names = [[1, 'Star Courier'], [1, 'Lantern Keep'], [1, 'Moss Valley Racing'], [2, 'Tidecaller'], [2, 'Copper Knights'], [3, 'Neon Harbour']];
const roms = names.map(([pid, name], i) => {
  const p = platforms.find((x) => x.id === pid);
  return { id: 100 + i, platform_id: pid, platform_slug: p.slug, platform_fs_slug: p.fs_slug, platform_display_name: p.display_name, fs_name: name.toLowerCase().replace(/ /g, '-') + '.zip', name, summary: `${name} is a made-up game for testing PlayBigScreen's RomM app.`, path_cover_small: `/assets/romm/resources/roms/${pid}/${100 + i}/cover/small.svg?ts=1`, path_cover_large: '', url_cover: '', last_played: i < 2 ? `2026-11-0${i + 1}T10:00:00Z` : null, favorite: i === 3 };
});
const hues = [12, 48, 140, 200, 260, 320];
function coverSvg(id) {
  const r = roms.find((x) => x.id === id) || { name: '?' };
  const h = hues[(id - 100) % hues.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400"><rect width="300" height="400" fill="hsl(${h} 45% 30%)"/><circle cx="150" cy="170" r="80" fill="hsl(${h} 60% 55%)"/><text x="150" y="340" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">${r.name}</text></svg>`;
}
const json = (res, code, body, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(body)); };
function authed(req) {
  const a = req.headers.authorization || '';
  if (a === 'Bearer ' + TOKEN) return true;
  return (req.headers.cookie || '').includes('romm_session=' + SESSION);
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;
  let body = '';
  for await (const c of req) body += c;
  if (p === '/api/heartbeat') return json(res, 200, { SYSTEM: { VERSION: '4.4.0' }, EMULATION: { DISABLE_EMULATOR_JS: false, EJS_CORES: { nes: ['fceumm'], snes: ['snes9x'] }, EJS_NIGHTLY_CORES: {} } });
  if (p === '/api/login' && req.method === 'POST') {
    const a = req.headers.authorization || '';
    const [user, pass] = Buffer.from(a.replace(/^Basic /, ''), 'base64').toString().split(':');
    if (user === 'player' && pass === 'retro-pass') return json(res, 200, {}, { 'Set-Cookie': `romm_session=${SESSION}; Path=/; HttpOnly; SameSite=Lax` });
    return json(res, 401, { detail: 'Invalid credentials' });
  }
  if (p === '/api/logout') return json(res, 200, {}, { 'Set-Cookie': 'romm_session=; Path=/; Max-Age=0' });
  if (p === '/api/client-tokens/exchange' && req.method === 'POST') {
    const { code } = JSON.parse(body || '{}');
    return code === '12345678' ? json(res, 200, { id: 9, name: 'tv', raw_token: TOKEN }) : json(res, 404, { detail: 'Pairing code not found or expired' });
  }
  const cover = /^\/assets\/romm\/resources\/roms\/\d+\/(\d+)\/cover\/(small|big)\.svg$/.exec(p);
  if (cover) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(coverSvg(Number(cover[1]))); }
  const play = /^\/rom\/(\d+)(\/ejs)?$/.exec(p);
  if (play) { const r = roms.find((x) => x.id === Number(play[1])); res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<!doctype html><title>RomM</title><body style="background:#000;color:#fff;font:24px sans-serif"><h1 id="playing">${play[2] ? 'Playing' : 'Details of'} ${r ? r.name : '?'}</h1></body>`); }
  if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  if (!authed(req)) return json(res, 403, { detail: 'Forbidden' });
  if (p === '/api/users/me') return json(res, 200, { id: 1, username: 'player', email: null, enabled: true, role: 'viewer' });
  if (p === '/api/platforms') return json(res, 200, platforms);
  const one = /^\/api\/roms\/(\d+)$/.exec(p);
  if (one) { const r = roms.find((x) => x.id === Number(one[1])); return r ? json(res, 200, r) : json(res, 404, { detail: 'not found' }); }
  if (p === '/api/roms') {
    const q = u.searchParams;
    let list = [...roms];
    const pids = q.getAll('platform_ids').map(Number);
    if (pids.length) list = list.filter((r) => pids.includes(r.platform_id));
    if (q.get('search_term')) list = list.filter((r) => r.name.toLowerCase().includes(q.get('search_term').toLowerCase()));
    if (q.get('last_played') === 'true') list = list.filter((r) => r.last_played);
    if (q.get('favorite') === 'true') list = list.filter((r) => r.favorite);
    const ob = q.get('order_by');
    if (ob === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    if (ob === 'id') list.sort((a, b) => a.id - b.id);
    if (ob === 'last_played') list.sort((a, b) => String(a.last_played).localeCompare(String(b.last_played)));
    if (q.get('order_dir') === 'desc') list.reverse();
    const limit = Number(q.get('limit') || 50), offset = Number(q.get('offset') || 0);
    return json(res, 200, { items: list.slice(offset, offset + limit), total: list.length, limit, offset });
  }
  json(res, 404, { detail: 'Not found' });
}).listen(PORT, () => console.log('fake RomM on ' + PORT));
