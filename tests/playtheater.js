// The PlayTheater app against a PlayTheater test server (PT on :8484, admin / secret1).
const { check, done, open, wait, installFromStore } = require('./lib');
const PT = process.env.PT || 'http://localhost:8484';

(async () => {
  const st = await fetch(PT + '/api/status').then((r) => r.json()).catch(() => null);
  if (!st) { console.log('  skip: no PlayTheater server at ' + PT); done(); return; }
  const { browser, page, errors } = await open();
  await installFromStore(page, 'app:playtheater');
  await page.click('[data-pt=tab-home]'); await wait(800);
  await page.click('[data-pt=row-apps] [data-key="app:playtheater"]'); await wait(1200);
  const f = page.frameLocator('[data-pt=app-layer] iframe');

  check('it asks for the server first', await f.locator('#server').isVisible());
  check('…with the cursor in the box', await f.locator('#server').evaluate((el) => document.activeElement === el));
  await f.locator('#server').fill('localhost:8620'); await page.keyboard.press('Enter'); await wait(800);
  check('another kind of server is turned down', (await f.locator('#connect-err').textContent()).includes('No PlayTheater answered') || (await f.locator('#connect-err').textContent()).includes('isn’t a PlayTheater'));
  await f.locator('#server').fill(PT.replace('http://', '')); await page.keyboard.press('Enter'); await wait(800);
  check('then to sign in', await f.locator('#name').isVisible());
  await f.locator('#name').fill('admin'); await f.locator('#password').fill('nope'); await page.keyboard.press('Enter'); await wait(800);
  check('a wrong password shows the server’s message', (await f.locator('#signin-err').textContent()).length > 3);
  await f.locator('#password').fill('secret1'); await page.keyboard.press('Enter'); await wait(1500);
  const web = await page.locator('[data-pt=web-layer] iframe').getAttribute('src').catch(() => '');
  check('signed in, PlayTheater opens full screen', web === PT + '/', web);
  await page.click('[data-pt=web-close]'); await wait(1000);
  check('closing PlayTheater closes the app', !(await page.isVisible('[data-pt=app-layer]')));

  await page.waitForSelector('[data-pt="row-app:playtheater:continue"]', { timeout: 10000 }).catch(() => {});
  check('Continue watching from the server is on the home screen', await page.isVisible('[data-pt="row-app:playtheater:continue"]'));
  const img = await page.getAttribute('[data-pt="row-app:playtheater:continue"] img', 'src').catch(() => '');
  check('…with its pictures (fetched with the sign-in)', img.startsWith('data:image/'));
  const libs = await page.$$eval('[data-pt^="row-app:playtheater:lib-"]', (els) => els.length);
  check('and what’s new in the libraries', libs >= 1);
  await page.focus('[data-pt="row-app:playtheater:continue"] [data-pt=item]'); await wait(900);
  check('selecting it shows it in the big title', (await page.textContent('[data-pt=hero-title]')).length > 0 && (await page.textContent('[data-pt=hero-title]')) !== 'PlayTheater');
  const id = await page.evaluate(() => document.activeElement.closest('.card') && 1);
  await page.keyboard.press('Enter'); await wait(1500);
  const item = await page.locator('[data-pt=web-layer] iframe').getAttribute('src').catch(() => '');
  check('OK opens that title in PlayTheater', item.startsWith(PT + '/item/'), item);
  await page.click('[data-pt=web-close]'); await wait(800);

  await page.click('[data-pt=tab-search]'); await page.keyboard.type('big'); await wait(2000);
  check('the launcher’s search finds films on the server', await page.isVisible('[data-pt=search-playtheater]'));

  // Its settings: who is signed in, and sign out.
  await page.click('[data-pt=tab-apps]'); await wait(200);
  await page.click('[data-pt=apps-grid] [data-key="app:playtheater"]', { button: 'right' });
  await page.click('[data-pt=menu-app-settings]'); await wait(1500);
  const s = page.frameLocator('[data-pt=app-layer] iframe');
  check('settings say who is signed in', (await s.locator('#settings-who').textContent()).includes('as admin'));
  await s.locator('[data-act=signout]').click(); await wait(800);
  check('sign out', await s.locator('#name').isVisible());
  await page.keyboard.press('Escape'); await wait(1500);
  await page.click('[data-pt=tab-home]'); await wait(500);
  check('signed out, its rows go away', !(await page.isVisible('[data-pt="row-app:playtheater:continue"]')));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
