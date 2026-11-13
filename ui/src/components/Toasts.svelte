<script>
  import { toasts } from '../lib/toast.svelte.js';
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast glass" data-pt="toast">{t.text}</div>
  {/each}
</div>

<style>
  .toasts { position: fixed; z-index: 90; left: 50%; bottom: 3rem; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.8rem; align-items: center; pointer-events: none; }
  .toast { padding: 1rem 1.8rem; border-radius: 999px; background: var(--panel); font-size: 1.1rem; max-width: 70vw; animation: up 0.2s ease both; }
  @keyframes up { from { opacity: 0; transform: translateY(1rem); } }
</style>
