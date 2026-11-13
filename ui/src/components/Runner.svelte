<script>
  import { tick } from 'svelte';
  import Icon from './Icon.svelte';
  import { runner, serviceList, registerFrame, unregisterFrame, closeApp, closeWeb, closeVideo } from '../lib/runtime.svelte.js';
  import { apps, settings } from '../lib/state.svelte.js';

  // Frames can do what a web app needs but can't move the launcher page itself.
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock';
  const ALLOW = 'autoplay; fullscreen; encrypted-media; gamepad; picture-in-picture';

  function frame(node, { key, appId, kind }) {
    const app = apps.list.find((a) => a.kind === 'app' && a.id === appId);
    const origin = app ? new URL(app.url).origin : 'null';
    registerFrame(key, node.contentWindow, origin, appId, kind);
    return { destroy() { unregisterFrame(key); } };
  }

  let before = null;
  let mainFrame = $state();
  let video = $state();

  $effect(() => {
    if (!runner.app) return;
    before = document.activeElement;
    tick().then(() => mainFrame?.focus());
    return () => tick().then(() => before?.isConnected && before.focus({ preventScroll: true }));
  });

  $effect(() => {
    if (!video || !runner.video) return;
    if (runner.video.start) video.currentTime = runner.video.start;
    video.focus();
  });

  // Dimming (for cars), from Settings → Videos.
  const dark = $derived(runner.video?.dimmed ? (settings.dimDark || 0) / 100 : 0);
  const blur = $derived(runner.video?.dimmed ? [0, 10, 28][settings.dimBlur || 0] : 0);

  function stopVideo(ended = false) {
    closeVideo(video?.currentTime || 0, video?.duration || 0, ended);
  }
</script>

<!-- Apps that add home rows or search keep a hidden frame loaded. -->
<div class="services" aria-hidden="true">
  {#each Object.entries(serviceList) as [id, s] (id + s.url)}
    <iframe title="" src={s.url} sandbox={SANDBOX} tabindex="-1" use:frame={{ key: 'service:' + id, appId: id, kind: 'service' }}></iframe>
  {/each}
</div>

{#if runner.app}
  {#key runner.url}
    <div class="layer {runner.app.mode}" data-scope data-pt="app-layer" data-app={runner.app.id}>
      {#if runner.app.mode === 'window'}
        <div class="veil" role="presentation" onclick={closeApp}></div>
        <div class="window glass">
          <div class="titlebar">
            <span class="ic" style="--c: {runner.app.color}">{#if runner.app.icon}<img src={runner.app.icon} alt="" />{/if}</span>
            <span class="title">{runner.title}</span>
            <button class="close" onclick={closeApp} aria-label="Close {runner.app.name}" data-pt="app-close"><Icon name="close" size="1.5rem" /></button>
          </div>
          <iframe bind:this={mainFrame} title={runner.app.name} src={runner.url} sandbox={SANDBOX} allow={ALLOW} use:frame={{ key: 'main', appId: runner.app.id, kind: 'main' }}></iframe>
        </div>
      {:else}
        <iframe bind:this={mainFrame} class="full" title={runner.app.name} src={runner.url} sandbox={SANDBOX} allow={ALLOW} use:frame={{ key: 'main', appId: runner.app.id, kind: 'main' }}></iframe>
      {/if}
    </div>
  {/key}
{/if}

{#if runner.web}
  <!-- The browser host's stand-in for the full-screen web view the Android app opens. -->
  <div class="layer fullscreen web" data-scope data-pt="web-layer">
    <iframe class="full" title="Web page" src={runner.web.url} allow={ALLOW}></iframe>
    <button class="btn floating" onclick={closeWeb} data-pt="web-close"><Icon name="close" size="1.2rem" />Close</button>
  </div>
{/if}

{#if runner.video}
  <div class="layer fullscreen video" data-scope data-pt="video-layer">
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} src={runner.video.url} controls autoplay onended={() => stopVideo(true)} style:filter={blur ? `blur(${blur}px)` : null}></video>
    {#if dark > 0}<div class="dimmer" style:opacity={dark} data-pt="video-dimmer"></div>{/if}
    <div class="floating">
      {#if settings.dimDark || settings.dimBlur}
        <button class="btn" onclick={() => (runner.video.dimmed = !runner.video.dimmed)} data-pt="video-dim">{runner.video.dimmed ? 'Undim' : 'Dim'}</button>
      {/if}
      <button class="btn" onclick={() => stopVideo(false)} data-pt="video-close"><Icon name="close" size="1.2rem" />Close</button>
    </div>
  </div>
{/if}

<style>
  .services { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; pointer-events: none; left: -10px; top: -10px; }
  .services iframe { width: 1280px; height: 720px; border: 0; }
  .layer { position: fixed; inset: 0; z-index: 50; }
  .layer.fullscreen { background: #000; }
  iframe { border: 0; display: block; background: transparent; }
  iframe.full { width: 100%; height: 100%; }
  .veil { position: absolute; inset: 0; background: rgba(3, 5, 10, 0.6); }
  .window {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(84rem, calc(100vw - 4rem));
    height: min(52rem, calc(100vh - 4rem));
    border-radius: 2rem;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: pop 0.2s ease both;
  }
  @keyframes pop { from { opacity: 0; transform: translate(-50%, -48%) scale(0.97); } }
  .titlebar { flex: none; display: flex; align-items: center; gap: 1rem; padding: 0.9rem 1rem 0.9rem 1.2rem; border-bottom: 1px solid var(--glass-line); }
  .ic { width: 2.4rem; height: 2.4rem; border-radius: 0.7rem; background: var(--c); display: grid; place-items: center; }
  .ic img { width: 66%; height: 66%; object-fit: contain; }
  .title { flex: 1; font-size: 1.2rem; }
  .close { width: 2.8rem; height: 2.8rem; border-radius: 50%; display: grid; place-items: center; color: var(--dim); }
  .close:hover, .close:focus { background: rgba(255, 255, 255, 0.14); color: var(--ink); }
  .window iframe { flex: 1; width: 100%; }
  video { width: 100%; height: 100%; background: #000; }
  .floating { position: absolute; top: 1.4rem; right: 1.4rem; display: flex; gap: 0.8rem; }
  .floating :global(.btn), .web > .floating { background: rgba(0, 0, 0, 0.55); }
  /* Dimming (for cars): over the picture; the player's own controls stay usable below it. */
  .dimmer { position: absolute; inset: 0 0 4.5rem 0; background: #000; pointer-events: none; }
</style>
