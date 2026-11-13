// Paints PlayBigScreen's own background pictures (landscapes made from noise, so they are
// ours to ship) into ui/public/backgrounds and the default apps' folders.
//   node tools/backgrounds.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SCENES = {
  aurora: { seed: 3, sky: ['#04101c', '#0a2a3a', '#0f3c46'], glow: null, aurora: ['#3dffc0', '#2bd4ff'], stars: 1, ridges: ['#0b2430', '#081b25', '#05131b', '#030c12'], mist: 'rgba(80,200,190,0.10)' },
  dusk: { seed: 11, sky: ['#1d1638', '#5b2f5f', '#e0806a'], glow: ['#ffcf9a', 0.62, 0.66, 0.5], ridges: ['#6a3a63', '#4a2a52', '#2f1c3d', '#1a1128'], mist: 'rgba(255,170,150,0.12)' },
  forest: { seed: 23, sky: ['#9fb6b0', '#c9d6c7', '#e4e7d6'], glow: ['#fff6dc', 0.3, 0.35, 0.35], ridges: ['#7d978c', '#56756a', '#35554b', '#1d3830', '#0f2420'], mist: 'rgba(230,240,230,0.22)', trees: true },
  ember: { seed: 31, sky: ['#1a0a0a', '#5a1d14', '#d4612f'], glow: ['#ffb36b', 0.42, 0.7, 0.42], ridges: ['#8a3a22', '#5e2416', '#3a160e', '#200b07'], mist: 'rgba(255,140,80,0.12)', dunes: true },
  harbour: { seed: 41, sky: ['#0d1a33', '#21406a', '#7aa6c8'], glow: ['#dcefff', 0.7, 0.6, 0.25], ridges: ['#2b4a6e', '#1b3352'], sea: ['#183453', '#0a1a2e'], mist: 'rgba(170,210,240,0.12)' },
  slate: { seed: 5, sky: ['#0d1118', '#151b26', '#1c2431'], glow: ['#3a4a66', 0.75, 0.25, 0.6], ridges: [], mist: null },
  // The default apps' own.
  'app-playtheater': { seed: 77, sky: ['#120a1c', '#2a1236', '#6b2140'], glow: ['#ff9a6b', 0.5, 0.82, 0.55], ridges: ['#3a1430', '#260c22', '#160716'], mist: 'rgba(255,120,120,0.10)', stars: 0.4 },
  'app-romm': { seed: 91, sky: ['#071226', '#122a5c', '#3b2a7a'], glow: ['#b388ff', 0.3, 0.75, 0.4], ridges: ['#24206a', '#1a1650', '#100d36', '#080620'], mist: 'rgba(150,120,255,0.12)', stars: 0.8, grid: true },
};

const OUT = {
  'app-playtheater': path.join(root, 'repository/apps/playtheater/background.jpg'),
  'app-romm': path.join(root, 'repository/apps/romm/background.jpg'),
};

