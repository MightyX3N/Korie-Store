<script>
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { store, loadStore, statusOf, updates, install, remove } from '../lib/store.svelte.js';
  import { apps, appByKey } from '../lib/state.svelte.js';
  import { ui, go } from '../lib/ui.svelte.js';
  import { launch } from '../lib/launch.js';
  import { onBack, focusFirst } from '../lib/nav.js';
  import { toast } from '../lib/toast.svelte.js';

  let section = $state('apps'); // apps, apks, installed, updates
  let selected = $state(null); // the entry the top shows
  let open = $state(null); // the entry whose page is open
  let note = $state('');

  if (!store.loaded && !store.loading) loadStore();

  const list = $derived.by(() => {
    apps.list; // installed state changes the lists
    if (section === 'apps') return store.apps;
    if (section === 'apks') return store.apks;
    if (section === 'updates') return updates();
    return [...store.apps, ...store.apks].filter((e) => statusOf(e).installed);
  });
  const shown = $derived(selected && list.includes(selected) ? selected : list[0] || null);
  const upd = $derived(updates().length);

  const sections = $derived([
    { id: 'apps', label: 'Launcher apps' },
    { id: 'apks', label: 'Android apps' },
    { id: 'installed', label: 'Installed' },
    { id: 'updates', label: 'Updates', count: upd },
  ]);

  let page;
  let sheet = $state();
  $effect(() => {
    store.loaded;
    tick().then(() => page && !page.contains(document.activeElement) && !open && focusFirst(page.querySelector('.side')));
  });

  $effect(() => {
    if (!open) return;
    const before = document.activeElement;
    const off = onBack(() => { open = null; return true; });
    tick().then(() => focusFirst(sheet));
    return () => { off(); tick().then(() => before?.isConnected && before.focus({ preventScroll: true })); };
  });

  function show(e) { note = ''; open = e; }

  async function doInstall(e) {
    note = '';
    try {
      const r = await install(e);
      if (e.kind === 'app') { toast(`${e.name} is installed`); note = 'Installed. It’s on your home row.'; }
      else if (r?.status === 'needs-permission') note = 'Allow PlayBigScreen to install apps in the settings that just opened, then choose Install again.';
      else note = 'Android asks you to confirm the install.';
      await tick();
      focusFirst(sheet);
    } catch (err) {
      note = `Couldn’t install: ${err.message}`;
    }
  }

  async function doRemove(e) {
    note = '';
    try {
      await remove(e);
      if (e.kind === 'app') { toast(`${e.name} is removed`); open = null; }
      else note = 'Android asks you to confirm.';
    } catch (err) {
      note = `Couldn’t remove: ${err.message}`;
    }
  }

  function openInstalled(e) {
    const app = appByKey(e.key);
    if (app) { open = null; launch(app); }
  }

  const sizeOf = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} kB` : '');
</script>

<div class="page" bind:this={page}>
  <nav class="side" data-row aria-label="Store sections">
    {#each sections as s}
      <button class="sec" class:on={section === s.id} data-current={section === s.id ? '' : undefined} data-pt="store-{s.id}" onclick={() => { section = s.id; selected = null; }}>
        <span>{s.label}</span>{#if s.count}<b>{s.count}</b>{/if}
      </button>
    {/each}
    <hr />
    <button class="sec" onclick={() => { ui.settingsSection = 'repos'; go('settings'); }}><span>Repositories</span></button>
    <button class="sec" onclick={loadStore} data-pt="store-refresh"><span>{store.loading ? 'Looking…' : 'Look again'}</span></button>
  </nav>

  <div class="main scroll-y" data-vscroll>
    {#if shown}
      <section class="top">
        <div class="big" style="--c: {shown.color}">{#if shown.icon}<img src={shown.icon} alt="" />{/if}</div>
        <div>
          <h1>{shown.name}</h1>
          <p class="sub">{shown.subtitle || shown.description.split('. ')[0]}</p>
          <p class="meta">{shown.kind === 'app' ? 'Launcher app' : 'Android app'}{shown.author ? ` by ${shown.author}` : ''}{shown.version ? `, version ${shown.version}` : ''}</p>
        </div>
      </section>
    {/if}

    {#each store.repos.filter((r) => r.error) as r}
      <p class="warn">Couldn’t read {r.url}: {r.error}</p>
    {/each}

    {#if !store.loaded}
      <p class="empty">Looking in the repositories…</p>
    {:else if !list.length}
      <p class="empty">{section === 'updates' ? 'Everything is up to date.' : section === 'installed' ? 'Nothing from the Store is installed yet.' : 'The repositories have nothing of this kind.'}</p>
    {/if}

    <div class="grid" data-pt="store-grid">
      {#each list as e (e.key)}
        {@const st = statusOf(e)}
        <div class="entry">
          <button class="box" data-pt="store-entry" data-key={e.key} onfocus={() => (selected = e)} onmouseenter={() => (selected = e)} onclick={() => show(e)} aria-label={e.name}>
            {#if e.icon}<img src={e.icon} alt="" loading="lazy" />{/if}
            {#if st.update}<span class="badge up" title="Update"><Icon name="download" size="1rem" /></span>
            {:else if st.installed}<span class="badge" title="Installed"><Icon name="check" size="1rem" /></span>{/if}
          </button>
          <span class="name">{e.name}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

{#if open}
  {@const st = statusOf(open)}
  <div class="veil" role="presentation" onclick={() => (open = null)}></div>
  <div class="sheet glass" data-scope bind:this={sheet} role="dialog" aria-label={open.name} data-pt="store-sheet">
    <div class="sheet-top">
      <div class="big" style="--c: {open.color}">{#if open.icon}<img src={open.icon} alt="" />{/if}</div>
      <div>
        <h2>{open.name}</h2>
        <p class="meta">{open.kind === 'app' ? `Launcher app, opens ${open.mode === 'window' ? 'in a window' : 'full screen'}` : 'Android app'}{open.author ? ` · by ${open.author}` : ''}</p>
        <p class="meta">Version {open.version || '?'}{st.installed && st.update ? `, you have ${st.installed.version || st.installed.versionName || 'an older one'}` : ''}{open.size ? ` · ${sizeOf(open.size)}` : ''}</p>
      </div>
    </div>
    <p class="desc">{open.description}</p>
    <div class="actions">
      {#if store.busy[open.key]}
        <button class="btn" disabled>{store.busy[open.key] === 'installing' ? 'Installing…' : 'Removing…'}</button>
      {:else if !st.installed}
        <button class="btn primary" data-autofocus data-pt="install" onclick={() => doInstall(open)}><Icon name="download" size="1.3rem" />Install</button>
      {:else}
        {#if st.update}<button class="btn primary" data-autofocus data-pt="update" onclick={() => doInstall(open)}><Icon name="download" size="1.3rem" />Update</button>{/if}
        <button class="btn" data-autofocus={st.update ? undefined : ''} data-pt="open" onclick={() => openInstalled(open)}><Icon name="open" size="1.2rem" />Open</button>
        <button class="btn danger" data-pt="remove" onclick={() => doRemove(open)}><Icon name="trash" size="1.2rem" />{open.kind === 'app' ? 'Remove' : 'Uninstall'}</button>
      {/if}
      <button class="btn" onclick={() => (open = null)}>Close</button>
    </div>
    {#if open.kind === 'apk' && !st.installed && !note}<p class="note">Android asks you to confirm before it installs an app.</p>{/if}
    {#if note}<p class="note" data-pt="store-note">{note}</p>{/if}
  </div>
{/if}

<style>
  .page { position: absolute; inset: 0; padding: 9.5rem var(--gutter) 0; display: grid; grid-template-columns: 19rem 1fr; gap: 2.5rem; }
  .side { display: flex; flex-direction: column; gap: 0.3rem; padding-top: 0.6rem; }
  .sec { display: flex; justify-content: space-between; align-items: center; padding: 0.9rem 1.4rem; border-radius: 1rem; font-size: 1.2rem; color: var(--dim); }
  .sec.on { background: rgba(255, 255, 255, 0.12); color: var(--ink); }
  .sec:focus { background: var(--ink); color: #0d1220; }
  .sec b { font-weight: 500; background: var(--accent); color: #06221e; border-radius: 999px; padding: 0 0.6rem; font-size: 0.95rem; }
  hr { border: 0; border-top: 1px solid var(--glass-line); margin: 0.8rem 1rem; width: calc(100% - 2rem); }
  .main { min-height: 0; padding: 0.6rem 1rem 4rem; }
  .top { display: flex; align-items: center; gap: 2.4rem; margin-bottom: 2.6rem; min-height: 11rem; }
  .big { flex: none; width: 10rem; aspect-ratio: 1; border-radius: 2.2rem; display: grid; place-items: center; background: var(--c); border: 1px solid rgba(255, 255, 255, 0.14); }
  .big img { width: 62%; height: 62%; object-fit: contain; }
  h1 { margin: 0; font-size: 3rem; font-weight: 380; }
  .sub { margin: 0.4rem 0 0; font-size: 1.35rem; color: var(--dim); max-width: 50rem; }
  .meta { margin: 0.4rem 0 0; font-size: 1rem; color: var(--faint); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 13.5rem); gap: 2rem; }
  .entry { display: flex; flex-direction: column; align-items: center; gap: 0.8rem; }
  .box {
    position: relative;
    width: 100%;
    aspect-ratio: 1.45;
    border-radius: var(--radius);
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid var(--glass-line);
    transition: transform 0.18s, box-shadow 0.18s, background 0.18s;
  }
  .box img { width: 38%; aspect-ratio: 1; object-fit: contain; }
  .box:focus { transform: scale(1.07); background: rgba(255, 255, 255, 0.16); box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.85); }
  .badge { position: absolute; top: 0.7rem; right: 0.7rem; width: 1.8rem; height: 1.8rem; border-radius: 50%; display: grid; place-items: center; background: #3ddc84; color: #032611; }
  .badge.up { background: var(--accent); color: #06221e; }
  .name { font-size: 1.05rem; color: var(--dim); text-align: center; }
  .entry:focus-within .name { color: var(--ink); }
  .empty, .warn { font-size: 1.2rem; color: var(--dim); }
  .warn { color: #ffb4a8; font-size: 1rem; }

  .veil { position: fixed; inset: 0; z-index: 20; background: rgba(3, 5, 10, 0.55); }
  .sheet {
    position: fixed;
    z-index: 21;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(62rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100vh - 6rem);
    overflow: auto;
    padding: 3rem;
    border-radius: 2.4rem;
    background: var(--panel);
  }
  .sheet-top { display: flex; gap: 2rem; align-items: center; }
  .sheet h2 { margin: 0; font-size: 2.6rem; font-weight: 380; }
  .desc { font-size: 1.2rem; color: var(--dim); line-height: 1.55; max-width: 52rem; margin: 2rem 0; }
  .actions { display: flex; gap: 1rem; flex-wrap: wrap; }
  .note { margin: 1.4rem 0 0; color: var(--dim); font-size: 1.05rem; }

  @media (max-aspect-ratio: 1/1) {
    .page { grid-template-columns: 1fr; grid-template-rows: auto 1fr; padding-top: 12rem; gap: 1rem; }
    .side { flex-direction: row; overflow-x: auto; scrollbar-width: none; }
    .sec { flex: none; }
    hr { display: none; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr)); }
  }
</style>
