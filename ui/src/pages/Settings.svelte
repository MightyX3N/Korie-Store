<script>
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { settings, saveSettings, applyLook, ACCENTS, BACKGROUNDS, bgUrl, homeRows, setRowOrder, device, DEFAULT_REPO, apps, loadDevice } from '../lib/state.svelte.js';
  import { addRepo, removeRepo, loadStore } from '../lib/store.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { call } from '../lib/native.js';
  import { focusFirst } from '../lib/nav.js';
  import { toast } from '../lib/toast.svelte.js';

  const sections = [
    { id: 'look', label: 'Look' },
    { id: 'backgrounds', label: 'Backgrounds' },
    { id: 'rows', label: 'Home rows' },
    { id: 'repos', label: 'Repositories' },
    { id: 'device', label: 'This device' },
    { id: 'about', label: 'About' },
  ];

  let newRepo = $state('');
  let repoError = $state('');
  const rows = $derived(homeRows());

  function set(k, v) {
    settings[k] = v;
    saveSettings();
    applyLook();
  }

  function moveRow(i, by) {
    const list = [...rows];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setRowOrder(list);
  }
  function toggleRow(i) {
    const list = rows.map((r, k) => (k === i ? { ...r, on: !r.on } : r));
    setRowOrder(list);
  }

  function add() {
    repoError = '';
    try {
      addRepo(newRepo);
      newRepo = '';
      loadStore();
    } catch (e) {
      repoError = e.message;
    }
  }

  async function openSettings(page) {
    try { await call('settings.open', { page }); } catch (e) { toast(e.message); }
  }

  let page;
  $effect(() => {
    ui.settingsSection;
    tick().then(() => page && !page.contains(document.activeElement) && focusFirst(page.querySelector('.side')));
  });
  // Back on the device settings page re-reads whether we're the home app now.
  $effect(() => { if (ui.settingsSection === 'device') loadDevice(); });
</script>