const painter = `
function rng(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function noise1(r){ const pts = Array.from({length: 64}, r); return (x) => { const i = Math.floor(x) & 63, f = x - Math.floor(x), t = f*f*(3-2*f); return pts[i]*(1-t) + pts[(i+1)&63]*t; }; }
function paint(c, sc){
  const W = c.width, H = c.height, g = c.getContext('2d'), r = rng(sc.seed);
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, sc.sky[0]); sky.addColorStop(0.55, sc.sky[1]); sky.addColorStop(1, sc.sky[2]);
  g.fillStyle = sky; g.fillRect(0, 0, W, H);
  if (sc.stars) for (let i = 0; i < 900 * sc.stars; i++) { const x = r()*W, y = r()*H*0.6, a = r()*0.8*(1 - y/(H*0.6)); g.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')'; const s = r() < 0.04 ? 2 : 1; g.fillRect(x, y, s, s); }
  if (sc.glow) { const [col, gx, gy, gr] = sc.glow; const rg = g.createRadialGradient(W*gx, H*gy, 0, W*gx, H*gy, W*gr); rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = 0.85; g.fillStyle = rg; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
  if (sc.aurora) {
    g.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 3; band++) {
      const n = noise1(r), base = H * (0.18 + band * 0.08);
      for (let x = 0; x < W; x += 3) {
        const y = base + (n(x / 260) - 0.5) * H * 0.22, h = H * (0.18 + n(x / 90 + 7) * 0.22);
        const lg = g.createLinearGradient(0, y, 0, y + h);
        const col = sc.aurora[band % 2];
        lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.7, col + '22'); lg.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = lg; g.fillRect(x, y, 3, h);
      }
    }
    g.globalCompositeOperation = 'source-over';
  }
  if (sc.grid) {
    g.strokeStyle = 'rgba(160,140,255,0.16)'; g.lineWidth = 2;
    const hy = H * 0.62;
    for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(W/2 + i * 30, hy); g.lineTo(W/2 + i * 260, H); g.stroke(); }
    for (let k = 1; k < 14; k++) { const y = hy + (H - hy) * Math.pow(k / 14, 1.8); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  const n = sc.ridges.length;
  sc.ridges.forEach((col, i) => {
    const f = noise1(r), f2 = noise1(r);
    const base = H * (0.5 + (i / Math.max(n, 1)) * 0.46) + (sc.sea ? -H*0.1 : 0);
    const amp = H * (sc.dunes ? 0.06 : 0.16) * (1 - i * 0.12);
    // Haze over what's further away, so the ridges stand apart.
    if (sc.mist && i > 0) { const mg = g.createLinearGradient(0, base - amp * 2.2, 0, base); mg.addColorStop(0, 'rgba(0,0,0,0)'); mg.addColorStop(1, sc.mist); g.fillStyle = mg; g.fillRect(0, base - amp * 2.2, W, H); }
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) {
      const y = base - amp * (sc.dunes ? Math.pow(f(x / 420 + i*3), 1.5) * 1.6 : f(x / 300 + i*5) * 0.7 + f2(x / 70) * 0.3);
      g.lineTo(x, y);
    }
    g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill();
    if (sc.trees && i >= 2) {
      g.fillStyle = col;
      for (let x = 0; x < W; x += 7 + r() * 9) {
        const y = base - amp * (f(x / 300 + i*5) * 0.7 + f2(x / 70) * 0.3), h = 18 + r() * 30 * (i - 1);
        g.beginPath(); g.moveTo(x - h*0.22, y + 4); g.lineTo(x, y - h); g.lineTo(x + h*0.22, y + 4); g.fill();
      }
    }
  });
  if (sc.sea) {
    const top = H * 0.72;
    const sg = g.createLinearGradient(0, top, 0, H); sg.addColorStop(0, sc.sea[0]); sg.addColorStop(1, sc.sea[1]);
    g.fillStyle = sg; g.fillRect(0, top, W, H - top);
    const [, gx] = sc.glow;
    for (let y = top; y < H; y += 3) { const w = (40 + (y - top) * 0.9) * (0.5 + r()); g.fillStyle = 'rgba(220,240,255,' + (0.18 * (1 - (y-top)/(H-top))).toFixed(3) + ')'; g.fillRect(W*gx - w/2 + (r()-0.5)*30, y, w, 1); }
  }
  // Grain, so big gradients don't band on TVs.
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const k = (r() - 0.5) * 10; d[i] += k; d[i+1] += k; d[i+2] += k; }
  g.putImageData(img, 0, 0);
}`;

const b = await chromium.launch();
const p = await b.newPage();
await p.setContent(`<canvas id=c width=1920 height=1080></canvas><script>${painter}</script>`);
for (const [id, sc] of Object.entries(SCENES)) {
  const data = await p.evaluate((sc) => { const c = document.getElementById('c'); paint(c, sc); return c.toDataURL('image/jpeg', 0.84); }, sc);
  const file = OUT[id] || path.join(root, 'ui/public/backgrounds', id + '.jpg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'));
  console.log(file, fs.statSync(file).size);
}
await b.close();
