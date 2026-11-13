<script>
  import Icon from './Icon.svelte';
  import { ui, go } from '../lib/ui.svelte.js';
  import { use24h, settings } from '../lib/state.svelte.js';
  import { quick } from '../lib/quick.svelte.js';

  const pages = [
    { id: 'home', label: 'Home' },
    { id: 'recents', label: 'Recents' },
    { id: 'apps', label: 'Apps' },
    { id: 'store', label: 'Store' },
    { id: 'search', label: 'Search' },
  ];

  let now = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (now = new Date()), 1000 * 15);
    return () => clearInterval(t);
  });
  const time = $derived.by(() => {
    settings.clock;
    return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: !use24h() });
  });
  const netIcon = $derived(!quick.status ? 'wifi' : !quick.status.network?.connected ? 'offline' : quick.status.network.type === 'ethernet' ? 'ethernet' : 'wifi');
</script>

<header class="bar" data-nav-top>
  <div class="brand glass">
    <img src="/logo.svg" alt="" />
    <span>PlayBigScreen</span>
  </div>

  <nav class="tabs glass" data-row aria-label="Pages">
    {#each pages as p}
      <button class="tab" class:on={ui.page === p.id} data-current={ui.page === p.id ? '' : undefined} data-pt="tab-{p.id}" onclick={() => go(p.id)}>
        {p.label}
      </button>
    {/each}
  </nav>

  <button class="status glass" data-pt="status" onclick={() => (ui.quick = true)} aria-label="Quick settings">
    <span class="time">{time}</span>
    <Icon name={netIcon} size="1.25rem" />
    {#if quick.status?.bluetooth?.on}<Icon name="bluetooth" size="1.2rem" />{/if}
    <Icon name={quick.volume?.muted ? 'mute' : 'volume'} size="1.25rem" />
  </button>
</header>

<style>
  .bar {
    position: relative;
    z-index: 5;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem var(--gutter) 0;
  }
  .brand, .tabs, .status { border-radius: 999px; height: 4rem; display: flex; align-items: center; }
  .brand { justify-self: start; gap: 0.9rem; padding: 0 1.6rem 0 0.6rem; font-size: 1.35rem; font-weight: 400; }
  .brand img { width: 2.8rem; height: 2.8rem; border-radius: 0.8rem; }
  .tabs { gap: 0.2rem; padding: 0.35rem; }
  .tab {
    height: 100%;
    padding: 0 1.7rem;
    border-radius: 999px;
    font-size: 1.2rem;
    color: var(--dim);
    transition: background 0.15s, color 0.15s;
  }
  .tab.on { background: rgba(255, 255, 255, 0.14); color: var(--ink); }
  .tab:hover { color: var(--ink); }
  .tab:focus { background: var(--ink); color: #0d1220; }
  .status { justify-self: end; gap: 1rem; padding: 0 1.6rem; color: var(--dim); }
  .status .time { color: var(--ink); font-size: 1.3rem; font-weight: 380; margin-right: 0.4rem; font-variant-numeric: tabular-nums; }
  .status:focus { background: var(--ink); color: #0d1220; }
  .status:focus .time { color: #0d1220; }

  @media (max-aspect-ratio: 1/1) {
    .bar { grid-template-columns: 1fr auto; padding-top: 1.2rem; gap: 0.8rem; }
    .brand span { display: none; }
    .brand { padding: 0 0.6rem; }
    .tabs { grid-column: 1 / -1; grid-row: 2; justify-self: stretch; overflow-x: auto; scrollbar-width: none; }
    .tab { padding: 0 1rem; flex: 1 0 auto; }
    .status { grid-column: 2; grid-row: 1; }
  }
</style>
