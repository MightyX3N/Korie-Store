// RomM for PlayBigScreen: the games on a RomM server, browsed in the launcher's style and
// played with RomM's own in-browser emulator (opened full screen). It talks to RomM's API
// with the device's sign-in cookie (password) or a client token (pairing code).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PAGE = 60;

  // ---- The server -------------------------------------------------------------------------

  const auth = { server: '', token: '' };
  async function loadAuth() {
    auth.server = (await pbs.storage.get('server')) || '';
    auth.token = (await pbs.storage.get('token')) || '';
  }

  function normalize(addr) {
    addr = (addr || '').trim().replace(/\/+$/, '');
    if (!addr) return '';
    if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
    try { const u = new URL(addr); return u.origin + u.pathname.replace(/\/+$/, ''); } catch { return ''; }
  }

  function api(path, opts) {
    opts = Object.assign({}, opts || {});
    opts.headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (auth.token && !opts.headers.Authorization) opts.headers.Authorization = 'Bearer ' + auth.token;
    return pbs.json(auth.server + '/api' + path, opts);
  }

  function qs(o) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) {
      if (v == null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => p.append(k, x)); else p.set(k, v);
    }
    return p.toString();
  }

  const LIGHT = { with_char_index: false, with_filter_values: false, with_rom_id_index: false };

  function cover(rom) {
    const p = rom.path_cover_small || rom.path_cover_large;
    if (p) return /^https?:/.test(p) ? p : auth.server + p;
    return rom.url_cover || '';
  }

  async function me() {
    try { return await api('/users/me'); } catch (e) { if (e.status === 401 || e.status === 403) return null; throw e; }
  }

  // ---- In the background: rows and search --------------------------------------------------

  const asItem = (prefix) => (r) => ({ id: prefix + r.id, title: r.name || r.fs_name, subtitle: r.platform_display_name || '', image: cover(r) });

  async function rows() {
    await loadAuth();
    if (!auth.server) return [];
    const out = [];
    try {
      const played = await api('/roms?' + qs({ ...LIGHT, order_by: 'last_played', order_dir: 'desc', last_played: true, limit: 15, with_total: false }));
      if (played.items && played.items.length) out.push({ id: 'continue', title: 'Continue playing', shape: 'poster', items: played.items.map(asItem('play:')) });
    } catch {}
    try {
      const recent = await api('/roms?' + qs({ ...LIGHT, order_by: 'id', order_dir: 'desc', limit: 15, with_total: false }));
      if (recent.items && recent.items.length) out.push({ id: 'recent', title: 'New games', shape: 'poster', items: recent.items.map(asItem('')) });
    } catch {}
    return out;
  }

  async function search({ query }) {
    await loadAuth();
    if (!auth.server || !query) return [];
    try {
      const r = await api('/roms?' + qs({ ...LIGHT, search_term: query, limit: 14, with_total: false }));
      return (r.items || []).map(asItem(''));
    } catch { return []; }
  }

  if (pbs.mode === 'service') {
    pbs.provide('rows', rows);
    pbs.provide('search', search);
    return;
  }

  // ---- Setup -------------------------------------------------------------------------------

  function fail(id, text) { const el = $(id); el.textContent = text || ''; el.hidden = !text; }

  // RomM servers on this network (RomM's usual ports).
  let looking = 0;
  async function look() {
    const mine = ++looking;
    $('found').textContent = '';
    $('found-state').textContent = 'Looking for RomM on this network…';
    let found = [];
    try { found = await pbs.scan({ ports: [8080, 80, 8443], path: '/api/heartbeat' }); } catch {}
    if (mine !== looking) return;
    let n = 0;
    for (const f of found) {
      let hb;
      try { hb = JSON.parse(f.body); } catch { continue; }
      if (!hb || !hb.SYSTEM) continue;
      n++;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'server';
      const t = document.createElement('b'); t.textContent = 'RomM ' + (hb.SYSTEM.VERSION || '');
      const a = document.createElement('span'); a.textContent = f.url.replace(/^http:\/\//, '');
      b.append(t, a);
      b.onclick = () => { $('server').value = f.url; $('f-server').requestSubmit(); };
      $('found').append(b);
    }
    $('found-state').textContent = n ? 'On this network:' : 'No RomM answered on this network. Type its address below.';
    const a = document.activeElement;
    if (n && !$('f-server').hidden && (!a || a === document.body || (a === $('server') && !$('server').value))) $('found').firstChild.focus();
  }

  function setupForm(which) {
    $('v-library').hidden = true;
    $('v-setup').hidden = false;
    for (const f of ['f-server', 'f-login', 'f-code']) $(f).hidden = f !== which;
    requestAnimationFrame(() => pbs.nav.focusFirst($(which)));
    if (which === 'f-server') look();
  }

  $('f-server').onsubmit = async (e) => {
    e.preventDefault();
    const base = normalize($('server').value);
    if (!base) return fail('server-err', 'Type the server’s address.');
    fail('server-err', 'Connecting…');
    try {
      const hb = await pbs.json(base + '/api/heartbeat');
      if (!hb || !hb.SYSTEM) throw new Error('not RomM');
    } catch {
      return fail('server-err', `No RomM answered at ${base}. Check the address and that the server is on.`);
    }
    auth.server = base; auth.token = '';
    await pbs.storage.set('server', base);
    await pbs.storage.remove('token');
    fail('server-err', '');
    $('login-where').textContent = 'On ' + base;
    setupForm('f-login');
  };

  $('f-login').onsubmit = async (e) => {
    e.preventDefault();
    fail('login-err', '');
    const basic = btoa(unescape(encodeURIComponent($('user').value.trim() + ':' + $('pass').value)));
    try {
      await pbs.json(auth.server + '/api/login', { method: 'POST', headers: { Authorization: 'Basic ' + basic } });
      $('pass').value = '';
      auth.token = '';
      await pbs.storage.remove('token');
      pbs.refreshRows();
      start();
    } catch (err) {
      fail('login-err', err.status === 401 || err.status === 403 ? 'That username and password don’t match.' : 'Couldn’t sign in: ' + err.message);
    }
  };

  $('f-code').onsubmit = async (e) => {
    e.preventDefault();
    fail('code-err', '');
    const code = $('code').value.replace(/\D/g, '');
    if (code.length !== 8) return fail('code-err', 'The code has 8 digits.');
    try {
      const t = await pbs.json(auth.server + '/api/client-tokens/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { code } });
      if (!t || !t.raw_token) throw new Error('no token came back');
      auth.token = t.raw_token;
      await pbs.storage.set('token', t.raw_token);
      pbs.refreshRows();
      start();
    } catch (err) {
      fail('code-err', err.status === 404 || err.status === 400 || err.status === 410 ? 'That code isn’t right or has run out. Codes last 5 minutes.' : 'Couldn’t pair: ' + err.message);
    }
  };

  // ---- The library -------------------------------------------------------------------------

  const lib = { platforms: [], cores: {}, emulator: true, list: 'all', platform: null, items: [], total: 0, loading: false, query: '' };

  function platformName(p) { return p.display_name || p.custom_name || p.name || p.slug; }

  async function loadLibrary() {
    $('v-setup').hidden = true;
    $('v-library').hidden = false;
    $('where').textContent = 'RomM · ' + auth.server.replace(/^https?:\/\//, '');
    try {
      const hb = await pbs.json(auth.server + '/api/heartbeat');
      const em = hb.EMULATION || {};
      lib.emulator = !em.DISABLE_EMULATOR_JS;
      lib.cores = em.EJS_CORES || {};
    } catch {}
    try {
      const plats = await api('/platforms');
      lib.platforms = (plats || []).filter((p) => p.rom_count > 0).sort((a, b) => platformName(a).localeCompare(platformName(b)));
    } catch (e) {
      lib.platforms = [];
    }
    drawPlatforms();
    await showList('all');
    const first = $('platforms').querySelector('.on') || $('platforms').querySelector('button');
    first && first.focus();
  }

  function drawPlatforms() {
    const nav = $('platforms');
    nav.textContent = '';
    const add = (key, label, count) => {
      const b = document.createElement('button');
      b.className = 'plat-btn';
      b.dataset.list = key;
      const s = document.createElement('span'); s.textContent = label;
      b.append(s);
      if (count != null) { const c = document.createElement('small'); c.textContent = count; b.append(c); }
      b.onclick = () => showList(key);
      nav.append(b);
    };
    add('all', 'All games');
    add('played', 'Continue playing');
    add('recent', 'New games');
    add('favorites', 'Favourites');
    const sep = document.createElement('div'); sep.className = 'plat-sep'; nav.append(sep);
    for (const p of lib.platforms) add('p:' + p.id, platformName(p), p.rom_count);
  }

  function paramsFor(list, offset) {
    const base = { ...LIGHT, limit: PAGE, offset, with_total: true };
    if (list === 'search') return { ...base, search_term: lib.query };
    if (list === 'played') return { ...base, order_by: 'last_played', order_dir: 'desc', last_played: true };
    if (list === 'recent') return { ...base, order_by: 'id', order_dir: 'desc', limit: 30 };
    if (list === 'favorites') return { ...base, favorite: true, order_by: 'name', order_dir: 'asc' };
    if (list.startsWith('p:')) return { ...base, platform_ids: [list.slice(2)], order_by: 'name', order_dir: 'asc' };
    return { ...base, order_by: 'name', order_dir: 'asc' };
  }

  async function showList(list) {
    lib.list = list;
    lib.items = []; lib.total = 0;
    for (const b of $('platforms').querySelectorAll('.plat-btn')) b.classList.toggle('on', b.dataset.list === list);
    const titles = { all: 'All games', played: 'Continue playing', recent: 'New games', favorites: 'Favourites', search: 'Search' };
    const p = list.startsWith('p:') && lib.platforms.find((x) => 'p:' + x.id === list);
    $('list-title').textContent = p ? platformName(p) : titles[list];
    $('search-box').hidden = list !== 'search';
    $('grid').textContent = '';
    $('list-count').textContent = '';
    if (list === 'search' && lib.query.length < 2) { empty('Type at least two letters.'); return; }
    await more();
  }

  function empty(text) { $('empty').textContent = text || ''; $('empty').hidden = !text; }

  async function more() {
    if (lib.loading) return;
    if (lib.items.length && lib.items.length >= lib.total) return;
    lib.loading = true;
    const list = lib.list;
    try {
      const r = await api('/roms?' + qs(paramsFor(list, lib.items.length)));
      if (list !== lib.list) return;
      const items = r.items || [];
      lib.total = list === 'recent' ? items.length : (r.total ?? lib.items.length + items.length);
      lib.items.push(...items);
      $('list-count').textContent = lib.total ? `${lib.total} ${lib.total === 1 ? 'game' : 'games'}` : '';
      empty(lib.items.length ? '' : list === 'played' ? 'Games you play show up here.' : list === 'favorites' ? 'Mark games as favourites in RomM and they show up here.' : 'No games here.');
      drawGames(items);
    } catch (e) {
      empty('RomM didn’t answer: ' + e.message);
    } finally {
      lib.loading = false;
    }
  }

  function drawGames(items) {
    const grid = $('grid');
    for (const rom of items) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      const b = document.createElement('button');
      b.className = 'cover-btn pbs-card';
      b.setAttribute('aria-label', rom.name || rom.fs_name);
      const src = cover(rom);
      if (src) { const img = document.createElement('img'); img.loading = 'lazy'; img.alt = ''; img.src = src; b.append(img); }
      else { const n = document.createElement('span'); n.className = 'none'; n.textContent = rom.name || rom.fs_name; b.append(n); }
      b.onclick = () => openGame(rom);
      // Getting near the end loads the next page.
      b.onfocus = () => { if (lib.items.indexOf(rom) > lib.items.length - 12) more(); };
      const t = document.createElement('span'); t.className = 't'; t.textContent = rom.name || rom.fs_name;
      cell.append(b, t);
      grid.append(cell);
    }
  }

  $('games-wrap').addEventListener('scroll', (e) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) more();
  });

  let searchTimer;
  $('q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { lib.query = $('q').value.trim(); showList('search'); }, 350);
  });

  // ---- One game ----------------------------------------------------------------------------

  let game = null;
  let returnTo = null;

  function slugOf(rom) {
    const p = lib.platforms.find((x) => x.id === rom.platform_id);
    return ((p && (p.slug || p.fs_slug)) || rom.platform_slug || rom.platform_fs_slug || '').toLowerCase();
  }

  function playUrl(rom) {
    const slug = slugOf(rom);
    if (lib.emulator && lib.cores[slug] && lib.cores[slug].length) return auth.server + '/rom/' + rom.id + '/ejs';
    return null;
  }

  function openGame(rom) {
    game = rom;
    returnTo = document.activeElement;
    const c = $('g-cover'); c.textContent = '';
    const src = cover(rom);
    if (src) { const img = document.createElement('img'); img.src = src.replace('/cover/small', '/cover/big'); img.onerror = () => { img.onerror = null; img.src = src; }; img.alt = ''; c.append(img); }
    $('g-plat').textContent = rom.platform_display_name || '';
    $('g-name').textContent = rom.name || rom.fs_name;
    $('g-sum').textContent = rom.summary || '';
    const url = playUrl(rom);
    $('g-play').hidden = !url;
    $('g-note').textContent = url ? '' : 'RomM can’t play this platform in the browser. Open it in RomM to download it or see what else it offers.';
    $('veil').hidden = false;
    $('game').hidden = false;
    requestAnimationFrame(() => pbs.nav.focusFirst($('game')));
  }

  function closeGame() {
    $('veil').hidden = true;
    $('game').hidden = true;
    game = null;
    if (returnTo && returnTo.isConnected) returnTo.focus();
  }

  async function web(url) {
    try { await pbs.openWeb(url); } catch (e) { $('g-note').textContent = 'Couldn’t open it: ' + e.message; }
    pbs.refreshRows();
  }

  async function openById(id, play) {
    try {
      const rom = await api('/roms/' + encodeURIComponent(id));
      if (play && playUrl(rom)) { await web(playUrl(rom)); return; }
      openGame(rom);
    } catch (e) { /* gone: just show the library */ }
  }

  // ---- Settings ----------------------------------------------------------------------------

  async function showSettings() {
    let who = null;
    try { who = await me(); } catch {}
    $('s-who').textContent = who ? `Signed in to ${auth.server} as ${who.username}${auth.token ? ' with a pairing code' : ''}.` : `Connected to ${auth.server}.`;
    returnTo = document.activeElement;
    $('veil').hidden = false;
    $('settings').hidden = false;
    requestAnimationFrame(() => pbs.nav.focusFirst($('settings')));
  }
  function closeSettings() {
    $('veil').hidden = true;
    $('settings').hidden = true;
    if (returnTo && returnTo.isConnected) returnTo.focus();
  }

  document.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'play' && game) web(playUrl(game));
    if (act === 'details' && game) web(auth.server + '/rom/' + game.id);
    if (act === 'close-game') closeGame();
    if (act === 'search') { lib.query = $('q').value.trim(); await showList('search'); $('q').focus(); }
    if (act === 'settings') showSettings();
    if (act === 'close-settings') closeSettings();
    if (act === 'use-code') setupForm('f-code');
    if (act === 'use-login') setupForm('f-login');
    if (act === 'change') { closeSettings(); $('server').value = auth.server; setupForm('f-server'); }
    if (act === 'signout') {
      if (!auth.token) { try { await api('/logout', { method: 'POST' }); } catch {} }
      auth.token = '';
      await pbs.storage.remove('token');
      pbs.refreshRows();
      closeSettings();
      $('login-where').textContent = 'On ' + auth.server;
      setupForm('f-login');
    }
  });
  $('veil').onclick = () => { if (!$('game').hidden) closeGame(); else closeSettings(); };

  pbs.onBack(() => {
    if (!$('game').hidden) { closeGame(); return true; }
    if (!$('settings').hidden) { closeSettings(); return true; }
    if (!$('v-setup').hidden && !$('f-code').hidden) { setupForm('f-login'); return true; }
    if (!$('v-library').hidden && lib.list === 'search') { showList('all'); return true; }
    return false;
  });

  async function start() {
    await loadAuth();
    if (!auth.server) return setupForm('f-server');
    let who;
    try { who = await me(); } catch {
      $('server').value = auth.server;
      fail('server-err', `${auth.server} isn’t answering. Is RomM on?`);
      return setupForm('f-server');
    }
    if (!who) { $('login-where').textContent = 'On ' + auth.server; return setupForm('f-login'); }
    await loadLibrary();
    if (pbs.open === 'pbs:settings') showSettings();
    else if (pbs.open) {
      const play = pbs.open.startsWith('play:');
      openById(play ? pbs.open.slice(5) : pbs.open, play);
    }
  }

  pbs.ready.then(start);
})();