<div class="page" bind:this={page}>
  <nav class="side" data-row aria-label="Settings">
    <h1>Settings</h1>
    {#each sections as s}
      <button class="sec" class:on={ui.settingsSection === s.id} data-current={ui.settingsSection === s.id ? '' : undefined} data-pt="set-{s.id}" onclick={() => (ui.settingsSection = s.id)}>{s.label}</button>
    {/each}
  </nav>

  <div class="main scroll-y" data-vscroll>
    {#if ui.settingsSection === 'look'}
      <h2>Accent colour</h2>
      <div class="swatches" data-row>
        {#each ACCENTS as c}
          <button class="swatch" class:on={settings.accent === c} style="--s: {c}" data-current={settings.accent === c ? '' : undefined} aria-label="Accent {c}" onclick={() => set('accent', c)}>
            {#if settings.accent === c}<Icon name="check" size="1.6rem" />{/if}
          </button>
        {/each}
      </div>

      <h2>Panels</h2>
      <div class="choices" data-row>
        <button class="choice" class:on={settings.look === 'glass'} data-pt="look-glass" onclick={() => set('look', 'glass')}><b>Glass</b><span>See-through and blurred</span></button>
        <button class="choice" class:on={settings.look === 'flat'} data-pt="look-flat" onclick={() => set('look', 'flat')}><b>Flat</b><span>Solid, and lighter on slow TV boxes</span></button>
      </div>

      <h2>Clock</h2>
      <div class="choices" data-row>
        {#each [['auto', 'Like the device'], ['24', '24 hours'], ['12', '12 hours']] as [v, l]}
          <button class="choice small" class:on={settings.clock === v} onclick={() => set('clock', v)}><b>{l}</b></button>
        {/each}
      </div>
    {:else if ui.settingsSection === 'backgrounds'}
      <h2>Which background</h2>
      <div class="choices" data-row>
        <button class="choice" class:on={settings.bgMode === 'app'} data-pt="bg-app" onclick={() => set('bgMode', 'app')}><b>Each app’s own</b><span>Apps that bring a background show it when selected; the others show the one below</span></button>
        <button class="choice" class:on={settings.bgMode === 'fixed'} data-pt="bg-fixed" onclick={() => set('bgMode', 'fixed')}><b>Always the same</b><span>The one below, whatever is selected</span></button>
      </div>
      <h2>Background</h2>
      <div class="bgs">
        {#each BACKGROUNDS as b}
          <button class="bg" class:on={settings.bg === b.id} style="background-image: url('{bgUrl(b.id)}')" data-pt="bg-{b.id}" onclick={() => set('bg', b.id)}>
            <span>{b.name}</span>
          </button>
        {/each}
      </div>
      <p class="hint">To give one app its own background, hold OK on it and choose <b>Background</b>.</p>
    {:else if ui.settingsSection === 'rows'}
      <h2>Rows on the home screen</h2>
      <p class="hint">Apps like PlayTheater add rows of their own, like Continue watching.</p>
      <div class="list">
        {#each rows as r, i (r.id)}
          <div class="rowline" data-row data-pt="rowline">
            <span class="rname" class:off={!r.on}>{r.title}{#if r.app}<small> · {r.app.name}</small>{/if}</span>
            <button class="btn" onclick={() => toggleRow(i)} data-pt="row-toggle">{r.on ? 'Shown' : 'Hidden'}</button>
            <button class="btn" disabled={i === 0} onclick={() => moveRow(i, -1)} aria-label="Move up"><Icon name="up" size="1.3rem" /></button>
            <button class="btn" disabled={i === rows.length - 1} onclick={() => moveRow(i, 1)} aria-label="Move down"><Icon name="down" size="1.3rem" /></button>
          </div>
        {/each}
      </div>
    {:else if ui.settingsSection === 'repos'}
      <h2>Repositories</h2>
      <p class="hint">The Store shows the launcher apps and Android apps in these. Only add repositories you trust: their apps run on this device.</p>
      <div class="list">
        {#each settings.repos as url (url)}
          <div class="rowline" data-row>
            <span class="rname mono">{url === DEFAULT_REPO ? 'PlayBigScreen (built in)' : url}</span>
            <button class="btn danger" data-pt="repo-remove" onclick={() => { removeRepo(url); loadStore(); }}>Remove</button>
          </div>
        {/each}
        {#if !settings.repos.includes(DEFAULT_REPO)}
          <div class="rowline" data-row><span class="rname">The built-in repository is removed.</span><button class="btn" onclick={() => { settings.repos = [DEFAULT_REPO, ...settings.repos]; saveSettings(); loadStore(); }}>Add it back</button></div>
        {/if}
      </div>
      <form class="add" data-row onsubmit={(e) => { e.preventDefault(); add(); }}>
        <input class="glass" bind:value={newRepo} data-pt="repo-input" placeholder="https://…/index.json" autocomplete="off" spellcheck="false" />
        <button class="btn primary" data-pt="repo-add">Add</button>
      </form>
      {#if repoError}<p class="err">{repoError}</p>{/if}
    {:else if ui.settingsSection === 'device'}
      <h2>Home app</h2>
      {#if device.platform === 'android'}
        <p class="hint" data-pt="home-state">{device.home?.isDefault ? 'PlayBigScreen opens when you press Home.' : 'Another app opens when you press Home. Choose PlayBigScreen as the home app to change that.'}</p>
        <div class="choices" data-row>
          <button class="btn" onclick={() => openSettings('home')}>Choose the home app</button>
          {#if device.helper?.available}
            <button class="btn" onclick={() => openSettings('accessibility')}>{device.helper.on ? 'Home button helper is on' : 'Turn on the Home button helper'}</button>
          {/if}
        </div>
        {#if device.helper?.available}
          <p class="hint">Some TVs don’t let you choose another home app. The Home button helper (in Accessibility) opens PlayBigScreen whenever the TV’s own home screen comes up.</p>
        {/if}
        <h2>Device settings</h2>
        <div class="choices wrap" data-row>
          <button class="btn" onclick={() => openSettings('wifi')}>Network</button>
          <button class="btn" onclick={() => openSettings('bluetooth')}>Bluetooth</button>
          <button class="btn" onclick={() => openSettings('display')}>Display</button>
          <button class="btn" onclick={() => openSettings('sound')}>Sound</button>
          <button class="btn" onclick={() => openSettings('date')}>Date and time</button>
          <button class="btn" onclick={() => openSettings('all')}>All settings</button>
        </div>
      {:else}
        <p class="hint" data-pt="home-state">PlayBigScreen is running in a browser on {device.device || 'this computer'}. The home app and device settings are for the Android app.</p>
      {/if}
    {:else}
      <h2>PlayBigScreen {device.version}</h2>
      <p class="hint">A home screen for TVs and big screens: your Android apps and launcher apps side by side, with a Store for both.</p>
      <p class="hint">Running on {device.platform === 'android' ? 'Android' : 'a browser'}{device.device ? `, ${device.device}` : ''}. {apps.list.length} apps.</p>
      <p class="hint">Free software under the GPL 3.0. Source: github.com/MightyX3N/PlayBigScreen</p>
    {/if}
  </div>
</div>

<style>
  .page { position: absolute; inset: 0; padding: 9.5rem var(--gutter) 0; display: grid; grid-template-columns: 19rem 1fr; gap: 3rem; }
  .side { display: flex; flex-direction: column; gap: 0.3rem; }
  h1 { margin: 0 0 1.2rem 1.4rem; font-size: 2.4rem; font-weight: 380; }
  .sec { padding: 0.9rem 1.4rem; border-radius: 1rem; font-size: 1.2rem; color: var(--dim); }
  .sec.on { background: rgba(255, 255, 255, 0.12); color: var(--ink); }
  .sec:focus { background: var(--ink); color: #0d1220; }
  .main { min-height: 0; padding: 0.4rem 1rem 5rem; max-width: 74rem; }
  h2 { font-size: 1.5rem; font-weight: 400; margin: 2.2rem 0 1.1rem; }
  h2:first-child { margin-top: 0.6rem; }
  .hint { color: var(--dim); font-size: 1.1rem; max-width: 56rem; margin: 0 0 1.2rem; }
  .swatches { display: flex; gap: 1.2rem; }
  .swatch { width: 4.4rem; height: 4.4rem; border-radius: 50%; background: var(--s); display: grid; place-items: center; color: #06221e; transition: transform 0.15s, box-shadow 0.15s; }
  .swatch:focus { transform: scale(1.12); box-shadow: 0 0 0 0.25rem var(--ink); }
  .choices { display: flex; gap: 1.2rem; flex-wrap: wrap; }
  .choice { min-width: 18rem; max-width: 26rem; padding: 1.3rem 1.6rem; border-radius: 1.4rem; background: rgba(255, 255, 255, 0.07); border: 1px solid var(--glass-line); display: flex; flex-direction: column; gap: 0.4rem; }
  .choice.small { min-width: 12rem; }
  .choice b { font-weight: 420; font-size: 1.2rem; }
  .choice span { color: var(--dim); font-size: 1rem; }
  .choice.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .choice:focus { background: var(--ink); color: #0d1220; }
  .choice:focus span { color: #3a4255; }
  .bgs { display: grid; grid-template-columns: repeat(auto-fill, 17rem); gap: 1.4rem; }
  .bg { aspect-ratio: 16 / 9; border-radius: 1.2rem; background-size: cover; background-position: center; display: flex; align-items: flex-end; padding: 0.8rem 1rem; border: 2px solid transparent; transition: transform 0.15s; }
  .bg span { font-size: 1.05rem; text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7); }
  .bg.on { border-color: var(--accent); }
  .bg:focus { transform: scale(1.06); border-color: var(--ink); }
  .list { display: flex; flex-direction: column; gap: 0.8rem; margin-bottom: 1.6rem; }
  .rowline { display: flex; align-items: center; gap: 0.8rem; padding: 0.7rem 0.8rem 0.7rem 1.4rem; border-radius: 1.2rem; background: rgba(255, 255, 255, 0.05); }
  .rname { flex: 1; font-size: 1.15rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rname small { color: var(--faint); font-size: 0.95rem; }
  .rname.off { color: var(--faint); }
  .mono { font-size: 1rem; }
  .add { display: flex; gap: 1rem; }
  .add input { flex: 1; height: 3.2rem; border-radius: 999px; padding: 0 1.4rem; font-size: 1.05rem; user-select: text; }
  .add input:focus { border-color: rgba(255, 255, 255, 0.6); }
  .err { color: #ffb4a8; }
  .wrap { flex-wrap: wrap; }
  @media (max-aspect-ratio: 1/1) {
    .page { grid-template-columns: 1fr; grid-template-rows: auto 1fr; padding-top: 12rem; gap: 1rem; }
    .side { flex-direction: row; overflow-x: auto; scrollbar-width: none; }
    h1 { display: none; }
    .sec { flex: none; }
  }
</style>
