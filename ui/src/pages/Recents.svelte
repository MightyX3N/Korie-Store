<script>
  import { tick } from 'svelte';
  import AppTile from '../components/AppTile.svelte';
  import { recents, appByKey, clearRecents, apps } from '../lib/state.svelte.js';
  import { focusFirst } from '../lib/nav.js';

  const list = $derived(recents.list.map((r) => ({ ...r, app: appByKey(r.key) })).filter((r) => r.app));

  function ago(t) {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? 'Yesterday' : `${d} days ago`;
  }

  let page;
  $effect(() => { apps.loaded; tick().then(() => page && !page.contains(document.activeElement) && focusFirst(page)); });
</script>

<div class="page scroll-y" data-vscroll bind:this={page}>
  <div class="head">
    <h1>Recents</h1>
    {#if list.length}<button class="btn" data-pt="clear-recents" onclick={clearRecents}>Clear the list</button>{/if}
  </div>
  {#if list.length}
    <div class="grid" data-pt="recents-grid">
      {#each list as r, i (r.key)}
        <div class="cell">
          <AppTile app={r.app} size="small" autofocus={i === 0} />
          <span class="when">{ago(r.at)}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="empty">Apps you open from PlayBigScreen show up here.</p>
  {/if}
</div>

<style>
  .page { position: absolute; inset: 0; padding: 9.5rem calc(var(--gutter) + 1rem) 4rem; }
  .head { display: flex; align-items: center; gap: 1.6rem; margin-bottom: 2.4rem; }
  h1 { margin: 0; font-size: 3rem; font-weight: 380; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 14.5rem); gap: 2.4rem 2.2rem; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 0.2rem; }
  .when { font-size: 0.95rem; color: var(--faint); }
  .empty { font-size: 1.3rem; color: var(--dim); }
  @media (max-aspect-ratio: 1/1) { .page { padding-top: 12rem; } }
</style>
