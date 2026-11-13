// Network, Bluetooth and volume, for the top bar and the quick settings.
import { call } from './native.js';

export const quick = $state({ status: null, volume: null });

export async function refreshStatus() {
  try { quick.status = await call('status'); } catch {}
  try { quick.volume = await call('volume.get'); } catch {}
}

export async function setVolume(level) {
  if (!quick.volume) return;
  const v = Math.max(0, Math.min(quick.volume.max, level));
  quick.volume = { ...quick.volume, level: v, muted: v === 0 ? quick.volume.muted : false };
  try { quick.volume = await call('volume.set', { level: v, muted: false }); } catch {}
}

export async function toggleMute() {
  if (!quick.volume) return;
  try { quick.volume = await call('volume.set', { muted: !quick.volume.muted }); } catch {}
}
