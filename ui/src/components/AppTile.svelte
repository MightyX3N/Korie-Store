<script>
  import { ui } from '../lib/ui.svelte.js';
  import { launch } from '../lib/launch.js';

  let { app, size = 'normal', onfocus = () => {}, moving = false, autofocus = false } = $props();

  function menu(e) {
    e.preventDefault();
    ui.menu = { app };
  }
</script>

<div class="tile {size}" class:moving>
  <button
    class="body"
    style="--c: {app.color}"
    data-hold
    data-pt="tile"
    data-key={app.key}
    data-autofocus={autofocus ? '' : undefined}
    onfocus={() => onfocus(app)}
    onmouseenter={() => onfocus(app)}
    onclick={() => (ui.moving ? null : launch(app))}
    oncontextmenu={menu}
    aria-label={app.name}
  >
    {#if app.banner}
      <img class="banner" src={app.banner} alt="" loading="lazy" />
    {:else if app.icon}
      <img class="icon" src={app.icon} alt="" loading="lazy" />
    {:else}
      <span class="letter">{app.name.slice(0, 1)}</span>
    {/if}
    {#if moving}<span class="arrows" aria-hidden="true">‹ ›</span>{/if}
  </button>
  <span class="name">{app.name}</span>
</div>

<style>
  .tile { flex: none; width: 17rem; display: flex; flex-direction: column; align-items: center; gap: 0.9rem; }
  .tile.small { width: 14.5rem; }
  .body {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9.4;
    border-radius: var(--radius);
    display: grid;
    place-items: center;
    background: linear-gradient(165deg, color-mix(in srgb, var(--c) 78%, white 6%), color-mix(in srgb, var(--c) 62%, black 30%));
    border: 1px solid rgba(255, 255, 255, 0.1);
    box-shadow: 0 0.6rem 1.6rem rgba(0, 0, 0, 0.25);
    overflow: hidden;
    transition: transform 0.18s ease, box-shadow 0.18s, border-color 0.18s;
  }
  @supports not (background: color-mix(in srgb, red, blue)) {
    .body { background: var(--c); }
  }
  .body:focus, .moving .body {
    transform: scale(1.09);
    border-color: rgba(255, 255, 255, 0.55);
    box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.45), 0 0 0 0.2rem rgba(255, 255, 255, 0.85);
  }
  .moving .body { box-shadow: 0 0 0 0.25rem var(--accent), 0 1.2rem 3rem rgba(0, 0, 0, 0.45); }
  .icon { width: 36%; aspect-ratio: 1; object-fit: contain; border-radius: 22%; filter: drop-shadow(0 0.3rem 0.6rem rgba(0, 0, 0, 0.25)); }
  .banner { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .letter { font-size: 3.4rem; font-weight: 500; }
  .arrows { position: absolute; bottom: 0.5rem; font-size: 1.6rem; color: var(--ink); }
  .name { font-size: 1.15rem; color: var(--dim); max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color 0.15s; }
  .tile:focus-within .name { color: var(--ink); }
</style>
