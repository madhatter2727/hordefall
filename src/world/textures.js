import * as THREE from 'three';
import { mulberry } from '../core/util.js';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, srgb = true, repeat = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.repeat.set(repeat, repeat);
  return t;
}

// value noise for canvases
function noiseField(w, h, scale, seed, octaves = 4) {
  const r = mulberry(seed);
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const layers = [];
  for (let o = 0; o < octaves; o++) {
    const s = Math.max(2, Math.floor(scale / 2 ** o));
    const cw = Math.ceil(w / s) + 1, ch = Math.ceil(h / s) + 1;
    const g = new Float32Array(cw * ch).map(() => r());
    layers.push({ s, cw, ch, g });
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0, amp = 1, tot = 0;
    for (const L of layers) {
      const fx = x / L.s, fy = y / L.s, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const i0 = (iy % (L.ch - 1)) * L.cw + (ix % (L.cw - 1)), i1 = ((iy + 1) % (L.ch - 1)) * L.cw + (ix % (L.cw - 1));
      const a = L.g[i0], b = L.g[i0 + 1], c = L.g[i1], d = L.g[i1 + 1];
      v += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      tot += amp; amp *= 0.5;
    }
    out[y * w + x] = v / tot;
  }
  void gw; void gh;
  return out;
}

function normalFromHeight(hf, w, h, strength) {
  const [c, ctx] = canvas(w, h);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = hf[y * w + ((x - 1 + w) % w)], r = hf[y * w + ((x + 1) % w)];
    const u = hf[((y - 1 + h) % h) * w + x], d = hf[((y + 1) % h) * w + x];
    let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
    const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
    const i = (y * w + x) * 4;
    img.data[i] = (nx * 0.5 + 0.5) * 255; img.data[i + 1] = (ny * 0.5 + 0.5) * 255; img.data[i + 2] = (nz * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Concrete: albedo, roughness (with puddle patches), normal (cracks + pores)
export function concrete({ seed = 1, size = 512, base = [118, 112, 108], puddles = false, cracks = true, stains = 1 } = {}) {
  const w = size, h = size;
  const n1 = noiseField(w, h, 128, seed), n2 = noiseField(w, h, 16, seed + 7, 3), n3 = noiseField(w, h, 200, seed + 13, 2);
  const height = new Float32Array(w * h);
  const [ac, actx] = canvas(w, h), [rc, rctx] = canvas(w, h);
  const aimg = actx.createImageData(w, h), rimg = rctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = 0.75 + n1[i] * 0.35 + (n2[i] - 0.5) * 0.18;
    const stain = Math.max(0, n3[i] - 0.55) * 2.2 * stains;
    const wet = puddles ? Math.max(0, (n3[i] - 0.62) * 6) : 0;
    const k = (1 - stain * 0.45) * (1 - Math.min(wet, 1) * 0.35);
    aimg.data[i * 4] = base[0] * v * k; aimg.data[i * 4 + 1] = base[1] * v * k; aimg.data[i * 4 + 2] = base[2] * v * k * (1 + stain * 0.05); aimg.data[i * 4 + 3] = 255;
    const rough = Math.max(0.06, 0.92 - (n2[i] - 0.5) * 0.2 - Math.min(wet, 1) * 0.86);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rough * 255; rimg.data[i * 4 + 3] = 255;
    height[i] = n2[i] * 0.6 + n1[i] * 0.4;
  }
  actx.putImageData(aimg, 0, 0); rctx.putImageData(rimg, 0, 0);
  if (cracks) {
    const r = mulberry(seed + 99);
    actx.strokeStyle = 'rgba(30,26,24,.55)'; actx.lineWidth = 1.2;
    for (let k = 0; k < 7; k++) {
      let x = r() * w, y = r() * h, a = r() * 6.28;
      actx.beginPath(); actx.moveTo(x, y);
      for (let s = 0; s < 30; s++) {
        a += (r() - 0.5) * 0.9; x += Math.cos(a) * 8; y += Math.sin(a) * 8; actx.lineTo(x, y);
        const hx = Math.floor(((x % w) + w) % w), hy = Math.floor(((y % h) + h) % h);
        height[hy * w + hx] -= 0.5;
      }
      actx.stroke();
    }
    // expansion joints
    actx.fillStyle = 'rgba(20,18,16,.6)'; actx.fillRect(0, 0, w, 2); actx.fillRect(0, 0, 2, h);
    for (let x = 0; x < w; x++) { height[x] -= 0.6; height[x * w] -= 0.6; }
  }
  return { map: tex(ac), roughnessMap: tex(rc, false), normalMap: tex(normalFromHeight(height, w, h, 3.5), false) };
}

// Corrugated container steel
export function corrugated({ color = [150, 50, 36], seed = 3 } = {}) {
  const w = 256, h = 256;
  const n = noiseField(w, h, 64, seed), n2 = noiseField(w, h, 8, seed + 1, 3);
  const [ac, actx] = canvas(w, h), [rc, rctx] = canvas(w, h);
  const aimg = actx.createImageData(w, h), rimg = rctx.createImageData(w, h);
  const height = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const rib = Math.sin((x / w) * Math.PI * 2 * 8);
    height[i] = Math.sign(rib) * Math.pow(Math.abs(rib), 0.4) * 0.8 + n2[i] * 0.15;
    const rust = Math.max(0, n[i] - 0.52) * 3 + Math.max(0, (y / h) - 0.85) * 3 * n2[i];
    const rr = Math.min(1, rust);
    const v = 0.8 + n2[i] * 0.3;
    aimg.data[i * 4] = (color[0] * (1 - rr) + 110 * rr) * v;
    aimg.data[i * 4 + 1] = (color[1] * (1 - rr) + 55 * rr) * v;
    aimg.data[i * 4 + 2] = (color[2] * (1 - rr) + 28 * rr) * v;
    aimg.data[i * 4 + 3] = 255;
    const ro = 0.45 + rr * 0.45 + n2[i] * 0.1;
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = ro * 255; rimg.data[i * 4 + 3] = 255;
  }
  actx.putImageData(aimg, 0, 0); rctx.putImageData(rimg, 0, 0);
  return { map: tex(ac), roughnessMap: tex(rc, false), normalMap: tex(normalFromHeight(height, w, h, 2.2), false) };
}

