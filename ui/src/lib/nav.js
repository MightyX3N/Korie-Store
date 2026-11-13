// Moving around with a remote or keyboard, the way Android TV moves: along a row one step
// at a time in order (nothing skipped), up and down to the next row and back to where you
// were in it, the top bar only once the page is back at its top, held keys at a steady
// pace. Overlays keep focus inside them; Back walks back.

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]';
const lastInRow = new WeakMap();

function visible(el) {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
}

/** The innermost open layer that holds focus (a menu, the quick settings...), or the page. */
export function scope() {
  const layers = [...document.querySelectorAll('[data-scope]')].filter(visible);
  return layers.length ? layers[layers.length - 1] : document.body;
}

function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => visible(el) && !el.closest('[data-nofocus]') && (root === document.body ? !el.closest('[data-scope]') : true));
}

export function focusFirst(root = scope()) {
  const el = root.querySelector('[data-autofocus]:not([disabled])') || focusables(root)[0];
  if (el) { el.focus({ preventScroll: true }); reveal(el); }
  return el;
}

/** Scrolls so `el` is in view: along its row, and down to its row (rows line up at the top
 *  of a [data-vscroll="rows"] list, the way TV launchers move). */
export function reveal(el, fast = false) {
  const behavior = fast || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const line = el.closest('[data-row]');
  const vs = el.closest('[data-vscroll]');
  if (!line && !vs) {
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior }); } catch {}
    return;
  }
  if (line && line.scrollWidth > line.clientWidth) {
    const r = el.getBoundingClientRect(), l = line.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(line).scrollPaddingLeft) || 0;
    let left = line.scrollLeft;
    if (r.left < l.left + pad) left += r.left - l.left - pad;
    else if (r.right > l.right - pad) left += r.right - l.right + pad;
    if (left !== line.scrollLeft) line.scrollTo({ left, behavior });
  }
  if (vs) {
    const v = vs.getBoundingClientRect();
    let top = vs.scrollTop;
    if (vs.dataset.vscroll === 'rows') {
      const row = el.closest('[data-vrow]') || el;
      top += row.getBoundingClientRect().top - v.top;
    } else {
      const r = el.getBoundingClientRect();
      const pad = 24;
      if (r.top < v.top + pad) top += r.top - v.top - pad;
      else if (r.bottom > v.bottom - pad) top += r.bottom - v.bottom + pad;
    }
    top = Math.max(0, Math.min(top, vs.scrollHeight - vs.clientHeight));
    if (Math.abs(top - vs.scrollTop) > 1) vs.scrollTo({ top, behavior });
  }
}

document.addEventListener('focusin', (e) => {
  const row = e.target.closest?.('[data-row]');
  if (row) lastInRow.set(row, e.target);
});

function nearest(cur, dir, list) {
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of list) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    let main, gap, off;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'left' ? (bx >= ax || b.right > a.left + a.width * 0.5) : (bx <= ax || b.left < a.right - a.width * 0.5)) continue;
      main = dir === 'left' ? a.left - b.right : b.left - a.right;
      gap = Math.max(0, b.top - a.bottom, a.top - b.bottom); off = Math.max(0, a.top - by, by - a.bottom);
    } else {
      if (dir === 'up' ? (by >= ay || b.bottom > a.top + a.height * 0.5) : (by <= ay || b.top < a.bottom - a.height * 0.5)) continue;
      main = dir === 'up' ? a.top - b.bottom : b.top - a.bottom;
      gap = Math.max(0, b.left - a.right, a.left - b.right); off = Math.max(0, a.left - bx, bx - a.right);
    }
    // In line first, then nearest, then most centred.
    const score = Math.max(main, 0) + gap * (dir === 'left' || dir === 'right' ? 4 : 1.5) + off * 0.3;
    if (score < bestScore) { bestScore = score; best = el; gapOf.set(el, gap); }
  }
  return best;
}
const gapOf = new WeakMap();

/** A row laid out side by side (not wrapped onto several lines). */
function sideBySide(items) {
  return items.length < 2 || Math.abs(items[1].getBoundingClientRect().top - items[0].getBoundingClientRect().top) < 8;
}

function enterRow(row, all) {
  const remembered = lastInRow.get(row);
  const current = row.querySelector('[data-current]');
  if (remembered && all.includes(remembered)) return remembered;
  if (current && all.includes(current)) return current;
  return null;
}

