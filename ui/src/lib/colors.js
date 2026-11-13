// A tile colour for an app from its icon: the most common strong colour, made dark enough
// that the white name and the icon stand out on it.

export function colorOf(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const n = 24;
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, n, n);
        const d = g.getImageData(0, 0, n, n).data;
        const buckets = new Map();
        for (let i = 0; i < d.length; i += 4) {
          const [r, gg, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
          if (a < 200) continue;
          const { h, s, l } = hsl(r, gg, b);
          if (s < 0.25 || l < 0.12 || l > 0.9) continue;
          const k = Math.round(h / 20);
          const e = buckets.get(k) || { n: 0, h: 0, s: 0 };
          e.n++; e.h += h; e.s += s;
          buckets.set(k, e);
        }
        let best = null;
        for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
        if (!best) return resolve('#2b3445');
        resolve(toHex(best.h / best.n, Math.min(0.55, best.s / best.n), 0.3));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function toHex(h, s, l) {
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return '#' + f(0) + f(8) + f(4);
}
