// The Store: launcher apps and Android apps from repositories; install, update, remove.
const { check, done, open, calls, bridge, wait, TEST_REPO, REPO } = require('./lib');
const fs = require('fs');

(async () => {
  const { browser, page, errors } = await open({ settings: { repos: [REPO, TEST_REPO] } });
  await page.click('[data-pt=tab-store]');
  await page.waitForSelector('[data-pt=store-entry]');
  const apps = await page.$$eval('[data-pt=store-entry]', (els) => els.map((e) => e.dataset.key));
  check('launcher apps from both repositories', ['app:playtheater', 'app:romm', 'app:windowed', 'app:evil'].every((k) => apps.includes(k)), apps.join());
  check('the top shows the selected app', (await page.textContent('.top h1')) === 'Notes' || (await page.textContent('.top h1')).length > 0);

  // Install a launcher app.
  await page.click('[data-pt=store-entry][data-key="app:windowed"]');
  check('an app page opens', await page.isVisible('[data-pt=store-sheet]'));
  check('…with Install selected', (await page.evaluate(() => document.activeElement.dataset.pt)) === 'install');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-pt=open]');
  const installed = (await bridge('apps.list')).map((a) => a.id);
  check('Install puts it on the device', installed.includes('windowed'));
  check('its files are checked and saved', fs.existsSync('/tmp/pbs-test-data/apps/windowed/index.html'));
  await page.keyboard.press('Escape'); await wait(200);
  check('it shows as installed', !!(await page.$('[data-pt=store-entry][data-key="app:windowed"] .badge')));

  // Update: the repository offers a newer version.
  const idx = __dirname + '/repo/index.json';
  const orig = fs.readFileSync(idx, 'utf8');
  try {
    const j = JSON.parse(orig);
    j.apps.find((a) => a.id === 'windowed').version = '1.1.0';
    fs.writeFileSync(idx, JSON.stringify(j));
    await page.click('[data-pt=store-refresh]'); await wait(800);
    await page.click('[data-pt=store-updates]'); await wait(300);
    const ups = await page.$$eval('[data-pt=store-entry]', (els) => els.map((e) => e.dataset.key));
    check('Updates lists the newer launcher app and the newer Android app', ups.includes('app:windowed') && ups.includes('android:org.example.radio'), ups.join());
    await page.click('[data-pt=store-entry][data-key="app:windowed"]');
    check('…with Update first', (await page.evaluate(() => document.activeElement.dataset.pt)) === 'update');
  } finally {
    fs.writeFileSync(idx, orig);
  }
  await page.keyboard.press('Escape');
  await page.click('[data-pt=store-refresh]'); await wait(800);

  // A launcher app whose file doesn't match its checksum isn't installed.
  const bad = JSON.parse(orig);
  bad.apps.find((a) => a.id === 'evil').files['index.html'] = '0'.repeat(64);
  fs.writeFileSync(idx, JSON.stringify(bad));
  try {
    await page.click('[data-pt=store-refresh]'); await wait(800);
    await page.click('[data-pt=store-apps]'); await wait(200);
    await page.click('[data-pt=store-entry][data-key="app:evil"]');
    await page.click('[data-pt=install]');
    await page.waitForSelector('[data-pt=store-note]');
    check('a file that doesn’t match its checksum stops the install', (await page.textContent('[data-pt=store-note]')).includes('checksum') && !(await bridge('apps.list')).some((a) => a.id === 'evil'));
  } finally {
    fs.writeFileSync(idx, orig);
  }
  await page.keyboard.press('Escape');

  // Android apps.
  await page.click('[data-pt=store-apks]'); await wait(300);
  const apks = await page.$$eval('[data-pt=store-entry]', (els) => els.map((e) => e.dataset.key));
  check('Android apps from the repositories', apks.includes('android:io.github.mightyx3n.playtheater') && apks.includes('android:org.example.newapp'), apks.join());
  await page.click('[data-pt=store-entry][data-key="android:org.example.newapp"]');
  check('it says Android asks to confirm', (await page.textContent('[data-pt=store-sheet]')).includes('Android asks you to confirm'));
  await page.click('[data-pt=install]'); await wait(800);
  const asked = await calls('apk.install');
  check('Install downloads the APK, checked, and hands it to Android', asked.length === 1 && asked[0].args.package === 'org.example.newapp' && /^[0-9a-f]{64}$/.test(asked[0].args.sha256), JSON.stringify(asked));
  await page.keyboard.press('Escape');
  await page.click('[data-pt=store-entry][data-key="android:org.example.broken"]');
  await page.click('[data-pt=install]'); await page.waitForSelector('[data-pt=store-note]');
  check('an APK that doesn’t match its checksum isn’t installed', (await page.textContent('[data-pt=store-note]')).includes('checksum'));
  await page.keyboard.press('Escape');
  await page.click('[data-pt=store-entry][data-key="android:org.example.radio"]');
  check('an installed Android app offers Open and Uninstall', await page.isVisible('[data-pt=open]') && await page.isVisible('[data-pt=remove]'));
  await page.click('[data-pt=remove]'); await wait(300);
  check('Uninstall asks Android', (await calls('android.uninstall')).some((c) => c.args.package === 'org.example.radio'));
  await page.keyboard.press('Escape');

  // Removing a launcher app.
  await page.click('[data-pt=store-installed]'); await wait(200);
  await page.click('[data-pt=store-entry][data-key="app:windowed"]');
  await page.click('[data-pt=remove]'); await wait(600);
  check('Remove takes a launcher app off the device', !(await bridge('apps.list')).some((a) => a.id === 'windowed'));

  // Repositories in Settings.
  await page.click('[data-pt=status]'); await page.click('[data-pt=qs-settings]'); await page.click('[data-pt=set-repos]');
  await page.fill('[data-pt=repo-input]', 'not a url'); await page.click('[data-pt=repo-add]');
  check('a bad address is refused', (await page.textContent('.err')).includes('http'));
  await page.fill('[data-pt=repo-input]', 'http://localhost:8611/nothing.json'); await page.click('[data-pt=repo-add]'); await wait(200);
  check('a repository can be added', JSON.parse(await page.evaluate(() => localStorage.getItem('pbs-settings'))).repos.length === 3);
  await page.click('[data-pt=tab-store]'); await wait(1000);
  check('one that can’t be read is reported', (await page.textContent('.main')).includes('Couldn’t read http://localhost:8611/nothing.json'));
  await page.click('[data-pt=status]'); await page.click('[data-pt=qs-settings]'); await page.click('[data-pt=set-repos]');
  const n = (await page.$$('[data-pt=repo-remove]')).length;
  await page.click('[data-pt=repo-remove] >> nth=2'); await wait(200);
  check('…and removed', (await page.$$('[data-pt=repo-remove]')).length === n - 1);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
