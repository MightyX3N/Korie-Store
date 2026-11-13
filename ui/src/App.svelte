<script>
  import { onMount } from 'svelte';
  import TopBar from './components/TopBar.svelte';
  import Backdrop from './components/Backdrop.svelte';
  import QuickSettings from './components/QuickSettings.svelte';
  import AppMenu from './components/AppMenu.svelte';
  import Runner from './components/Runner.svelte';
  import Toasts from './components/Toasts.svelte';
  import Home from './pages/Home.svelte';
  import Apps from './pages/Apps.svelte';
  import Recents from './pages/Recents.svelte';
  import Store from './pages/Store.svelte';
  import Search from './pages/Search.svelte';
  import Settings from './pages/Settings.svelte';
  import { ui, go } from './lib/ui.svelte.js';
  import { device, loadDevice, loadApps, applyLook } from './lib/state.svelte.js';
  import { runner, syncServices, refreshAllRows, backToApp, closeApp } from './lib/runtime.svelte.js';
  import { refreshStatus } from './lib/quick.svelte.js';
  import { installKeys, setBackFallback, focusFirst, back } from './lib/nav.js';
  import { on, call } from './lib/native.js';

  applyLook();
  installKeys();

  // Back with nothing open: go to Home; on Home, leave (unless this is the home app).
  setBackFallback(() => {
    if (backToApp()) return true;
    if (ui.page !== 'home') { go('home'); return true; }
    if (device.platform === 'android' && !device.home?.isDefault) call('exit').catch(() => {});
    return true;
  });

  async function reload() {
    await loadApps();
    syncServices();
  }

  onMount(() => {
    loadDevice();
    reload();
    refreshStatus();
    const offs = [
      on('back', () => back()),
      // Home pressed while PlayBigScreen is the home app: close what's open, show Home.
      on('home', () => { closeApp(); ui.quick = false; ui.menu = null; go('home'); }),
      on('resume', () => { reload(); refreshStatus(); refreshAllRows(); }),
      on('apps-changed', reload),
      // The remote's menu key: options for what's selected.
      on('menu', () => document.activeElement?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))),
    ];
    const t = setInterval(refreshAllRows, 10 * 60 * 1000);
    return () => { offs.forEach((f) => f()); clearInterval(t); };
  });

  // Something pressed or clicked on nothing: put focus back on the page.
  function stray(e) {
    if (document.activeElement === document.body && /^Arrow/.test(e.key)) focusFirst();
  }
</script>

<svelte:window onkeydown={stray} />

<Backdrop />
<div class="shell" inert={!!runner.app && runner.app.mode === 'fullscreen' ? true : undefined}>
  <TopBar />
  <main>
    {#if ui.page === 'home'}<Home />
    {:else if ui.page === 'apps'}<Apps />
    {:else if ui.page === 'recents'}<Recents />
    {:else if ui.page === 'store'}<Store />
    {:else if ui.page === 'search'}<Search />
    {:else if ui.page === 'settings'}<Settings />{/if}
  </main>
</div>
{#if ui.quick}<QuickSettings />{/if}
{#if ui.menu}<AppMenu />{/if}
<Runner />
<Toasts />

<style>
  .shell { position: fixed; inset: 0; z-index: 1; }
  main { position: absolute; inset: 0; }
</style>
