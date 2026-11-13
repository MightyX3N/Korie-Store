// PlayBigScreen app SDK. A launcher app loads it with
//   <script src="/__pbs/sdk.js"></script>
// and gets `window.pbs`. The app runs in its own frame and origin; everything here goes
// through postMessage to the launcher, which checks where each message came from.
(function () {
  'use strict';
  if (window.pbs) return;

  const parentWin = window.parent !== window ? window.parent : null;
  const pending = new Map();
  const providers = {};
  const backHandlers = [];
  let seq = 0;

  const query = new URLSearchParams(location.search);
  const mode = query.get('pbs-mode') || 'fullscreen';

  function send(msg) {
    if (parentWin) parentWin.postMessage(Object.assign({ __pbs: 1 }, msg), '*');
  }

  function call(method, args) {
    if (!parentWin) return Promise.reject(new Error('Not running inside PlayBigScreen'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ id, method, args: args || {} });
    });
  }

  async function goBack() {
    for (let i = backHandlers.length - 1; i >= 0; i--) {
      try { if (await backHandlers[i]()) return true; } catch (e) { console.error(e); }
    }
    return false;
  }

  window.addEventListener('message', async (e) => {
    if (e.source !== parentWin) return;
    const m = e.data;
    if (!m || m.__pbs !== 1) return;
    if (m.id && pending.has(m.id) && !m.method) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
      return;
    }
    if (m.event === 'back') {
      const handled = await goBack();
      send({ event: 'back-result', handled });
      return;
    }
    if (m.provide) {
      // The launcher asks for something this app provides (rows, search).
      const fn = providers[m.provide];
      try {
        if (!fn) throw new Error('nothing provided for ' + m.provide);
        send({ reply: m.reply, result: await fn(m.args) });
      } catch (err) {
        send({ reply: m.reply, error: String(err && err.message || err) });
      }
      return;
    }
    if (m.event) window.dispatchEvent(new CustomEvent('pbs:' + m.event, { detail: m.data }));
  });

  // ---- Remote and keyboard ---------------------------------------------------------------
  // Arrow keys move between things you can press (spatial navigation). Escape and Backspace
  // (outside text fields) are Back. The Android Back button reaches the app as a 'back' event.

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  const nav = { enabled: true };

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }

  function scopeOf() {
    const scopes = [...document.querySelectorAll('[data-pbs-scope]')].filter(visible);
    return scopes.length ? scopes[scopes.length - 1] : document;
  }

  // Lines (data-pbs-line: a row of cards, a menu) go one step at a time in order, and Up or
  // Down into one goes back to where you were in it. Everything else goes by position.
  const lastInLine = new WeakMap();
  document.addEventListener('focusin', (e) => {
    const line = e.target.closest && e.target.closest('[data-pbs-line]');
    if (line) lastInLine.set(line, e.target);
  });
  const sideBySide = (items) => items.length < 2 || Math.abs(items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top) < 8;

  function move(dir, fast) {
    const scope = scopeOf();
    const all = [...scope.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !el.closest('[data-pbs-skip]'));
    const cur = document.activeElement;
    if (!cur || cur === document.body || !all.includes(cur)) {
      const first = scope.querySelector('[data-pbs-autofocus]') || all[0];
      if (first) first.focus();
      return !!first;
    }
    const behavior = fast ? 'auto' : 'smooth';
    const line = cur.closest('[data-pbs-line]');
    if (line) {
      const mine = all.filter((el) => line.contains(el));
      const along = sideBySide(mine) ? (dir === 'left' || dir === 'right') : (dir === 'up' || dir === 'down');
      if (along) {
        const next = mine[mine.indexOf(cur) + (dir === 'right' || dir === 'down' ? 1 : -1)];
        if (next) {
          next.focus({ preventScroll: true });
          next.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
          return true;
        }
        if (dir === 'right' || dir === 'down') return false;
      }
    }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of all) {
      if (line && line.contains(el)) continue;
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main, gap, off;
      if (dir === 'left' || dir === 'right') {
        if (dir === 'left' ? b.right > a.left + 1 : b.left < a.right - 1) continue;
        main = dir === 'left' ? a.left - b.right : b.left - a.right;
        gap = Math.max(0, b.top - a.bottom, a.top - b.bottom); off = Math.max(0, a.top - by, by - a.bottom);
      } else {
        if (dir === 'up' ? b.bottom > a.top + 1 : b.top < a.bottom - 1) continue;
        main = dir === 'up' ? a.top - b.bottom : b.top - a.bottom;
        gap = Math.max(0, b.left - a.right, a.left - b.right); off = Math.max(0, a.left - bx, bx - a.right);
      }
      // Things in line come first (no gap across), then the nearest, then the most centred.
      const score = Math.max(main, 0) + gap * 3 + off * 0.15;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) {
      const into = best.closest('[data-pbs-line]');
      if (into && into !== line) {
        const was = lastInLine.get(into);
        if (was && all.includes(was)) best = was;
      }
      best.focus({ preventScroll: true });
      best.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
    }
    return !!best;
  }

  let lastMove = 0;
  const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  document.addEventListener('keydown', async (e) => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range'].includes(t.type) || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing)) {
      e.preventDefault();
      if (!(await goBack())) call('close').catch(() => {});
      return;
    }
    if (!nav.enabled || e.defaultPrevented) return;
    const dir = DIRS[e.key];
    if (!dir) return;
    if (typing && (dir === 'left' || dir === 'right')) {
      const len = (t.value || '').length;
      if (dir === 'left' && t.selectionStart > 0) return;
      if (dir === 'right' && t.selectionEnd < len) return;
    }
    if (t && t.tagName === 'SELECT' && (dir === 'up' || dir === 'down')) return;
    // Held keys: one step at a steady pace.
    const now = performance.now();
    if (e.repeat && now - lastMove < 130) { e.preventDefault(); return; }
    lastMove = now;
    if (move(dir, e.repeat)) e.preventDefault();
  });

  // ---- The API ---------------------------------------------------------------------------

  const ready = call('hello').then((info) => {
    info = info || {};
    // Match the launcher's accent colour and panels.
    const html = document.documentElement;
    if (info.accent) html.style.setProperty('--pbs-accent', info.accent);
    if (info.look) html.dataset.look = info.look;
    return Object.assign(info, { mode, open: query.get('pbs-open') });
  });

  // Start with something selected, so the remote works straight away.
  function autofocus() {
    if (mode === 'service') return;
    const a = document.activeElement;
    if (a && a !== document.body && a !== document.documentElement) return;
    const el = document.querySelector('[data-pbs-autofocus]');
    if (el && visible(el)) el.focus();
  }
  window.addEventListener('focus', () => setTimeout(autofocus, 0));
  ready.then(() => setTimeout(autofocus, 0));

  window.pbs = {
    ready,
    mode,
    /** The item the launcher opened this app for (from a home row or search), or null. */
    open: query.get('pbs-open'),
    call,
    /** A web request made by the device, so other servers' CORS rules don't apply. */
    http(url, opts) {
      opts = opts || {};
      return call('http', { url: String(new URL(url, location.href)), method: opts.method || 'GET', headers: opts.headers || {}, body: opts.body == null ? null : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body), as: opts.as || 'text', timeout: opts.timeout || 0 });
    },
    /** Like http, but reads JSON and throws on an error status. */
    async json(url, opts) {
      const r = await window.pbs.http(url, opts);
      if (r.status < 200 || r.status >= 300) {
        const err = new Error('HTTP ' + r.status);
        err.status = r.status; err.body = r.body;
        throw err;
      }
      return r.body ? JSON.parse(r.body) : null;
    },
    /** Looks for servers on the home network: every address next to this device, on the
     *  given port(s), asked for `path`. Resolves [{ url, body }] for those answering 200. */
    scan(opts) {
      opts = opts || {};
      const ports = (opts.ports || [opts.port || 80]).map(Number).filter((p) => p > 0 && p < 65536).slice(0, 4);
      return call('scan', { ports, path: opts.path || '/', timeout: opts.timeout || 800 });
    },
    storage: {
      get: (key) => call('storage.get', { key }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.set', { key, value: null }),
    },
    /** Plays a video or stream in the device's own player. Resolves when it's closed. */
    play: (opts) => call('play', opts),
    /** Opens a web page full screen (its own browser view, sharing this device's cookies). */
    openWeb: (url, opts) => call('openWeb', Object.assign({ url: String(new URL(url, location.href)) }, opts || {})),
    close: () => call('close'),
    setTitle: (title) => call('setTitle', { title }),
    toast: (text) => call('toast', { text }),
    /** Asks the launcher to fetch this app's home rows again (after signing in, say). */
    refreshRows: () => call('refreshRows'),
    /** Back: return true from the handler when the app took care of it. */
    onBack(fn) { backHandlers.push(fn); return () => { const i = backHandlers.indexOf(fn); if (i >= 0) backHandlers.splice(i, 1); }; },
    /** Provide 'rows' (for the home screen) or 'search' (results for a query). */
    provide(name, fn) { providers[name] = fn; send({ event: 'provides', data: Object.keys(providers) }); },
    nav: {
      enable() { nav.enabled = true; },
      disable() { nav.enabled = false; },
      move,
      focusFirst(root) { const el = (root || document).querySelector('[data-pbs-autofocus]') || (root || document).querySelector(FOCUSABLE); if (el) el.focus(); return el; },
    },
  };
})();
