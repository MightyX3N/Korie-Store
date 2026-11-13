// The RomM app against a pretend RomM server (tests/fake-romm.mjs on :8620).
const { check, done, open, wait, installFromStore, calls } = require('./lib');

(async () => {
  const { browser, page, errors } = await open();
  await installFromStore(page, 'app:romm');
  await page.click('[data-pt=tab-home]'); await wait(800);
  await page.click('[data-pt=row-apps] [data-key="app:romm"]'); await wait(1200);
  const f = page.frameLocator('[data-pt=app-layer] iframe');

  check('first it asks for the server', await f.locator('#server').isVisible());
  await f.locator('#server').fill('localhost:9'); await page.keyboard.press('Enter'); await wait(1200);
  check('a wrong address is explained', (await f.locator('#server-err').textContent()).includes('No RomM answered'));
  await f.locator('#server').fill('localhost:8620'); await page.keyboard.press('Enter'); await wait(800);
  check('then to sign in', await f.locator('#user').isVisible());
  await f.locator('#user').fill('player'); await f.locator('#pass').fill('wrong'); await page.keyboard.press('Enter'); await wait(600);
  check('a wrong password is explained', (await f.locator('#login-err').textContent()).includes('don’t match'));
  await f.locator('#pass').fill('retro-pass'); await page.keyboard.press('Enter'); await wait(1500);

  check('signed in, the library shows', await f.locator('#grid').isVisible());
  const plats = await f.locator('.plat-btn').allTextContents();
  check('platforms with games are listed (empty ones left out)', plats.some((p) => p.startsWith('NES3')) && !plats.some((p) => p.startsWith('Game Boy')), plats.join('|'));
  check('all games, by name', (await f.locator('.cell .t').allTextContents()).join() === 'Copper Knights,Lantern Keep,Moss Valley Racing,Neon Harbour,Star Courier,Tidecaller');
  check('covers come from the server', (await f.locator('.cover-btn img').first().getAttribute('src')).startsWith('http://localhost:8620/assets/romm/resources/'));

  // A platform, with the remote.
  await f.locator('.plat-btn', { hasText: 'SNES' }).click(); await wait(600);
  check('a platform shows its games', (await f.locator('.cell .t').allTextContents()).join() === 'Copper Knights,Tidecaller');
  await page.keyboard.press('ArrowRight'); await wait(150);
  await page.keyboard.press('Enter'); await wait(500);
  check('OK on a game opens it', (await f.locator('#g-name').textContent()) === 'Copper Knights' && await f.locator('#g-play').isVisible());
  check('Play is selected', (await f.locator(':focus').getAttribute('id')) === 'g-play');
  await page.keyboard.press('Enter'); await wait(600);
  const web = await page.locator('[data-pt=web-layer] iframe').getAttribute('src').catch(() => '');
  check('Play opens RomM’s player for that game', web === 'http://localhost:8620/rom/104/ejs', web);
  await page.click('[data-pt=web-close]'); await wait(300);
  await page.keyboard.press('Escape'); await wait(300);
  check('Back closes the game first', !(await f.locator('#game').isVisible()) && await page.isVisible('[data-pt=app-layer]'));

  // A platform the browser can't play.
  await f.locator('.plat-btn', { hasText: 'PlayStation 2' }).click(); await wait(500);
  await f.locator('.cover-btn').first().click(); await wait(300);
  check('a game RomM can’t play in the browser says so', !(await f.locator('#g-play').isVisible()) && (await f.locator('#g-note').textContent()).includes('can’t play'));
  await page.keyboard.press('Escape'); await wait(200);

  // Search inside the app.
  await f.locator('#search-btn').click(); await wait(200);
  await f.locator('#q').fill('moss'); await wait(900);
  check('search in the app', (await f.locator('.cell .t').allTextContents()).join() === 'Moss Valley Racing');
  await page.keyboard.press('Escape'); await wait(300);
  await page.keyboard.press('Escape'); await wait(500);
  check('Back leaves search, then closes the app', !(await page.isVisible('[data-pt=app-layer]')));

  // Home rows and launcher search.
  await wait(1200);
  check('Continue playing on the home screen', (await page.textContent('[data-pt="row-app:romm:continue"]')).includes('Lantern Keep'));
  check('New games on the home screen', (await page.locator('[data-pt="row-app:romm:recent"] [data-pt=item]').count()) === 6);
  await page.click('[data-pt="row-app:romm:continue"] [data-pt=item] >> nth=0'); await wait(1500);
  const resumed = await page.locator('[data-pt=web-layer] iframe').getAttribute('src').catch(() => '');
  check('a Continue playing game starts playing straight away', /\/rom\/10[01]\/ejs$/.test(resumed), resumed);
  await page.click('[data-pt=web-close]'); await wait(300);
  await page.locator('[data-pt=app-layer]').count() && await page.keyboard.press('Escape'); await wait(400);
  await page.click('[data-pt=tab-search]'); await page.keyboard.type('knight'); await wait(1500);
  check('the launcher’s search finds games', (await page.textContent('[data-pt=search-romm]')).includes('Copper Knights'));

  // Settings, sign out and pairing code.
  await page.click('[data-pt=tab-apps]'); await wait(200);
  await page.click('[data-pt=apps-grid] [data-key="app:romm"]', { button: 'right' });
  await page.click('[data-pt=menu-app-settings]'); await wait(1500);
  const s = page.frameLocator('[data-pt=app-layer] iframe');
  check('the app’s settings open from its options', (await s.locator('#s-who').textContent()).includes('as player'));
  await s.locator('[data-act=signout]').click(); await wait(600);
  check('sign out goes back to sign in', await s.locator('#user').isVisible());
  await s.locator('[data-act=use-code]').click(); await wait(200);
  await s.locator('#code').fill('11112222'); await page.keyboard.press('Enter'); await wait(500);
  check('a wrong pairing code is explained', (await s.locator('#code-err').textContent()).includes('isn’t right'));
  await s.locator('#code').fill('1234 5678'); await page.keyboard.press('Enter'); await wait(1500);
  check('a pairing code signs in too', await s.locator('#grid').isVisible() && (await s.locator('.cell').count()) === 6);
  check('…and the token is kept for the app only', JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-app:romm:token'))).startsWith('rmm_'));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
