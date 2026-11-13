<script>
  import { launch } from '../lib/launch.js';

  let { item, app, shape = 'wide', onfocus = () => {} } = $props();
</script>

<div class="card {shape}">
  <button class="pic" data-pt="item" onfocus={() => onfocus(item, app, shape)} onmouseenter={() => onfocus(item, app, shape)} onclick={() => launch(app, { open: item.id })} aria-label={item.title}>
    {#if item.image}<img src={item.image} alt="" loading="lazy" />{:else}<span class="none">{item.title}</span>{/if}
    {#if item.progress != null}<span class="bar"><span style="width: {Math.round(item.progress * 100)}%"></span></span>{/if}
  </button>
  <span class="title">{item.title}</span>
</div>

<style>
  .card { flex: none; width: 21rem; display: flex; flex-direction: column; gap: 0.7rem; }
  .card.poster { width: 11.5rem; }
  .card.square { width: 14rem; }
  .pic {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: 1rem;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.08);
    transition: transform 0.18s ease, box-shadow 0.18s;
  }
  .poster .pic { aspect-ratio: 2 / 3; }
  .square .pic { aspect-ratio: 1; }
  .pic:focus { transform: scale(1.06); box-shadow: 0 0 0 0.2rem rgba(255, 255, 255, 0.9), 0 1rem 2.4rem rgba(0, 0, 0, 0.5); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .none { display: grid; place-items: center; height: 100%; padding: 1rem; text-align: center; color: var(--dim); }
  .bar { position: absolute; left: 0.8rem; right: 0.8rem; bottom: 0.7rem; height: 0.3rem; border-radius: 1rem; background: rgba(255, 255, 255, 0.3); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--accent); }
  .title { font-size: 1.05rem; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card:focus-within .title { color: var(--ink); }
</style>
