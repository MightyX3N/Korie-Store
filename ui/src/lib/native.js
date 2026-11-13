// "The device": the Android app (window.PBSNative) or the browser host (/bridge). Both
// answer the same calls; see docs/BRIDGE.md.

const listeners = new Map();
let seq = 0;
const waiting = new Map();

const android = typeof window.PBSNative !== 'undefined';
export const platformKind = android ? 'android' : 'web';

if (android) {
  // The Android app answers by calling these.
  window.__pbs = {
    reply(id, json) {
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      const m = typeof json === 'string' ? JSON.parse(json) : json;
      if (m.error) w.reject(new Error(m.error)); else w.resolve(m.result);
    },
    event(name, data) { fire(name, data); },
  };
} else {
  try {
    const es = new EventSource('/events');
    es.onmessage = (e) => { try { const m = JSON.parse(e.data); fire(m.event, m.data); } catch {} };
  } catch {}
}

function fire(name, data) {
  for (const fn of listeners.get(name) || []) {
    try { fn(data); } catch (e) { console.error(e); }
  }
}

/** Calls the device. Resolves with the result or rejects with its error. */
export function call(method, args = {}) {
  if (android) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      // The token proves the call comes from the launcher page itself, not from an app's frame.
      window.PBSNative.call(window.__pbsToken || '', id, method, JSON.stringify(args));
    });
  }
  return fetch('/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) })
    .then((r) => r.json())
    .then((m) => { if (m.error) throw new Error(m.error); return m.result; });
}

/** Device events: back, home, resume, apps-changed. */
export function on(name, fn) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(fn);
  return () => listeners.get(name).delete(fn);
}

/** For pages and tests: pretend the device sent an event. */
export const emit = fire;
