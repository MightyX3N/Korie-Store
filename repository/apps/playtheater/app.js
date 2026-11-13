// PlayTheater for PlayBigScreen. It finds PlayTheater servers on the home network, signs in
// (keeping the server's sign-in token, which works at any of its addresses), and opens the
// server's own web app full screen. The server also tells it its address from outside (its
// playit.gg tunnel), which is used when home doesn't answer, so nothing has to be changed
// away from home. In the background it gives the home screen Continue watching and what's
// new, and answers searches.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const PORT = 8484;

  // ---- The server -------------------------------------------------------------------------
  // Saved as { name, id, home, outside, token }.

  async function saved() {
    const s = await pbs.storage.get('server');
    if (typeof s === 'string') return s ? { home: s } : null; // from version 1.0
    return s || null;
  }
  const save = (s) => pbs.storage.set('server', s);

  function normalize(addr) {
    addr = (addr || '').trim().replace(/\/+$/, '');
    if (!addr) return [];
    if (/^https?:\/\//i.test(addr)) return [addr];
    const host = addr.split('/')[0];
    const isIp = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) || /^localhost(:\d+)?$/.test(host) || /\.local(:\d+)?$/.test(host);
    if (isIp) return ['http://' + (/:\d+$/.test(host) ? addr : addr.replace(host, host + ':' + PORT))];
    return ['https://' + addr, 'http://' + addr]; // playit's HTTPS addresses first
  }

  /** The server's /api/status, or null if no PlayTheater answers there. */
  async function status(url, timeout) {
    try {
      const r = await pbs.http(url + '/api/status', { timeout });
      if (r.status !== 200) return null;
      const st = JSON.parse(r.body);
      return st && typeof st.needsSetup === 'boolean' && st.version ? st : null;
    } catch { return null; }
  }

  /** Where to reach the server now: home if it answers, else from outside. */
  let reached = null;
  async function reach(s, fresh) {
    if (!s || !s.home) return null;
    if (reached && !fresh && (reached === s.home || reached === s.outside)) return reached;
    if (await status(s.home, 2500)) return (reached = s.home);
    if (s.outside && (await status(s.outside, 8000))) return (reached = s.outside);
    return null;
  }

  async function api(path, opts) {
    const s = await saved();
    const base = await reach(s);
    if (!base) { const e = new Error('unreachable'); e.status = 0; throw e; }
    opts = Object.assign({}, opts || {});
    opts.headers = Object.assign({}, opts.headers || {});
    if (s.token) opts.headers.Authorization = 'Bearer ' + s.token;
    if (opts.body && typeof opts.body !== 'string') opts.headers['Content-Type'] = 'application/json';
    return pbs.json(base + path, opts);
  }

  async function me() {
    const s = await saved();
    if (!s || !s.token) return null;
    try { return await api('/api/me'); } catch (e) { if (e.status === 401) return null; throw e; }
  }

  /** What the server says about where it can be reached (servers before 0.10 don't). */
  async function learnAddresses() {
    try {
      const a = await api('/api/addresses');
      const s = await saved();
      // A server without outside access (yet) says ''; an address learned before is kept.
      await save(Object.assign({}, s, { id: a.id || s.id || '', outside: (a.outside || '').replace(/\/+$/, '') || s.outside || '' }));
    } catch {}
  }

  // ---- Pictures (they need the sign-in, so they come through the device) -------------------

  const pics = new Map();
  async function picture(path, width) {
    if (!path) return '';
    const s = await saved();
    const base = await reach(s);
    if (!base) return '';
    const url = base + path + (path.includes('?') ? '&' : '?') + 'w=' + width;
    if (pics.has(url)) return pics.get(url);
    const job = pbs.http(url, { as: 'base64', headers: s.token ? { Authorization: 'Bearer ' + s.token } : {} }).then((r) => {
      if (r.status !== 200 || !r.body) return '';
      return 'data:' + (r.headers['content-type'] || 'image/jpeg').split(';')[0] + ';base64,' + r.body;
    }).catch(() => '');
    pics.set(url, job);
    return job;
  }

  async function inTurns(list, n, fn) {
    const out = new Array(list.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
      while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
    }));
    return out;
  }

  function subtitleOf(it) {
    if (it.kind === 'episode') return `S${it.seasonNumber} E${it.episodeNumber} · ${it.title}`;
    if (it.kind === 'album' && it.artist) return it.artist;
    if (it.kind === 'book' && it.author) return it.author;
    return [it.year, it.genres && it.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ');
  }

  // ---- In the background: rows and search --------------------------------------------------

  async function rows() {
    const s = await saved();
    if (!s || !s.token) return [];
    reached = null; // home or away may have changed since last time
    let home;
    try { home = await api('/api/home'); } catch { return []; }
    const out = [];
    const cont = (home.rows || []).find((r) => r.kind === 'continue');
    if (cont && cont.items && cont.items.length) {
      const items = await inTurns(cont.items.slice(0, 12), 4, async (it) => ({
        id: it.id,
        title: it.seriesTitle || it.title,
        subtitle: subtitleOf(it),
        image: await picture(it.thumb || it.backdrop || it.poster, 480),
        backdrop: await picture(it.backdrop || it.thumb, 1280),
        progress: it.progress && it.progress.duration ? it.progress.position / it.progress.duration : null,
      }));
      out.push({ id: 'continue', title: cont.title || 'Continue watching', shape: 'wide', items });
    }
    for (const r of (home.rows || []).filter((x) => x.kind !== 'continue').slice(0, 3)) {
      if (!r.items || !r.items.length) continue;
      const square = r.items.some((it) => it.kind === 'album' || it.kind === 'book');
      const items = await inTurns(r.items.slice(0, 16), 4, async (it) => ({
        id: it.id,
        title: it.title,
        subtitle: subtitleOf(it),
        image: await picture(square ? it.poster : it.backdrop || it.thumb || it.poster, square ? 300 : 480),
        backdrop: square ? '' : await picture(it.backdrop, 1280),
      }));
      out.push({ id: 'lib-' + (r.id || out.length), title: r.title, shape: square ? 'square' : 'wide', items });
    }
    return out;
  }

  async function search({ query }) {
    const s = await saved();
    if (!s || !s.token || !query) return [];
    let res;
    try { res = await api('/api/search?q=' + encodeURIComponent(query)); } catch { return []; }
    return inTurns((res.local || []).slice(0, 14), 4, async (it) => ({
      id: it.id,
      title: it.title,
      subtitle: subtitleOf(it),
      image: await picture(it.poster || it.thumb, 300),
    }));
  }

  if (pbs.mode === 'service') {
    pbs.provide('search', search);
    pbs.provide('rows', rows);
    return;
  }

  // ---- On screen ---------------------------------------------------------------------------

  const views = ['connect', 'signin', 'profile', 'settings', 'opening'];
  let current = '';
  function show(name, focus) {
    current = name;
    for (const v of views) $('v-' + v).hidden = v !== name;
    requestAnimationFrame(() => (focus ? focus.focus() : pbs.nav.focusFirst($('v-' + name))));
  }
  function fail(id, text) { const el = $(id); el.textContent = text || ''; el.hidden = !text; }

  async function openWeb() {
    const s = await saved();
    show('opening');
    $('opening-text').textContent = 'Opening PlayTheater…';
    const base = await reach(s, true);
    if (!base) { $('opening-text').textContent = `PlayTheater doesn’t answer at ${s.home}${s.outside ? ' or ' + s.outside : ''}. Is the server on?`; return; }
    const path = pbs.open && pbs.open !== 'pbs:settings' ? '/item/' + encodeURIComponent(pbs.open) : '/';
    // A sign-in link makes the web app signed in at whichever address is used.
    let url = base + path;
    try {
      const l = await pbs.json(base + '/api/session/link', { method: 'POST', headers: { Authorization: 'Bearer ' + s.token } });
      if (l && l.code) url = base + '/api/session/link/' + l.code + '?to=' + encodeURIComponent(path);
    } catch {}
    try {
      await pbs.openWeb(url);
      pbs.refreshRows(); // something may have been watched
      pbs.close();
    } catch (e) {
      $('opening-text').textContent = 'PlayTheater couldn’t be opened: ' + e.message;
    }
  }

  async function start() {
    const s = await saved();
    if (!s || !s.home) return connect();
    const base = await reach(s, true);
    if (!base) {
      $('server').value = s.home.replace(/^http:\/\//, '');
      fail('connect-err', `${s.home}${s.outside ? ' and ' + s.outside : ''} didn’t answer. Is the server on?`);
      return connect();
    }
    let who;
    try { who = await me(); } catch { who = null; }
    if (!who) return signin();
    if (who.needsProfile) return chooseProfile(who);
    learnAddresses();
    if (pbs.open === 'pbs:settings') return showSettings(who);
    return openWeb();
  }

  // Servers found on this network.
  let looking = 0;
  async function look() {
    const mine = ++looking;
    const box = $('found');
    box.textContent = '';
    $('found-state').textContent = 'Looking for PlayTheater on this network…';
    let found = [];
    try { found = await pbs.scan({ port: PORT, path: '/api/status' }); } catch {}
    if (mine !== looking) return;
    const servers = [];
    for (const f of found) {
      try { const st = JSON.parse(f.body); if (typeof st.needsSetup === 'boolean' && st.version) servers.push({ url: f.url, st }); } catch {}
    }
    // One button per server, even when it answers on several addresses.
    const seen = new Set();
    for (const { url, st } of servers) {
      const key = st.id || url;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'server';
      b.dataset.url = url;
      const n = document.createElement('b'); n.textContent = st.name || 'PlayTheater';
      const a = document.createElement('span'); a.textContent = url.replace(/^http:\/\//, '') + ' · ' + st.version;
      b.append(n, a);
      b.onclick = () => use(url, st);
      box.append(b);
    }
    $('found-state').textContent = seen.size ? 'On this network:' : 'No PlayTheater answered on this network (port ' + PORT + '). Type its address below.';
    // Nothing typed yet: start on the first server found.
    const a = document.activeElement;
    if (current === 'connect' && seen.size && (!a || a === document.body || (a === $('server') && !$('server').value))) box.firstChild.focus();
  }

  function connect() {
    show('connect', $('server').value ? $('server') : null);
    look();
  }

  async function use(url, st) {
    if (st.needsSetup) return fail('connect-err', 'This server isn’t set up yet. Open it in a browser first and make the first account.');
    const old = await saved();
    const same = old && (old.home === url || (st.id && old.id === st.id));
    await save(same ? Object.assign({}, old, { home: url, name: st.name, id: st.id || old.id || '' }) : { home: url, name: st.name || 'PlayTheater', id: st.id || '', outside: '', token: '' });
    reached = null;
    fail('connect-err', '');
    start();
  }

  async function showSettings(who) {
    const s = await saved();
    who = who || (await me().catch(() => null));
    const base = await reach(s);
    $('settings-who').textContent = who && !who.needsProfile ? `Signed in as ${who.account.name}${who.profile && who.profile.name !== who.account.name ? ` (${who.profile.name})` : ''}.` : 'Not signed in.';
    $('settings-where').textContent = `At home: ${s.home}. From outside: ${s.outside || 'not set up on the server (Settings → Server → Outside access)'}.` + (base && base === s.outside ? ' Using the address from outside now.' : '');
    show('settings');
  }

  async function signin() {
    const s = await saved();
    const base = await reach(s);
    $('signin-where').textContent = `On ${s.name || 'PlayTheater'} (${base || s.home})`;
    fail('signin-err', '');
    show('signin');
  }

  function chooseProfile(who) {
    const box = $('profiles');
    box.textContent = '';
    for (const p of who.profiles || []) {
      const b = document.createElement('button');
      b.className = 'profile';
      if (p.color) b.style.setProperty('--c', p.color);
      const dot = document.createElement('span'); dot.textContent = (p.name || '?').slice(0, 1).toUpperCase();
      const name = document.createElement('span'); name.textContent = p.name;
      b.append(dot, name);
      b.onclick = () => (p.hasPin ? askPin(p) : pick(p, ''));
      box.append(b);
    }
    $('pin-form').hidden = true;
    fail('profile-err', '');
    show('profile');
  }

  let pinFor = null;
  function askPin(p) {
    pinFor = p;
    $('pin-who').textContent = p.name;
    $('pin-form').hidden = false;
    $('pin').value = '';
    $('pin').focus();
  }
  $('pin-form').onsubmit = (e) => { e.preventDefault(); if (pinFor) pick(pinFor, $('pin').value); };

  async function pick(p, pin) {
    try {
      await api('/api/profiles/select', { method: 'POST', body: { id: p.id, pin } });
      pbs.refreshRows();
      start();
    } catch (e) {
      fail('profile-err', e.status === 403 || e.status === 401 ? 'That PIN isn’t right.' : 'Couldn’t choose the profile: ' + e.message);
    }
  }

  $('v-connect').onsubmit = async (e) => {
    e.preventDefault();
    const tries = normalize($('server').value);
    if (!tries.length) return fail('connect-err', 'Type the server’s address, or choose one found on this network.');
    fail('connect-err', 'Connecting…');
    for (const url of tries) {
      const st = await status(url, 6000);
      if (st) return use(url.replace(/\/+$/, ''), st);
    }
    fail('connect-err', `No PlayTheater answered at ${$('server').value.trim()}. Check the address and that the server is on.`);
  };

  $('v-signin').onsubmit = async (e) => {
    e.preventDefault();
    fail('signin-err', '');
    const s = await saved();
    const base = await reach(s);
    try {
      const r = await pbs.json(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { name: $('name').value.trim(), password: $('password').value, device: 'PlayBigScreen' } });
      $('password').value = '';
      if (!r || !r.token) throw new Error('the server didn’t give a sign-in');
      await save(Object.assign({}, s, { token: r.token }));
      await learnAddresses();
      pbs.refreshRows();
      start();
    } catch (err) {
      let msg = err.message || 'Couldn’t sign in.';
      try { msg = JSON.parse(err.body).error || msg; } catch {}
      fail('signin-err', msg.charAt(0).toUpperCase() + msg.slice(1));
    }
  };

  document.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'open') openWeb();
    if (act === 'settings') showSettings();
    if (act === 'look') look();
    if (act === 'change') { const s = await saved(); $('server').value = s && s.home ? s.home.replace(/^http:\/\//, '') : ''; connect(); }
    if (act === 'switch') { try { await api('/api/profiles/leave', { method: 'POST' }); } catch {} start(); }
    if (act === 'signout') {
      try { await api('/api/logout', { method: 'POST' }); } catch {}
      const s = await saved();
      await save(Object.assign({}, s, { token: '' }));
      pbs.refreshRows();
      signin();
    }
  });

  // Back on a form goes back a step instead of closing.
  pbs.onBack(() => {
    if (current === 'profile' && !$('pin-form').hidden) { $('pin-form').hidden = true; return true; }
    return false;
  });

  pbs.ready.then(start);
})();
