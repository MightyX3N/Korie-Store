<script>
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { ui, go } from '../lib/ui.svelte.js';
  import { isPinned, pin, unpin, settings, saveSettings, BACKGROUNDS, bgUrl, loadApps } from '../lib/state.svelte.js';
  import { launch } from '../lib/launch.js';
  import { call } from '../lib/native.js';
  import { syncServices } from '../lib/runtime.svelte.js';
  import { onBack, focusFirst } from '../lib/nav.js';
  import { toast } from '../lib/toast.svelte.js';

  const app = $derived(ui.menu?.app ?? {});
  let view = $state('main'); // main, bg, remove
  let panel;
  let before;

  $effect(() => {
    before = document.activeElement;
    const off = onBack(() => { if (view !== 'main') { view = 'main'; return true; } close(); return true; });
    return () => off();
  });
  $effect(() => { view; tick().then(() => focusFirst(panel)); });

  function close(refocus = true) {
    ui.menu = null;
    if (refocus) tick().then(() => before?.isConnected && before.focus({ preventScroll: true }));
  }

  function setBg(id) {
    const m = { ...settings.appBg };
    if (id) m[app.key] = id; else delete m[app.key];
    settings.appBg = m;
    saveSettings();
    close();
  }

  function toggleHidden() {
    const h = settings.hidden.includes(app.key);
    settings.hidden = h ? settings.hidden.filter((k) => k !== app.key) : [...settings.hidden, app.key];
    saveSettings();
    if (!h) unpin(app.key);
    close();
  }

  async function removeIt() {
    try {
      if (app.kind === 'app') {
        await call('apps.remove', { id: app.id });
        unpin(app.key);
        await loadApps();
        syncServices();
        toast(`${app.name} is removed`);
      } else {
        await call('android.uninstall', { package: app.pkg });
      }
    } catch (e) {
      toast(e.message);
    }
    close(false);
  }

  function move() {
    const key = app.key;
    close(false);
    if (ui.page !== 'home') go('home');
    tick().then(() => (ui.moving = key));
  }
</script>

<div class="veil" role="presentation" onclick={() => close()}></div>
<div class="menu glass" data-scope bind:this={panel} role="menu" aria-label="Options for {app.name}" data-pt="app-menu">
  <div class="head">
    <span class="ic" style="--c: {app.color}">{#if app.icon}<img src={app.icon} alt="" />{/if}</span>
    <div><b>{app.name}</b><small>{app.kind === 'app' ? 'Launcher app' : app.system ? 'System app' : 'Android app'}</small></div>
  </div>

  {#if view === 'main'}
    <button class="item" role="menuitem" data-autofocus onclick={() => { const a = app; close(false); launch(a); }}><Icon name="open" />Open</button>
    {#if app.kind === 'app' && app.manifest.settings}
      <button class="item" role="menuitem" data-pt="menu-app-settings" onclick={() => { const a = app; close(false); launch(a, { open: 'pbs:settings' }); }}><Icon name="settings" />Settings for {app.name}</button>
    {/if}
    {#if isPinned(app.key)}
      <button class="item" role="menuitem" data-pt="menu-move" onclick={move}><Icon name="move" />Move on the home row</button>
      <button class="item" role="menuitem" data-pt="menu-unpin" onclick={() => { unpin(app.key); close(); }}><Icon name="unpin" />Take off the home row</button>
    {:else}
      <button class="item" role="menuitem" data-pt="menu-pin" onclick={() => { pin(app.key); close(); }}><Icon name="pin" />Put on the home row</button>
    {/if}
    <button class="item" role="menuitem" data-pt="menu-bg" onclick={() => (view = 'bg')}><Icon name="image" />Background</button>
    <button class="item" role="menuitem" onclick={toggleHidden}><Icon name={settings.hidden.includes(app.key) ? 'eye' : 'eyeoff'} />{settings.hidden.includes(app.key) ? 'Show in Apps' : 'Hide from Apps'}</button>
    {#if app.kind === 'android'}
      <button class="item" role="menuitem" onclick={() => { const pkg = app.pkg; close(false); call('android.details', { package: pkg }); }}><Icon name="info" />App info</button>
    {/if}
    {#if !app.system}
      <button class="item danger" role="menuitem" data-pt="menu-remove" onclick={() => (view = 'remove')}><Icon name="trash" />{app.kind === 'app' ? 'Remove' : 'Uninstall'}</button>
    {/if}
  {:else if view === 'bg'}
    <p class="q">Background when {app.name} is selected</p>
    <button class="item" data-autofocus onclick={() => setBg('')}><Icon name="check" />{app.background ? 'The app’s own' : 'Like the other apps'}{#if !settings.appBg[app.key]}<em>chosen</em>{/if}</button>
    {#each BACKGROUNDS as b}
      <button class="item" data-pt="menu-bg-{b.id}" onclick={() => setBg(b.id)}><span class="sw" style="background-image: url('{bgUrl(b.id)}')"></span>{b.name}{#if settings.appBg[app.key] === b.id}<em>chosen</em>{/if}</button>
    {/each}
  {:else}
    <p class="q">{app.kind === 'app' ? `Remove ${app.name} and what it saved on this device?` : `Uninstall ${app.name}? Android asks you to confirm.`}</p>
    <button class="item danger" data-pt="menu-remove-yes" onclick={removeIt}><Icon name="trash" />{app.kind === 'app' ? 'Remove' : 'Uninstall'}</button>
    <button class="item" data-autofocus onclick={() => (view = 'main')}><Icon name="back" />Keep it</button>
  {/if}
</div>

<style>
  .veil { position: fixed; inset: 0; z-index: 40; background: rgba(3, 5, 10, 0.55); }
  .menu {
    position: fixed;
    z-index: 41;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 30rem;
    max-width: calc(100vw - 2rem);
    max-height: calc(100vh - 4rem);
    overflow: auto;
    padding: 1.6rem;
    border-radius: 2rem;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .head { display: flex; align-items: center; gap: 1.1rem; padding: 0.4rem 0.6rem 1.2rem; }
  .head b { display: block; font-weight: 420; font-size: 1.35rem; }
  .head small { color: var(--dim); font-size: 0.98rem; }
  .ic { width: 3.6rem; height: 3.6rem; border-radius: 1rem; background: var(--c); display: grid; place-items: center; flex: none; }
  .ic img { width: 66%; height: 66%; object-fit: contain; }
  .item { display: flex; align-items: center; gap: 1rem; padding: 0.95rem 1.1rem; border-radius: 1rem; font-size: 1.15rem; color: var(--ink); }
  .item :global(.icon) { width: 1.4rem; height: 1.4rem; color: var(--dim); }
  .item:hover { background: rgba(255, 255, 255, 0.08); }
  .item:focus { background: var(--ink); color: #0d1220; }
  .item:focus :global(.icon) { color: #0d1220; }
  .item.danger { color: #ffb4a8; }
  .item.danger:focus { background: #ff8a8a; color: #2a0505; }
  .item em { margin-left: auto; font-style: normal; font-size: 0.9rem; color: var(--accent); }
  .item:focus em { color: #0d1220; }
  .sw { width: 2.6rem; height: 1.5rem; border-radius: 0.4rem; background-size: cover; flex: none; }
  .q { margin: 0 0.6rem 0.8rem; color: var(--dim); font-size: 1.05rem; }
</style>
