// Touch screens: a phone held upright, and a small TV box screen (1280×720).
const { check, done, open, wait, calls } = require('./lib');
const S = process.env.SHOTS;

(async () => {
  const { browser, page, errors } = await open({ mobile: true });
  const overflow = () => page.evaluate(() => [...document.querySelectorAll('.shell *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1) && !e.closest('.scroll-x') && !e.closest('[data-row]'); }).map((e) => e.className).slice(0, 5));
  check('phone: nothing sticks out of the screen on Home', (await overflow()).length === 0, (await overflow()).join());
  check('phone: all page tabs can be reached', (await page.$$('[data-pt^=tab-]')).length === 5);
  if (S) await page.screenshot({ path: S + '/phone-home.png' });
  await page.tap('[data-pt=row-apps] [data-key="android:org.example.files"]'); await wait(300);
  check('phone: tapping an app opens it', (await calls('android.launch')).some((c) => c.args.package === 'org.example.files'));
  await page.tap('[data-pt=tab-store]'); await page.waitForSelector('[data-pt=store-entry]');
  check('phone: Store fits', (await overflow()).length === 0, (await overflow()).join());
  if (S) await page.screenshot({ path: S + '/phone-store.png' });
  await page.tap('[data-pt=status]'); await wait(300);
  const box = await page.$eval('[data-pt=quick]', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
  check('phone: quick settings fit', box.l >= 0 && box.r <= 390, JSON.stringify(box));
  if (S) await page.screenshot({ path: S + '/phone-quick.png' });
  await browser.close();

  const tv = await open({ viewport: { width: 1280, height: 720 } });
  const ov = await tv.page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  check('720p: no sideways scrolling', !ov);
  const rem = await tv.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  check('720p: everything scales with the screen', Math.abs(rem - 1280 / 120) < 0.1, String(rem));
  const tile = await tv.page.$eval('[data-pt=row-apps] [data-pt=tile]', (e) => e.getBoundingClientRect().bottom);
  check('720p: the apps row is on screen', tile < 720, String(tile));
  if (S) await tv.page.screenshot({ path: S + '/tv-720.png' });
  await tv.browser.close();

  check('no page errors', errors.length === 0 && tv.errors.length === 0, [...errors, ...tv.errors].join(' | '));
  done();
})().catch((e) => { console.error(e); process.exit(1); });
