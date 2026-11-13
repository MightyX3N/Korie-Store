<script>
  import { tick } from 'svelte';
  import AppTile from '../components/AppTile.svelte';
  import ItemCard from '../components/ItemCard.svelte';
  import { apps, homeRows, pinnedApps, recents, appByKey, movePin } from '../lib/state.svelte.js';
  import { ui } from '../lib/ui.svelte.js';
  import { onBack, focusFirst } from '../lib/nav.js';

  const rows = $derived(homeRows().filter((r) => r.on));
  const pinned = $derived(pinnedApps());
  const recent = $derived(recents.list.map((r) => appByKey(r.key)).filter(Boolean).slice(0, 12));

  const focusApp = (app) => { if (!ui.moving) ui.focus = { kind: 'app', app }; };
  const focusItem = (item, app, shape) => (ui.focus = { kind: 'item', item, app, shape });

  // What the big title shows: what's selected, or the first app.
  const shown = $derived(ui.focus && (ui.focus.kind === 'item' || apps.list.some((a) => a.key === ui.focus.app.key)) ? ui.focus : pinned[0] ? { kind: 'app', app: pinned[0] } : null);

  let page;
  $effect(() => {
    if (!apps.loaded) return;
    tick().then(() => {
      if (!page || page.contains(document.activeElement)) return;
      if (ui.quick || ui.menu) return;
      const el = page.querySelector(`[data-key="${CSS.escape(ui.focus?.app?.key || '')}"]`) || null;
      if (el) el.focus({ preventScroll: true }); else focusFirst(page);
    });
  });

  // Moving an app along the home row: left and right move it, OK or Back puts it down.
  $effect(() => {
    if (!ui.moving) return;
    const key = ui.moving;
    const keydown = async (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault(); e.stopPropagation();
        movePin(key, e.key === 'ArrowLeft' ? -1 : 1);
        await tick();
        const el = page?.querySelector(`[data-key="${CSS.escape(key)}"]`);
        el?.focus({ preventScroll: true });
        el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      } else if (e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        ui.moving = null;
      }
    };
    document.addEventListener('keydown', keydown, true);
    const off = onBack(() => { ui.moving = null; return true; });
    const el = page?.querySelector(`[data-key="${CSS.escape(key)}"]`);
    el?.focus({ preventScroll: true });
    return () => { document.removeEventListener('keydown', keydown, true); off(); };
  });
</script>

