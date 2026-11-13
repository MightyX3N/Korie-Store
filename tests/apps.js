// Launcher apps: windows and full screen, Back, storage, home rows, search, the device's
// player and web view, and what an app can't reach.
const { check, done, open, wait, focused, installFromStore, TEST_REPO } = require('./lib');

(async () => {
  const { browser, page, errors } = await open({ settings: { repos: [TEST_REPO] } });
  await installFromStore(page, 'app:windowed');
  await installFromStore(page, 'app:evil');
  await page.click('[data-pt=tab-home]'); await wait(1500);

  const tiles = await page.$$eval('[data-pt=row-apps] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('installed launcher apps are on the home row with the Android apps', tiles.includes('app:windowed') && tiles.includes('app:evil') && tiles.includes('android:org.example.files'), tiles.join());
  await page.waitForSelector('[data-pt="row-app:windowed:notes"]', { timeout: 8000 }).catch(() => {});
  check('an app adds its own home row', await page.isVisible('[data-pt="row-app:windowed:notes"]'));

  // Opening in a window.
  await page.click('[data-pt=row-apps] [data-key="app:windowed"]'); await wait(1200);
  const layer = page.locator('[data-pt=app-layer][data-app=windowed]');
  check('a window app opens in a window', (await layer.getAttribute('class')).includes('window'));
  const f = page.frameLocator('[data-pt=app-layer] iframe');
  check('it runs on its own origin', (await f.locator('body').evaluate(() => location.origin)) === 'http://windowed.app.localhost:8600');
  check('it knows where it runs', (await f.locator('#open').textContent()).includes('platform=web'));
  check('it can set its window title', (await page.textContent('.titlebar .title')) === 'Notes · all');
  check('focus goes into the app', await f.locator('#note').evaluate((el) => document.activeElement === el));
  // The SDK's arrow-key navigation inside the app.
  await page.keyboard.press('ArrowDown'); await wait(100);
  check('arrow keys move inside the app', (await f.locator(':focus').getAttribute('id')) === 'save');

  // Storage and rows.
  await f.locator('#note').fill('Buy popcorn');
  await f.locator('#save').click(); await wait(1200);
  check('an app keeps its own things', (await page.evaluate(() => localStorage.getItem('pbs-app:windowed:note'))) === '"Buy popcorn"');
  check('…and can refresh its home row', (await page.textContent('[data-pt="row-app:windowed:notes"]')).includes('Buy popcorn'));

  // Back: the app first (its panel), then the app closes.
  await f.locator('#note').press('F2'); await wait(150);
  await page.keyboard.press('Escape'); await wait(300);
  check('Back goes to the app first', (await f.locator('#out').textContent()) === 'panel closed' && await page.isVisible('[data-pt=app-layer]'));
  await f.locator('#note').focus();
  await page.keyboard.press('Escape'); await wait(400);
  check('then Back closes the app', !(await page.isVisible('[data-pt=app-layer]')));
  check('focus returns to its tile', (await focused(page)) === 'app:windowed');

  // The device's Back event (Android's Back button) goes to the open app too.
  await page.click('[data-pt=row-apps] [data-key="app:windowed"]'); await wait(1000);
  const { emit } = require('./lib');
  await emit('back'); await wait(500);
  check('the device Back button closes an app', !(await page.isVisible('[data-pt=app-layer]')));

  // Opening from a home row item and from search.
  await page.click('[data-pt="row-app:windowed:notes"] [data-pt=item]'); await wait(1000);
  check('an item on a home row opens the app at it', (await page.frameLocator('[data-pt=app-layer] iframe').locator('#open').textContent()).startsWith('open=n1'));
  await page.click('[data-pt=app-close]'); await wait(300);
  await page.click('[data-pt=tab-search]'); await page.keyboard.type('note'); await wait(1200);
  check('apps answer searches', (await page.textContent('[data-pt=search-windowed]')).includes('Note about note'));
  await page.click('[data-pt=tab-home]'); await wait(300);

  // The device's web view and player (the browser host stands in for them).
  await page.click('[data-pt=row-apps] [data-key="app:windowed"]'); await wait(1000);
  const g = page.frameLocator('[data-pt=app-layer] iframe');
  await g.locator('#sub').click(); await wait(500);
  check('openWeb shows the page full screen', await page.isVisible('[data-pt=web-layer]'));
  await page.click('[data-pt=web-close]'); await wait(300);
  check('…and tells the app when it’s closed', (await g.locator('#out').textContent()).startsWith('web closed'));
  await g.locator('#play').click(); await wait(400);
  check('play opens the player', await page.isVisible('[data-pt=video-layer]'));
  check('…not dimmed unless chosen in Settings', !(await page.$('[data-pt=video-dimmer]')) && !(await page.$('[data-pt=video-dim]')));
  await page.click('[data-pt=video-close]'); await wait(300);
  check('…and answers where it stopped', (await g.locator('#out').textContent()).startsWith('played {"position"'));
  await page.click('[data-pt=app-close]'); await wait(300);

  // Dimming videos (for cars), from Settings → Videos.
  await page.click('[data-pt=status]'); await page.click('[data-pt=qs-settings]'); await page.click('[data-pt=set-videos]'); await wait(200);
  await page.click('[data-pt=dim-dark] button:has-text("75 %")');
  await page.click('[data-pt=dim-blur] button:has-text("Light blur")');
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-settings')));
  check('the dimming choice is saved', st.dimDark === 75 && st.dimBlur === 1);
  await page.click('[data-pt=tab-home]'); await wait(300);
  await page.click('[data-pt=row-apps] [data-key="app:windowed"]'); await wait(1000);
  await page.frameLocator('[data-pt=app-layer] iframe').locator('#play').click(); await wait(500);
  const look = await page.$eval('[data-pt=video-dimmer]', (e) => ({ bg: getComputedStyle(e).backgroundColor, blur: getComputedStyle(e).backdropFilter }));
  check('videos apps play are darkened', look.bg === 'rgba(0, 0, 0, 0.75)', look.bg);
  check('…and blurred', look.blur.startsWith('blur('), look.blur);
  await page.click('[data-pt=video-dim]'); await wait(200);
  check('the player’s Undim turns it off', !(await page.$('[data-pt=video-dimmer]')));
  await page.click('[data-pt=video-close]'); await wait(300);
  await page.click('[data-pt=app-close]'); await wait(300);

  // What an app can't do.
  await page.click('[data-pt=row-apps] [data-key="app:evil"]'); await wait(2500);
  const out = JSON.parse(await page.frameLocator('[data-pt=app-layer] iframe').locator('#out').textContent());
  check('a full-screen app covers the screen', (await page.locator('[data-pt=app-layer]').getAttribute('class')).includes('fullscreen'));
  check('an app can’t reach the launcher page', out.parentDoc === 'blocked' && out.parentStorage === 'blocked');
  check('an app can’t read another app’s things', out.otherAppsNote === null);
  check('a frame the launcher didn’t open gets no answers', out.innerFrameAnswered === false);
  check('an app can’t read the launcher’s files', out.fetchLauncher === 'blocked');
  await page.keyboard.press('Escape'); await wait(400);

  // Removing an app from its options.
  await page.click('[data-pt=row-apps] [data-key="app:evil"]', { button: 'right' });
  await page.click('[data-pt=menu-remove]'); await page.click('[data-pt=menu-remove-yes]'); await wait(800);
  check('an app can be removed from its options', !(await page.$('[data-pt=row-apps] [data-key="app:evil"]')));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
