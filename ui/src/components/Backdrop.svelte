<script>
  // The picture behind everything. It follows what's selected on the home screen and
  // fades from one picture to the next.
  import { ui } from '../lib/ui.svelte.js';
  import { backgroundFor, pinnedApps, settings } from '../lib/state.svelte.js';

  const want = $derived.by(() => {
    settings.bg; settings.bgMode; settings.appBg;
    const f = ui.focus;
    if (f?.kind === 'item' && f.item.backdrop) return f.item.backdrop;
    const app = f?.app || pinnedApps()[0];
    return backgroundFor(app);
  });

  let layers = $state([]); // [{ src, id }]
  let seq = 0;
  let timer;
  $effect(() => {
    const src = want;
    clearTimeout(timer);
    // Wait a moment so moving quickly along a row doesn't load every picture.
    timer = setTimeout(() => {
      if (layers.length && layers[layers.length - 1].src === src) return;
      const img = new Image();
      img.onload = img.onerror = () => {
        layers = [...layers.slice(-1), { src, id: ++seq }];
      };
      img.src = src;
    }, layers.length ? 260 : 0);
    return () => clearTimeout(timer);
  });
</script>

<div class="backdrop" aria-hidden="true">
  {#each layers as l (l.id)}
    <div class="layer" style="background-image: url('{l.src}')"></div>
  {/each}
  <div class="shade" class:dim={ui.page !== 'home'}></div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; z-index: 0; background: var(--shade); }
  .layer {
    position: absolute;
    inset: 0;
    background-size: cover;
    background-position: center;
    animation: fade 0.6s ease both;
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  .shade {
    position: absolute;
    inset: 0;
    background:
      linear-gradient(90deg, rgba(5, 8, 15, 0.72) 0%, rgba(5, 8, 15, 0.25) 55%, rgba(5, 8, 15, 0.1) 100%),
      linear-gradient(0deg, rgba(5, 8, 15, 0.82) 0%, rgba(5, 8, 15, 0.15) 50%, rgba(5, 8, 15, 0.35) 100%);
    transition: background-color 0.3s;
  }
  .shade.dim { background-color: rgba(5, 8, 15, 0.55); }
</style>
