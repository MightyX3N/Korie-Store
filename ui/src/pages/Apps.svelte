<script>
  import { tick } from 'svelte';
  import AppTile from '../components/AppTile.svelte';
  import { apps, settings } from '../lib/state.svelte.js';
  import { focusFirst } from '../lib/nav.js';

  let showHidden = $state(false);
  const list = $derived(apps.list.filter((a) => showHidden || !settings.hidden.includes(a.key)));
  const hiddenCount = $derived(apps.list.filter((a) => settings.hidden.includes(a.key)).length);

  let page;
  $effect(() => { apps.loaded; tick().then(() => page && !page.contains(document.activeElement) && focusFirst(page)); });
</script>

<div class="page scroll-y" data-vscroll bind:this={page}>
  <div class="head">
    <h1>Apps</h1>
    <p>{list.length} {list.length === 1 ? 'app' : 'apps'} · hold OK on one for its options</p>
    {#if hiddenCount}
      <button class="btn" onclick={() => (showHidden = !showHidden)}>{showHidden ? 'Leave out hidden apps' : `Show hidden apps (${hiddenCount})`}</button>
    {/if}
  </div>
  <div class="grid" data-pt="apps-grid">
    {#each list as app, i (app.key)}
      <AppTile {app} size="small" autofocus={i === 0} />
    {/each}
  </div>
</div>

<style>
  .page { position: absolute; inset: 0; padding: 9.5rem calc(var(--gutter) + 1rem) 4rem; }
  .head { display: flex; align-items: baseline; gap: 1.6rem; margin-bottom: 2.4rem; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 3rem; font-weight: 380; }
  .head p { margin: 0; color: var(--dim); font-size: 1.15rem; flex: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, 14.5rem); gap: 2.4rem 2.2rem; justify-content: start; }
  @media (max-aspect-ratio: 1/1) { .page { padding-top: 12rem; } .grid { grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); } .grid :global(.tile) { width: auto; } }
</style>
