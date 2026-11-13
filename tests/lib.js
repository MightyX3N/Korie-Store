// Shared bits for the browser tests (run by tests/run.sh after tests/start.sh).
const { chromium } = require('playwright');

const HOST = 'http://localhost:8600';
const REPO = 'http://localhost:8611/index.json';
const TEST_REPO = 'http://localhost:8612/index.json';

let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('  ok  ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
}
function done() {
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

async function bridge(method, args = {}) {
  const r = await fetch(HOST + '/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, args }) });
  return (await r.json()).result;
}
async function calls(method) {
  const all = await (await fetch(HOST + '/__test/log')).json();
  return method ? all.filter((c) => c.method === method) : all;
}
async function clearLog() { await fetch(HOST + '/__test/clear'); }
async function emit(event, data = null) { await fetch(`${HOST}/__test/emit?event=${event}&data=${encodeURIComponent(JSON.stringify(data))}`); }

/** A fresh browser on the launcher. `settings` go into its saved settings first. */
async function open({ settings = {}, viewport = { width: 1920, height: 1080 }, mobile = false, storage = {}, removeApps = true } = {}) {
  if (removeApps) for (const a of (await bridge('apps.list')) || []) await bridge('apps.remove', { id: a.id });
  await clearLog();
  const browser = await chromium.launch();
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport });
  await ctx.addInitScript(([s, st]) => {
    if (location.port !== '8600' || location.hostname !== 'localhost') return;
    if (!sessionStorage.getItem('pbs-test-init')) {
      sessionStorage.setItem('pbs-test-init', '1');
      localStorage.clear();
      localStorage.setItem('pbs-settings', JSON.stringify(s));
      for (const [k, v] of Object.entries(st)) localStorage.setItem(k, JSON.stringify(v));
    }
  }, [{ repos: [REPO], ...settings }, storage]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(HOST + '/');
  await page.waitForSelector('[data-pt=tab-home]');
  await page.waitForTimeout(600);
  return { browser, ctx, page, errors };
}

const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a ? (a.dataset.key || a.dataset.pt || a.getAttribute('aria-label') || a.textContent.trim()).slice(0, 60) : '';
});

async function installFromStore(page, key) {
  await page.click('[data-pt=tab-store]');
  await page.waitForSelector(`[data-pt=store-entry][data-key="${key}"]`);
  await page.click(`[data-pt=store-entry][data-key="${key}"]`);
  await page.click('[data-pt=install]');
  await page.waitForSelector('[data-pt=open]', { timeout: 10000 });
  await page.keyboard.press('Escape');
}

module.exports = { HOST, REPO, TEST_REPO, check, done, bridge, calls, clearLog, emit, open, focused, installFromStore, wait: (ms) => new Promise((r) => setTimeout(r, ms)) };