export function move(dir, fast = false) {
  const root = scope();
  const all = focusables(root);
  const cur = document.activeElement;
  if (!cur || cur === document.body || !all.includes(cur)) return !!focusFirst(root);

  const curRow = cur.closest('[data-row]');
  const sideways = dir === 'left' || dir === 'right';
  let best = null;

  if (curRow && sideways) {
    const mine = all.filter((el) => curRow.contains(el));
    if (sideBySide(mine)) {
      // One step along the row, in order.
      best = mine[mine.indexOf(cur) + (dir === 'right' ? 1 : -1)] || null;
      if (!best) {
        // At the end: only something right beside it (the status pill after the tabs).
        const beside = nearest(cur, dir, all.filter((el) => !curRow.contains(el)));
        if (beside && gapOf.get(beside) === 0) best = beside;
      }
      if (!best) return false;
    }
  }

  if (curRow && !sideways) {
    const mine = all.filter((el) => curRow.contains(el));
    if (!sideBySide(mine)) {
      // A column (the Store's or Settings' sections): one step up or down it.
      best = mine[mine.indexOf(cur) + (dir === 'down' ? 1 : -1)] || null;
    }
  }

  if (!best) {
    const others = curRow && !sideways ? all.filter((el) => !curRow.contains(el)) : all;
    // The top bar stays over the page, so it's always "just above": rows come first.
    const bar = document.querySelector('[data-nav-top]');
    const page = bar && !bar.contains(cur) ? others.filter((el) => !bar.contains(el)) : others;
    best = nearest(cur, dir, page) || (page !== others ? nearest(cur, dir, others) : null);
    if (!best) return false;
    // Up into the top bar: first scroll the page back to its top.
    if (dir === 'up' && bar && bar.contains(best) && !bar.contains(cur)) {
      const vs = cur.closest('[data-vscroll]');
      if (vs && vs.scrollTop > 4) { vs.scrollTo({ top: 0, behavior: fast ? 'auto' : 'smooth' }); return true; }
    }
  }

  // Coming into a row from outside: back to where you were in it, or its current item.
  const row = best.closest('[data-row]');
  if (row && row !== curRow) best = enterRow(row, all) || best;
  best.focus({ preventScroll: true });
  reveal(best, fast);
  return true;
}

// ---- Back ---------------------------------------------------------------------------------

const backStack = [];
let fallback = () => false;

/** Something open (a menu, a panel) takes Back first. Returns a function to remove it. */
export function onBack(fn) {
  backStack.push(fn);
  return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); };
}
export function setBackFallback(fn) { fallback = fn; }

export async function back() {
  for (let i = backStack.length - 1; i >= 0; i--) {
    if (await backStack[i]()) return true;
  }
  return fallback();
}

const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const REPEAT_MS = 130;
let lastMove = 0;
let enterDown = 0;
let longFired = false;

export function installKeys() {
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t && ((t.tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range'].includes(t.type)) || t.tagName === 'TEXTAREA');
    if (e.key === 'Escape' || e.key === 'GoBack' || e.key === 'BrowserBack' || (e.key === 'Backspace' && !typing)) {
      e.preventDefault();
      back();
      return;
    }
    if (e.key === 'ContextMenu' || e.key === 'Menu') {
      e.preventDefault();
      openMenuFor(document.activeElement);
      return;
    }
    // Still holding OK after the options opened: the key mustn't press anything in them.
    if (e.key === 'Enter' && longFired) { e.preventDefault(); return; }
    if (e.key === 'Enter' && !typing && t && t.closest?.('[data-hold]')) {
      // Holding OK on an app opens its options, like on most TV launchers; a short press
      // opens it (on release, so the two can be told apart).
      e.preventDefault();
      if (!e.repeat) { enterDown = Date.now(); longFired = false; }
      else if (!longFired && Date.now() - enterDown > 550) {
        longFired = true;
        openMenuFor(t);
      }
      return;
    }
    const dir = DIRS[e.key];
    if (!dir || e.defaultPrevented) return;
    if (typing && (dir === 'left' || dir === 'right')) {
      const len = (t.value || '').length;
      if (dir === 'left' && t.selectionStart > 0) return;
      if (dir === 'right' && t.selectionEnd < len) return;
    }
    if (t && t.type === 'range' && (dir === 'left' || dir === 'right')) return;
    // Held keys: one step at a steady pace, and the page jumps along with it.
    const now = performance.now();
    if (e.repeat && now - lastMove < REPEAT_MS) { e.preventDefault(); return; }
    lastMove = now;
    if (move(dir, e.repeat)) e.preventDefault();
    else if (t?.closest?.('[data-row]') || dir === 'left' || dir === 'right') e.preventDefault();
  });
  document.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' && longFired && !e.target.closest?.('[data-hold]')) { e.preventDefault(); longFired = false; enterDown = 0; return; }
    if (e.key !== 'Enter' || !enterDown) return;
    const t = e.target;
    const wasLong = longFired;
    enterDown = 0; longFired = false;
    if (t && t.closest?.('[data-hold]')) {
      e.preventDefault();
      if (!wasLong) t.click();
    }
  }, true);
}

function openMenuFor(el) {
  if (!el || el === document.body) return;
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
}
