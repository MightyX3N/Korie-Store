// PlayTheater for PlayBigScreen. The app signs in to the server (so the device has the
// login cookie), then opens the server's own web app full screen. In the background it
// gives the home screen Continue watching and what's new, and answers searches.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UA = 'PlayBigScreen';

  // ---- The server -------------------------------------------------------------------------

  function normalize(addr) {
    addr = (addr || '').trim().replace(/\/+$/, '');
    if (!addr) return '';
    if (!/^https?:\/\//i.test(addr)) addr = 'http://' + addr;
    try {
      const u = new URL(addr);
      return u.origin + u.pathname.replace(/\/+$/, '');
    } catch { return ''; }
  }

  async function server() { return (await pbs.storage.get('server')) || ''; }

  async function api(path, opts) {
    const base = await server();
    if (!base) { const e = new Error('no server'); e.status = 0; throw e; }
    return pbs.json(base + path, opts);
  }

  async function me() {
    try { return await api('/api/me'); } catch (e) { if (e.status === 401) return null; throw e; }
  }

  // ---- Pictures (the server wants the login cookie, so they come through the device) ------

  const pics = new Map();
  async function picture(path, width) {
    if (!path) return '';
    const base = await server();
    const url = base + path + (path.includes('?') ? '&' : '?') + 'w=' + width;
    if (pics.has(url)) return pics.get(url);
    const job = pbs.http(url, { as: 'base64' }).then((r) => {
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
    if (!(await server())) return [];
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
    if (!(await server()) || !query) return [];
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
  function show(name) {
    current = name;
    for (const v of views) $('v-' + v).hidden = v !== name;
    requestAnimationFrame(() => pbs.nav.focusFirst($('v-' + name)));
  }
  function fail(id, text) { const el = $(id); el.textContent = text; el.hidden = !text; }

  async function openWeb() {
    const base = await server();
    show('opening');
    $('opening-text').textContent = 'Opening PlayTheater…';
    const path = pbs.open && pbs.open !== 'pbs:settings' ? '/item/' + encodeURIComponent(pbs.open) : '/';
    try {
      await pbs.openWeb(base + path, { userAgent: UA });
      // Back from PlayTheater: home rows may have changed (something was watched).
      pbs.refreshRows();
      pbs.close();
    } catch (e) {
      $('opening-text').textContent = 'PlayTheater couldn’t be opened: ' + e.message;
    }
  }

  async function start() {
    const base = await server();
    if (!base) return show('connect');
    let who;
    try { who = await me(); } catch (e) {
      $('connect-err').hidden = false;
      $('connect-err').textContent = `${base} isn’t answering. Is the server on?`;
      $('server').value = base;
      return show('connect');
    }
    if (!who) return signin();
    if (who.needsProfile) return chooseProfile(who);
    if (pbs.open === 'pbs:settings') return showSettings(who);
    return openWeb();
  }

  async function showSettings(who) {
    who = who || (await me());
    const base = await server();
    $('settings-who').textContent = who && !who.needsProfile ? `Signed in to ${base} as ${who.account.name}${who.profile && who.profile.name !== who.account.name ? ` (${who.profile.name})` : ''}.` : `Connected to ${base}.`;
    show('settings');
  }

  async function signin() {
    $('signin-where').textContent = 'On ' + (await server());
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
      await api('/api/profiles/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { id: p.id, pin } });
      pbs.refreshRows();
      start();
    } catch (e) {
      fail('profile-err', e.status === 403 || e.status === 401 ? 'That PIN isn’t right.' : 'Couldn’t choose the profile: ' + e.message);
    }
  }

  $('v-connect').onsubmit = async (e) => {
    e.preventDefault();
    const base = normalize($('server').value);
    if (!base) return fail('connect-err', 'Type the server’s address.');
    fail('connect-err', 'Connecting…');
    let st;
    try {
      st = await pbs.json(base + '/api/status');
    } catch (err) {
      return fail('connect-err', `No PlayTheater answered at ${base}. Check the address and that the server is on.`);
    }
    if (!st || typeof st.needsSetup !== 'boolean') return fail('connect-err', `${base} isn’t a PlayTheater server.`);
    if (st.needsSetup) return fail('connect-err', 'This server isn’t set up yet. Open it in a browser first and make the first account.');
    await pbs.storage.set('server', base);
    fail('connect-err', '');
    start();
  };

  $('v-signin').onsubmit = async (e) => {
    e.preventDefault();
    fail('signin-err', '');
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: { name: $('name').value.trim(), password: $('password').value, device: 'PlayBigScreen' } });
      $('password').value = '';
      pbs.refreshRows();
      start();
    } catch (err) {
      let msg = 'Couldn’t sign in.';
      try { msg = JSON.parse(err.body).error || msg; } catch {}
      fail('signin-err', msg.charAt(0).toUpperCase() + msg.slice(1));
    }
  };

  document.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'open') openWeb();
    if (act === 'settings') showSettings();
    if (act === 'change') { $('server').value = await server(); show('connect'); }
    if (act === 'switch') { try { await api('/api/profiles/leave', { method: 'POST' }); } catch {} start(); }
    if (act === 'signout') {
      try { await api('/api/logout', { method: 'POST' }); } catch {}
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