<div class="home" bind:this={page}>
  <section class="hero" aria-live="polite">
    {#if shown}
      <div class="words">
        <h1 data-pt="hero-title">{shown.kind === 'item' ? shown.item.title : shown.app.name}</h1>
        <p>{shown.kind === 'item' ? shown.item.subtitle || shown.app.name : shown.app.subtitle}</p>
      </div>
      {#if shown.kind === 'item' && shown.item.image}
        <div class="art {shown.shape || 'wide'}"><img src={shown.item.image} alt="" /></div>
      {:else}
        {@const app = shown.kind === 'item' ? shown.app : shown.app}
        <div class="art" style="--c: {app.color}">
          {#if app.icon}<img src={app.icon} alt="" />{/if}
        </div>
      {/if}
    {/if}
  </section>

  <div class="rows scroll-y" data-vscroll="rows">
    {#if apps.loaded && !pinned.length && !rows.some((r) => r.id !== 'apps')}
      <p class="empty">No apps on the home row yet. Open <b>Apps</b> and pin some, or get some from the <b>Store</b>.</p>
    {/if}
    {#each rows as row (row.id)}
      {#if row.id === 'apps'}
        {#if pinned.length}
          <section class="row" data-vrow data-pt="row-apps">
            <h2 class="eyebrow">Apps</h2>
            <div class="line scroll-x apps" data-row>
              {#each pinned as app, i (app.key)}
                <AppTile {app} onfocus={focusApp} moving={ui.moving === app.key} autofocus={i === 0} />
              {/each}
            </div>
          </section>
        {/if}
      {:else if row.id === 'recents'}
        {#if recent.length}
          <section class="row" data-vrow data-pt="row-recents">
            <h2 class="eyebrow">Recently used</h2>
            <div class="line scroll-x" data-row>
              {#each recent as app (app.key)}<AppTile {app} size="small" onfocus={focusApp} />{/each}
            </div>
          </section>
        {/if}
      {:else if row.row?.items?.length}
        <section class="row" data-vrow data-pt="row-{row.id}">
          <h2 class="eyebrow">{row.title}</h2>
          <div class="line scroll-x" data-row>
            {#each row.row.items as item (item.id)}
              <ItemCard {item} app={row.app} shape={row.row.shape} onfocus={focusItem} />
            {/each}
          </div>
        </section>
      {/if}
    {/each}
  </div>
</div>

<style>
  .home { position: absolute; inset: 0; display: flex; flex-direction: column; padding-top: 8rem; }
  .hero {
    flex: none;
    height: 26rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 3rem;
    padding: 0 calc(var(--gutter) + 1rem);
  }
  .words { min-width: 0; }
  h1 {
    margin: 0;
    font-size: 6rem;
    font-weight: 380;
    line-height: 1.05;
    letter-spacing: -0.02em;
    text-shadow: 0 0.2rem 2rem rgba(0, 0, 0, 0.35);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .words p { margin: 0.8rem 0 0; font-size: 1.6rem; color: var(--dim); max-width: 50rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .art {
    flex: none;
    width: 18rem;
    aspect-ratio: 1;
    border-radius: 3.2rem;
    display: grid;
    place-items: center;
    background: linear-gradient(165deg, color-mix(in srgb, var(--c) 82%, white 8%), color-mix(in srgb, var(--c) 60%, black 30%));
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 2rem 5rem rgba(0, 0, 0, 0.35);
  }
  @supports not (background: color-mix(in srgb, red, blue)) { .art { background: var(--c); } }
  .art img { width: 50%; height: 50%; object-fit: contain; border-radius: 22%; }
  .art.wide { width: 34rem; aspect-ratio: 16 / 9; border-radius: 1.6rem; overflow: hidden; background: rgba(0, 0, 0, 0.3); }
  .art.wide img, .art.poster img, .art.square img { width: 100%; height: 100%; object-fit: cover; border-radius: 0; }
  .art.poster { width: 13rem; aspect-ratio: 2 / 3; border-radius: 1.4rem; overflow: hidden; background: rgba(0, 0, 0, 0.3); }
  .art.square { width: 19rem; aspect-ratio: 1; border-radius: 1.4rem; overflow: hidden; background: rgba(0, 0, 0, 0.3); }

  .rows { flex: 1; min-height: 0; padding: 0 0 4rem; }
  .row { margin-bottom: 2.2rem; }
  .row .eyebrow { padding: 0 calc(var(--gutter) + 1rem); }
  .line { display: flex; gap: 2rem; padding: 1.2rem calc(var(--gutter) + 1rem) 1.4rem; scroll-padding: 0 calc(var(--gutter) + 1rem); }
  .empty { padding: 0 calc(var(--gutter) + 1rem); font-size: 1.3rem; color: var(--dim); }

  @media (max-aspect-ratio: 1/1) {
    .home { padding-top: 11rem; }
    .hero { height: auto; padding-top: 1rem; padding-bottom: 2rem; }
    h1 { font-size: 3.4rem; }
    .words p { font-size: 1.2rem; }
    .art { width: 9rem; border-radius: 2rem; }
    .art.wide { width: 14rem; }
    /* Upright: the apps wrap into a grid you scroll down, like a phone's home screen. */
    .line.apps { flex-wrap: wrap; gap: 1.4rem; }
    .line.apps :global(.tile) { width: calc(50% - 0.7rem); }
  }
</style>