// Building facade with windows (emissive map lights a few of them)
export function facade({ seed = 5, floors = 4, cols = 6 } = {}) {
  const w = 512, h = 512, r = mulberry(seed);
  const [ac, actx] = canvas(w, h), [ec, ectx] = canvas(w, h);
  const n = noiseField(w, h, 64, seed, 3);
  const img = actx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 52 + n[i] * 38; img.data[i * 4] = v * 1.02; img.data[i * 4 + 1] = v * 0.96; img.data[i * 4 + 2] = v * 0.94; img.data[i * 4 + 3] = 255; }
  actx.putImageData(img, 0, 0);
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, w, h);
  const fw = w / cols, fh = h / floors;
  for (let fy = 0; fy < floors; fy++) for (let fx = 0; fx < cols; fx++) {
    const x = fx * fw + fw * 0.2, y = fy * fh + fh * 0.25, ww = fw * 0.6, hh = fh * 0.5;
    const broken = r() < 0.35;
    actx.fillStyle = broken ? '#0b0a0c' : '#1a1d24'; actx.fillRect(x, y, ww, hh);
    actx.fillStyle = 'rgba(0,0,0,.4)'; actx.fillRect(x - 3, y + hh, ww + 6, 5);
    if (!broken) { actx.fillStyle = 'rgba(120,130,150,.15)'; actx.fillRect(x + ww / 2 - 1, y, 2, hh); }
    if (r() < 0.12) { ectx.fillStyle = r() < 0.7 ? '#ff9a40' : '#ffd08a'; ectx.globalAlpha = 0.35 + r() * 0.5; ectx.fillRect(x, y, ww, hh); ectx.globalAlpha = 1; }
  }
  // grime streaks
  for (let k = 0; k < 60; k++) { actx.fillStyle = `rgba(0,0,0,${r() * 0.15})`; actx.fillRect(r() * w, r() * h, 2 + r() * 4, 30 + r() * 120); }
  return { map: tex(ac), emissiveMap: tex(ec) };
}

export function crateWood(seed = 9) {
  const w = 256, h = 256, r = mulberry(seed);
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = '#6b4a2c'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 240; i++) { ctx.fillStyle = `rgba(${r() < 0.5 ? '40,25,10' : '150,110,70'},${0.1 + r() * 0.2})`; ctx.fillRect(0, r() * h, w, 1 + r() * 2); }
  ctx.fillStyle = 'rgba(30,20,10,.8)';
  for (let i = 0; i < 5; i++) ctx.fillRect(0, (i * h) / 5, w, 3);
  ctx.strokeStyle = '#3b2814'; ctx.lineWidth = 18; ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(w - 10, h - 10); ctx.stroke();
  return { map: tex(c) };
}

export function hazard() {
  const [c, ctx] = canvas(256, 64);
  ctx.fillStyle = '#c9a227'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#151515';
  for (let x = -64; x < 256; x += 48) { ctx.beginPath(); ctx.moveTo(x, 64); ctx.lineTo(x + 24, 64); ctx.lineTo(x + 88, 0); ctx.lineTo(x + 64, 0); ctx.fill(); }
  return tex(c);
}

// Small textures for FX
export function bulletHoleTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(5,5,5,1)'); g.addColorStop(0.18, 'rgba(10,9,8,1)'); g.addColorStop(0.3, 'rgba(40,36,32,.85)');
  g.addColorStop(0.55, 'rgba(30,28,25,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(15,14,12,.6)'; ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28; ctx.beginPath(); ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6); ctx.lineTo(32 + Math.cos(a) * (12 + Math.random() * 12), 32 + Math.sin(a) * (12 + Math.random() * 12)); ctx.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function bloodTexture() {
  const [c, ctx] = canvas(128, 128);
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * 6.28, d = Math.random() * 40, r = 4 + Math.random() * (22 - d * 0.4);
    ctx.fillStyle = `rgba(${70 + Math.random() * 40},4,6,${0.7 + Math.random() * 0.3})`;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, Math.max(2, r), 0, 6.28); ctx.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
