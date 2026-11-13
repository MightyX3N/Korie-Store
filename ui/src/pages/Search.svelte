<script>
  import { tick } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import AppTile from '../components/AppTile.svelte';
  import ItemCard from '../components/ItemCard.svelte';
  import { apps } from '../lib/state.svelte.js';
  import { searchApps } from '../lib/runtime.svelte.js';
  import { ui } from '../lib/ui.svelte.js';

  let q = $state(ui.lastQuery || '');
  let results = $state([]); // [{ app, items }]
  let looking = $state(false);
  let input;
  let seq = 0;

  const norm = (s) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const appHits = $derived(q.trim() ? apps.list.filter((a) => norm(a.name).includes(norm(q.trim()))) : []);

  $effect(() => {
    const query = q.trim();
    ui.lastQuery = q;
    const my = ++seq;
    if (query.length < 2) { results = []; looking = false; return; }
    looking = true;
    const t = setTimeout(async () => {
      const r = await searchApps(query);
      if (my === seq) { results = r; looking = false; }
    }, 350);
    return () => clearTimeout(t);
  });

  $effect(() => { tick().then(() => input?.focus()); });
</script>

<div class="page scroll-y" data-vscroll>
  <label class="box glass">
    <Icon name="search" size="1.8rem" />
    <input bind:this={input} bind:value={q} data-pt="search-input" placeholder="Search apps, films, games…" autocomplete="off" spellcheck="false" enterkeyhint="search" />
  </label>

  {#if appHits.length}
    <section>
      <h2 class="eyebrow">Apps</h2>
      <div class="line scroll-x" data-row data-pt="search-apps">
        {#each appHits as app (app.key)}<AppTile {app} size="small" />{/each}
      </div>
    </section>
  {/if}

  {#each results as r (r.app.id)}
    <section>
      <h2 class="eyebrow">In {r.app.name}</h2>
      <div class="line scroll-x" data-row data-pt="search-{r.app.id}">
        {#each r.items as item (item.id)}<ItemCard {item} app={r.app} shape="poster" />{/each}
      </div>
    </section>
  {/each}

  {#if q.trim().length >= 2 && !looking && !appHits.length && !results.length}
    <p class="empty">Nothing found for “{q.trim()}”.</p>
  {:else if !q.trim()}
    <p class="empty">Apps that can search, like PlayTheater and RomM, show what they find here too.</p>
  {/if}
</div>

<style>
  .page { position: absolute; inset: 0; padding: 9.5rem 0 4rem; }
  .box { display: flex; align-items: center; gap: 1.2rem; margin: 0 calc(var(--gutter) + 1rem) 2.6rem; padding: 0 2rem; height: 5rem; border-radius: 999px; color: var(--dim); }
  .box:focus-within { border-color: rgba(255, 255, 255, 0.6); color: var(--ink); }
  input { flex: 1; min-width: 0; background: none; border: 0; font-size: 1.6rem; color: var(--ink); user-select: text; }
  input::placeholder { color: var(--faint); }
  section { margin-bottom: 2rem; }
  .eyebrow { padding: 0 calc(var(--gutter) + 1rem); }
  .line { display: flex; gap: 2rem; padding: 1rem calc(var(--gutter) + 1rem) 1.2rem; }
  .empty { padding: 0 calc(var(--gutter) + 1rem); color: var(--dim); font-size: 1.2rem; }
  @media (max-aspect-ratio: 1/1) { .page { padding-top: 12rem; } }
</style>
