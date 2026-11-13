// The home screen, moving around with keys, menus, quick settings and settings.
const { check, done, open, focused, calls, emit, bridge, wait } = require('./lib');

(async () => {
  const { browser, page, errors } = await open();
  const k = (key) => page.keyboard.press(key);

  // Home: the Android apps (not system ones like Settings) on the row, first one selected.
  const tiles = await page.$$eval('[data-pt=row-apps] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('home row has the Android apps, without system ones', tiles.length === 5 && !tiles.includes('android:com.android.tv.settings'), tiles.join());
  check('first app is selected', (await focused(page)) === tiles[0]);
  check('big title shows it', (await page.textContent('[data-pt=hero-title]')) === 'Browser');
  await k('ArrowRight'); await wait(150);
  check('right moves along the row', (await focused(page)) === tiles[1]);
  check('the title follows', (await page.textContent('[data-pt=hero-title]')) === 'Files');
  await k('ArrowUp'); await wait(150);
  check('up goes to the page tabs, on Home', (await focused(page)) === 'tab-home');
  await k('ArrowDown'); await wait(150);
  check('down comes back to where you were in the row', (await focused(page)) === tiles[1]);

  // Opening an Android app.
  await k('Enter'); await wait(300);
  const launched = await calls('android.launch');
  check('OK opens the app', launched.length === 1 && launched[0].args.package === 'org.example.files', JSON.stringify(launched));

  // Holding OK: the app's options.
  await page.keyboard.down('Enter'); await wait(120);
  for (let i = 0; i < 8; i++) { await page.keyboard.down('Enter'); await wait(90); }
  await page.keyboard.up('Enter'); await wait(250);
  check('holding OK opens the options', await page.isVisible('[data-pt=app-menu]'));
  check('…without opening the app again', (await calls('android.launch')).length === 1);
  check('focus is in the options', (await page.evaluate(() => !!document.activeElement.closest('[data-pt=app-menu]'))));
  await k('ArrowUp'); await k('ArrowUp'); await k('ArrowUp'); await wait(100);
  await k('Escape'); await wait(200);
  check('Back closes the options and returns to the app', !(await page.isVisible('[data-pt=app-menu]')) && (await focused(page)) === tiles[1]);

  // Moving an app on the home row.
  await page.click(`[data-pt=row-apps] [data-key="${tiles[1]}"]`, { button: 'right' });
  await page.click('[data-pt=menu-move]'); await wait(200);
  await k('ArrowLeft'); await wait(200); await k('Enter'); await wait(200);
  const moved = await page.$$eval('[data-pt=row-apps] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('an app can be moved along the row', moved[0] === tiles[1] && moved[1] === tiles[0], moved.join());
  check('the order is kept', JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-pins')))[0] === tiles[1]);

  // Taking one off the row and putting it back from Apps.
  await page.click(`[data-pt=row-apps] [data-key="android:org.example.radio"]`, { button: 'right' });
  await page.click('[data-pt=menu-unpin]'); await wait(200);
  check('an app can be taken off the row', !(await page.$('[data-pt=row-apps] [data-key="android:org.example.radio"]')));
  await page.click('[data-pt=tab-apps]'); await wait(300);
  const all = await page.$$eval('[data-pt=apps-grid] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('Apps shows every app, system ones too', all.length === 6 && all.includes('android:com.android.tv.settings'));
  await page.click('[data-pt=apps-grid] [data-key="android:org.example.radio"]', { button: 'right' });
  await page.click('[data-pt=menu-pin]'); await wait(150);
  await page.click('[data-pt=tab-home]'); await wait(300);
  const back = await page.$$eval('[data-pt=row-apps] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('…and put back at the end', back[back.length - 1] === 'android:org.example.radio', back.join());

  // Per-app background.
  await page.click('[data-pt=row-apps] [data-key="android:org.example.photos"]', { button: 'right' });
  await page.click('[data-pt=menu-bg]'); await page.click('[data-pt=menu-bg-ember]'); await wait(150);
  check('an app can have its own background', JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-settings'))).appBg['android:org.example.photos'] === 'ember');
  await page.focus('[data-pt=row-apps] [data-key="android:org.example.photos"]'); await wait(900);
  check('…which shows when it is selected', (await page.$$eval('.backdrop .layer', (els) => els.map((e) => e.style.backgroundImage).pop())).includes('ember'));

  // Recents.
  await page.click('[data-pt=tab-recents]'); await wait(300);
  const rec = await page.$$eval('[data-pt=recents-grid] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('Recents lists what was opened', rec[0] === 'android:org.example.files', rec.join());

  // Quick settings.
  await page.click('[data-pt=status]'); await wait(300);
  check('quick settings open', await page.isVisible('[data-pt=quick]'));
  const vol0 = (await bridge('volume.get')).level;
  await page.focus('[data-pt=qs-volume]');
  await k('ArrowRight'); await wait(250);
  check('right on the volume turns it up', (await bridge('volume.get')).level === vol0 + 1);
  await k('ArrowLeft'); await k('ArrowLeft'); await wait(300);
  check('left turns it down', (await bridge('volume.get')).level === vol0 - 1);
  await page.click('[data-pt=qs-mute]'); await wait(250);
  check('mute', (await bridge('volume.get')).muted === true);
  await page.click('[data-pt=qs-mute]'); await wait(250);
  await page.click('[data-pt=qs-network]'); await wait(250);
  check('Network opens the device’s network settings', (await calls('settings.open')).some((c) => c.args.page === 'wifi'));
  await page.click('[data-pt=status]'); await wait(200);
  await k('Escape'); await wait(200);
  check('Back closes quick settings', !(await page.isVisible('[data-pt=quick]')));

  // Settings: look, background, rows.
  await page.click('[data-pt=status]'); await page.click('[data-pt=qs-settings]'); await wait(300);
  check('Launcher settings open from quick settings', await page.isVisible('[data-pt=set-look]'));
  await page.click('[data-pt=look-flat]'); await wait(100);
  check('flat panels', (await page.evaluate(() => document.documentElement.dataset.look)) === 'flat');
  await page.click('[data-pt=look-glass]');
  await page.click('[aria-label="Accent #ffb547"]'); await wait(100);
  check('accent colour', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim())) === '#ffb547');
  await page.click('[data-pt=set-backgrounds]'); await page.click('[data-pt=bg-fixed]'); await page.click('[data-pt=bg-forest]'); await wait(100);
  const st = JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-settings')));
  check('background choice is saved', st.bgMode === 'fixed' && st.bg === 'forest');
  await page.click('[data-pt=set-rows]'); await wait(200);
  const lines = await page.$$eval('[data-pt=rowline] .rname', (els) => els.map((e) => e.textContent.trim()));
  check('home rows are listed', lines[0] === 'Apps' && lines.includes('Recently used'), lines.join('|'));
  await page.click('[data-pt=rowline]:nth-child(2) [data-pt=row-toggle]'); await wait(100);
  await page.click('[data-pt=tab-home]'); await wait(400);
  check('a row can be turned on (Recently used)', await page.isVisible('[data-pt=row-recents]'));
  await page.click('[data-pt=status]'); await page.click('[data-pt=qs-settings]');
  await page.click('[data-pt=set-device]'); await wait(200);
  check('device page says where it runs', (await page.textContent('[data-pt=home-state]')).includes('browser'));

  // Device events: Home closes everything and shows Home; Back from a page goes Home.
  await emit('home'); await wait(300);
  check('Home (from the device) shows Home', await page.isVisible('[data-pt=row-apps]'));
  await page.click('[data-pt=tab-apps]'); await wait(200);
  await emit('back'); await wait(300);
  check('Back on another page goes Home', await page.isVisible('[data-pt=row-apps]'));

  // Search finds apps by name.
  await page.click('[data-pt=tab-search]'); await wait(200);
  check('Search puts the cursor in the box', (await focused(page)) === 'search-input');
  await page.keyboard.type('pho'); await wait(500);
  const hits = await page.$$eval('[data-pt=search-apps] [data-pt=tile]', (els) => els.map((e) => e.dataset.key));
  check('Search finds apps by name', hits.length === 1 && hits[0] === 'android:org.example.photos', hits.join());

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
