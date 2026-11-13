// Opening an app, whichever kind it is.
import { call } from './native.js';
import { noteRecent } from './state.svelte.js';
import { openApp } from './runtime.svelte.js';
import { toast } from './toast.svelte.js';

export async function launch(app, params = {}) {
  if (app.kind === 'app') return openApp(app, params);
  noteRecent(app.key);
  try {
    await call('android.launch', { package: app.pkg });
  } catch (e) {
    toast(`${app.name} couldn't be opened: ${e.message}`);
  }
}
