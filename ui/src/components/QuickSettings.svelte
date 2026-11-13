<script>
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { ui, go } from '../lib/ui.svelte.js';
  import { quick, refreshStatus, setVolume, toggleMute } from '../lib/quick.svelte.js';
  import { use24h, settings, device } from '../lib/state.svelte.js';
  import { call } from '../lib/native.js';
  import { onBack, focusFirst } from '../lib/nav.js';
  import { toast } from '../lib/toast.svelte.js';

  let panel;
  let now = $state(new Date());

  $effect(() => {
    const before = document.activeElement;
    refreshStatus();
    const t = setInterval(() => { now = new Date(); refreshStatus(); }, 5000);
    const off = onBack(() => { ui.quick = false; return true; });
    tick().then(() => focusFirst(panel));
    return () => { clearInterval(t); off(); if (before?.isConnected && ui.page === 'home') before.focus({ preventScroll: true }); };
  });

  const time = $derived.by(() => { settings.clock; return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24h() }); });
  const date = $derived(now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }));
  const net = $derived(quick.status?.network);
  const netText = $derived(!net ? '…' : !net.connected ? 'Not connected' : net.type === 'ethernet' ? 'Ethernet' : net.type === 'wifi' ? net.name || 'Wi‑Fi' : net.type === 'cellular' ? 'Mobile data' : 'Connected');
  const bt = $derived(quick.status?.bluetooth);
  const btText = $derived(!bt ? 'Not available' : !bt.on ? 'Off' : bt.device || 'On');
  const vol = $derived(quick.volume);
  const pct = $derived(vol ? Math.round(((vol.muted ? 0 : vol.level) / vol.max) * 100) : 0);

  async function open(page) {
    try { await call('settings.open', { page }); ui.quick = false; } catch (e) { toast(e.message); }
  }

  function volKey(e) {
    if (!vol) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      setVolume(vol.level + (e.key === 'ArrowRight' ? 1 : -1));
    }
  }
  function volClick(e) {
    if (!vol) return;
    const r = e.currentTarget.querySelector('.track').getBoundingClientRect();
    const f = (e.clientX - r.left) / r.width;
    if (f >= 0 && f <= 1) setVolume(Math.round(f * vol.max));
  }
</script>

<div class="veil" role="presentation" onclick={() => (ui.quick = false)}></div>
<aside class="panel glass" data-scope bind:this={panel} aria-label="Quick settings" data-pt="quick">
  <div class="clock">
    <div class="t">{time}</div>
    <div class="d">{date}</div>
  </div>

  <div class="tiles">
    <button class="tile" data-autofocus onclick={() => open('wifi')} data-pt="qs-network">
      <span class="dot" class:on={net?.connected}><Icon name={!net?.connected ? 'offline' : net.type === 'ethernet' ? 'ethernet' : 'wifi'} size="1.5rem" /></span>
      <span><b>Network</b><small>{netText}</small></span>
    </button>
    <button class="tile" onclick={() => open('bluetooth')} data-pt="qs-bluetooth">
      <span class="dot" class:on={bt?.on}><Icon name="bluetooth" size="1.5rem" /></span>
      <span><b>Bluetooth</b><small>{btText}</small></span>
    </button>
    <button class="tile" onclick={toggleMute} data-pt="qs-mute">
      <span class="dot" class:on={vol?.muted}><Icon name="mute" size="1.5rem" /></span>
      <span><b>Mute</b><small>{vol?.muted ? 'On' : 'Off'}</small></span>
    </button>
    <button class="tile" onclick={() => open('display')}>
      <span class="dot"><Icon name="display" size="1.5rem" /></span>
      <span><b>Display</b><small>Picture and resolution</small></span>
    </button>
    <button class="tile" onclick={() => { go('settings'); }} data-pt="qs-settings">
      <span class="dot"><Icon name="settings" size="1.5rem" /></span>
      <span><b>Launcher</b><small>Look, rows, Store</small></span>
    </button>
    <button class="tile" onclick={() => open('all')} data-pt="qs-device">
      <span class="dot"><Icon name="android" size="1.5rem" /></span>
      <span><b>Device</b><small>{device.platform === 'android' ? 'Android settings' : 'All settings'}</small></span>
    </button>
  </div>

  <div class="volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax={vol?.max ?? 0} aria-valuenow={vol?.level ?? 0} data-pt="qs-volume" onkeydown={volKey} onclick={volClick}>
    <Icon name={vol?.muted ? 'mute' : 'volume'} size="1.5rem" />
    <span class="track"><span class="fill" style="width: {pct}%"></span></span>
    <span class="pct">{pct}%</span>
  </div>
</aside>

<style>
  .veil { position: fixed; inset: 0; z-index: 30; background: rgba(3, 5, 10, 0.5); }
  .panel {
    position: fixed;
    z-index: 31;
    top: 1.6rem;
    right: 1.6rem;
    width: 38rem;
    max-width: calc(100vw - 3.2rem);
    max-height: calc(100vh - 3.2rem);
    overflow: auto;
    padding: 2.6rem 2.4rem 2.4rem;
    border-radius: 2.4rem;
    background: var(--panel);
    animation: in 0.2s ease both;
  }
  @keyframes in { from { opacity: 0; transform: translateX(2rem); } }
  .t { font-size: 4.2rem; font-weight: 340; line-height: 1; font-variant-numeric: tabular-nums; }
  .d { margin-top: 0.7rem; font-size: 1.25rem; color: var(--dim); }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin: 2.2rem 0 1.2rem; }
  .tile {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1.3rem 1.2rem;
    min-height: 6.6rem;
    border-radius: 1.6rem;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--glass-line);
    transition: background 0.15s, transform 0.15s;
  }
  .tile:hover { background: rgba(255, 255, 255, 0.1); }
  .tile:focus { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.5); transform: scale(1.03); }
  .tile > span:last-child { display: flex; flex-direction: column; min-width: 0; }
  .tile b { font-weight: 400; font-size: 1.2rem; }
  .tile small { font-size: 0.98rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { flex: none; width: 3.2rem; height: 3.2rem; border-radius: 50%; display: grid; place-items: center; background: rgba(255, 255, 255, 0.1); }
  .dot.on { background: var(--accent); color: #06221e; }
  .volume { display: flex; align-items: center; gap: 1.2rem; padding: 1.2rem 1.6rem; border-radius: 999px; background: rgba(255, 255, 255, 0.06); border: 1px solid var(--glass-line); cursor: pointer; }
  .volume:focus { border-color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.14); }
  .track { flex: 1; height: 0.45rem; border-radius: 1rem; background: rgba(255, 255, 255, 0.18); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); transition: width 0.15s; }
  .pct { width: 3.4rem; text-align: right; font-variant-numeric: tabular-nums; color: var(--dim); }
</style>
