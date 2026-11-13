// Short messages at the bottom of the screen.
export const toasts = $state({ list: [] });
let seq = 0;

export function toast(text, ms = 3500) {
  const id = ++seq;
  toasts.list.push({ id, text });
  setTimeout(() => { toasts.list = toasts.list.filter((t) => t.id !== id); }, ms);
}
