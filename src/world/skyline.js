// Distant city. Low-poly but not blocky: every building is a prism over a varied footprint (rectangle,
// L-shape, chamfered, rounded, skewed) with stepped setbacks, cornices, parapets and a crown (art-deco
// steps + spire, tapered glass pyramid, sloped glass cut, mechanical penthouse). Facades are procedurally
// painted per style (albedo + recess normal map + lit-window emissive) at 8 bays x 16 floors per tile, so the
// window grid holds up at distance. One merged mesh per facade style, one vertex-coloured mesh for roofs,
// trim and rooftop clutter, one unlit mesh for aircraft beacons and crown lights.
// All skyline materials share a small shader patch: aerial haze + depth desaturation keyed to the dusk sky,
// and a sky/sun reflection on window glass (curtain-wall towers catch the sunset).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry } from '../core/util.js';
import { SUN_DIR } from './sky.js';

const BAY = 3, FLOOR = 3.2, COLS = 8, ROWS = 16;
const TILE_W = BAY * COLS, TILE_H = FLOOR * ROWS;
const TW = 512, TH = 1024;

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// ------------------------------------------------------------------ facade painting
const LIGHTS = { warm: ['#ffb45c', '#ffc77e', '#ffa850', '#ffd59a'], cool: ['#e6efff', '#d4e4ff', '#f2f6ea', '#cfe0f2'], tv: ['#7fa8ff', '#9fb8ff'] };
function paintStyle(style, seed) {
  const r = mulberry(seed), bw = TW / COLS, fh = TH / ROWS;
  const [ac, a] = cv(TW, TH), [hc, h] = cv(TW, TH), [ec, e] = cv(TW, TH);
  e.fillStyle = '#000'; e.fillRect(0, 0, TW, TH);
  h.fillStyle = '#fff'; h.fillRect(0, 0, TW, TH);
  const base = { brick: '#76402e', stone: '#b4a48a', deco: '#a59a88', concrete: '#9a9892', glass: '#4a5866' }[style];
  a.fillStyle = base; a.fillRect(0, 0, TW, TH);
  for (let i = 0; i < 16000; i++) { // material grain + weathering
    const v = r(); a.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '255,240,220'},${0.02 + r() * 0.05})`;
    a.fillRect(r() * TW, r() * TH, 1 + r() * 3, 1 + r() * 2);
  }
  if (style === 'brick') for (let y = 0; y < TH; y += 4) { a.fillStyle = 'rgba(30,15,10,.2)'; a.fillRect(0, y, TW, 1); }
  // which floors are "on" (offices light whole floors in runs; homes are scattered and warm)
  const office = style === 'glass' || style === 'concrete' || style === 'deco';
  const floorOn = Array.from({ length: ROWS }, () => r() < (office ? 0.32 : 0.0));
  const pane = (x, y, w, hh, lit, tint, glow) => {
    a.fillStyle = style === 'glass' ? '#0b131c' : '#10141b'; a.fillRect(x, y, w, hh);
    a.fillStyle = 'rgba(150,170,200,.10)'; a.fillRect(x, y, w, hh * 0.4);
    h.fillStyle = '#000'; h.fillRect(x, y, w, hh);
    if (!lit) return;
    e.globalAlpha = glow; e.fillStyle = tint; e.fillRect(x + 1, y + 1, w - 2, hh - 2);
    // blinds / curtains / furniture silhouettes break up the glow
    e.globalAlpha = 1; e.fillStyle = '#000';
    const k = r();
    if (k < 0.3) e.fillRect(x, y, w, hh * (0.2 + r() * 0.5)); // blind pulled part way
    else if (k < 0.5) e.fillRect(x + w * (0.3 + r() * 0.4), y, 1 + r() * 3, hh); // curtain gap
    e.globalAlpha = 1;
  };
  const pick = (L) => L[Math.floor(r() * L.length)];
  for (let fy = 0; fy < ROWS; fy++) {
    const y0 = fy * fh, on = floorOn[fy];
    // floor bands / spandrels
    if (style === 'stone') { a.fillStyle = 'rgba(235,225,205,.45)'; a.fillRect(0, y0 + fh - 5, TW, 3); }
    if (style === 'brick') { a.fillStyle = 'rgba(185,165,145,.5)'; a.fillRect(0, y0 + fh - 3, TW, 2); }
    if (style === 'glass') { a.fillStyle = '#46525e'; a.fillRect(0, y0 + fh - 7, TW, 7); h.fillStyle = '#ccc'; h.fillRect(0, y0 + fh - 7, TW, 7); }
    if (style === 'concrete') { a.fillStyle = '#b3b0a8'; a.fillRect(0, y0 + fh - 9, TW, 9); a.fillStyle = 'rgba(0,0,0,.35)'; a.fillRect(0, y0 + fh - 1, TW, 1); }
    if (style === 'deco') { a.fillStyle = '#4b4a48'; a.fillRect(0, y0 + fh - 8, TW, 8); }
    for (let fx = 0; fx < COLS; fx++) {
      const x0 = fx * bw;
      const litP = office ? (on ? 0.82 : 0.06) : 0.24;
      const tintOf = () => office ? (r() < 0.85 ? pick(LIGHTS.cool) : pick(LIGHTS.warm)) : (r() < 0.9 ? pick(LIGHTS.warm) : r() < 0.5 ? pick(LIGHTS.tv) : pick(LIGHTS.cool));
      const glow = () => office && on ? 0.55 + r() * 0.25 : 0.3 + r() * 0.6;
      if (style === 'brick') {
        const w = bw * 0.44, hh = fh * 0.58, x = x0 + (bw - w) / 2, y = y0 + fh * 0.16;
        a.fillStyle = '#cbbba4'; a.fillRect(x - 2, y - 4, w + 4, 4); a.fillRect(x - 2, y + hh, w + 4, 3);
        pane(x, y, w, hh, r() < litP, tintOf(), glow());
        a.fillStyle = 'rgba(205,200,190,.6)'; a.fillRect(x, y + hh / 2 - 1, w, 2); a.fillRect(x + w / 2 - 1, y, 2, hh);
        if (fx % 4 === 1 && fy < ROWS - 1) { a.fillStyle = 'rgba(22,22,22,.9)'; a.fillRect(x0 - 4, y + hh + 3, bw + 8, 3); for (let k = 0; k < 8; k++) a.fillRect(x0 - 4 + k * (bw + 8) / 7, y + hh - 9, 1.5, 12); }
      } else if (style === 'stone') {
        const w = bw * 0.28, hh = fh * 0.6, y = y0 + fh * 0.14;
        for (const k of [0.15, 0.57]) { const x = x0 + bw * k; pane(x, y, w, hh, r() < litP, tintOf(), glow()); a.fillStyle = 'rgba(240,230,210,.6)'; a.fillRect(x - 2, y + hh, w + 4, 2); a.fillRect(x + w / 2 - 0.5, y, 1, hh); }
      } else if (style === 'deco') { // continuous vertical window strips between stone piers, dark spandrels
        const w = bw * 0.62, x = x0 + (bw - w) / 2, hh = fh - 12;
        pane(x, y0 + 2, w, hh, r() < litP, tintOf(), glow());
        a.fillStyle = 'rgba(120,120,120,.5)'; a.fillRect(x + w / 2 - 1, y0 + 2, 2, hh);
        h.fillStyle = '#fff'; a.fillStyle = 'rgba(240,232,215,.25)'; a.fillRect(x0, y0, 4, fh);
      } else if (style === 'concrete') { // punched office grid: two windows per bay
        for (const k of [0.08, 0.54]) { const x = x0 + bw * k, w = bw * 0.38; pane(x, y0 + 4, w, fh - 16, r() < litP, tintOf(), glow()); }
        a.fillStyle = 'rgba(0,0,0,.18)'; a.fillRect(x0, y0, 2, fh);
      } else { // glass curtain: two panes per bay, bright mullions
        for (const k of [0, 0.5]) pane(x0 + bw * k + 2, y0 + 1, bw / 2 - 3, fh - 9, r() < litP, tintOf(), glow());
        a.fillStyle = '#6c7884'; a.fillRect(x0, y0, 3, fh); a.fillStyle = '#56626e'; a.fillRect(x0 + bw / 2 - 1, y0, 2, fh);
        h.fillStyle = '#ddd'; h.fillRect(x0, y0, 3, fh);
      }
    }
  }
  for (let k = 0; k < (style === 'glass' ? 0 : 110); k++) { a.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.1})`; a.fillRect(r() * TW, r() * TH, 1 + r() * 3, 20 + r() * 120); }
  let normalMap = null;
  if (style !== 'glass') {
    const hd = h.getImageData(0, 0, TW, TH).data, [nc, n] = cv(TW, TH), out = n.createImageData(TW, TH);
    const H = (x, y) => hd[(((y + TH) % TH) * TW + ((x + TW) % TW)) * 4] / 255;
    for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * 2.2, dy = (H(x, y - 1) - H(x, y + 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * TW + x) * 4;
      out.data[i] = (dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
    }
    n.putImageData(out, 0, 0); normalMap = texOf(nc, false);
  }
  return { map: texOf(ac), normalMap, emissiveMap: texOf(ec) };
}

// ------------------------------------------------------------------ footprints (arrays of [x, z], CCW)
const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const [x0, z0] = P[i], [x1, z1] = P[(i + 1) % P.length]; s += x0 * z1 - x1 * z0; } return s / 2; };
const ccw = (P) => (area(P) < 0 ? P.slice().reverse() : P);
const FP = {
  rect: (w, d) => [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]],
  L: (w, d, r) => { const nw = w * (0.35 + r() * 0.2), nd = d * (0.35 + r() * 0.2); return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2 - nd], [w / 2 - nw, d / 2 - nd], [w / 2 - nw, d / 2], [-w / 2, d / 2]]; },
  chamfer: (w, d, r) => { const c = Math.min(w, d) * (0.15 + r() * 0.12); return [[-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c]]; },
  round: (w, d, r) => { const rc = Math.min(w, d) * (0.2 + r() * 0.25), P = [];
    for (const [cx, cz, a0] of [[w / 2 - rc, -d / 2 + rc, -Math.PI / 2], [w / 2 - rc, d / 2 - rc, 0], [-w / 2 + rc, d / 2 - rc, Math.PI / 2], [-w / 2 + rc, -d / 2 + rc, Math.PI]])
      for (let k = 0; k <= 4; k++) { const t = a0 + (k / 4) * Math.PI / 2; P.push([cx + Math.cos(t) * rc, cz + Math.sin(t) * rc]); }
    return P; },
  skew: (w, d, r) => { const s = w * (0.18 + r() * 0.15); return [[-w / 2, -d / 2], [w / 2 - s, -d / 2], [w / 2, d / 2], [-w / 2 + s, d / 2]]; },
  oct: (w, d) => FP.chamfer(w, d, () => 0.9),
};
// miter offset (d > 0 grows the footprint)
function offset(P, d) {
  const n = P.length, out = [];
  for (let i = 0; i < n; i++) {
    const p = P[(i + n - 1) % n], c = P[i], q = P[(i + 1) % n];
    const e1 = norm2(c[0] - p[0], c[1] - p[1]), e2 = norm2(q[0] - c[0], q[1] - c[1]);
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]]; // outward for CCW (x, z) with area > 0
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const k = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    mx /= Math.max(k, 0.3); mz /= Math.max(k, 0.3);
    out.push([c[0] + mx * d, c[1] + mz * d]);
  }
  return out;
}
const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const scaleP = (P, k) => P.map(([x, z]) => [x * k, z * k]);

// side walls of a prism (or a loft between two rings with the same vertex count). Outward normals; smooth
// across shallow corners so rounded footprints shade round. top(y) can vary per vertex for sloped cuts.
function sideWalls(P, y0, topY, opts = {}) {
  const { Q = P, u0 = 0, v0 = 0, uv = true } = opts;
  const n = P.length, pos = [], nor = [], uvs = [], idx = [];
  const en = []; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; const e = norm2(b[0] - a[0], b[1] - a[1]); en.push([e[1], -e[0]]); }
  const vn = []; // per-vertex smoothed normal for gentle corners
  for (let i = 0; i < n; i++) { const a = en[(i + n - 1) % n], b = en[i]; vn.push(a[0] * b[0] + a[1] * b[1] > 0.8 ? norm2(a[0] + b[0], a[1] + b[1]) : null); }
  let u = u0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = P[i], b = P[j], qa = Q[i], qb = Q[j];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = pos.length / 3;
    const ya = typeof topY === 'function' ? topY(qa) : topY, yb = typeof topY === 'function' ? topY(qb) : topY;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], qb[0], yb, qb[1], qa[0], ya, qa[1]);
    const na = vn[i] || en[i], nb = vn[j] || en[i];
    nor.push(na[0], 0, na[1], nb[0], 0, nb[1], nb[0], 0, nb[1], na[0], 0, na[1]);
    const ub = u + L / TILE_W;
    uvs.push(u, v0 + y0 / TILE_H, ub, v0 + y0 / TILE_H, ub, v0 + yb / TILE_H, u, v0 + ya / TILE_H);
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2); // CCW footprint (area > 0 in x,z) + this order faces outward
    u = ub;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx);
  if (Q !== P) g.computeVertexNormals(); // lofts slope inward
  return g;
}
// flat (or sloped) cap over a footprint; down = facing the ground (cornice soffits)
function cap(P, y, down = false) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(P.map(([x, z]) => new THREE.Vector2(x, -z))));
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, typeof y === 'function' ? y([p.getX(i), p.getZ(i)]) : y);
  if (down) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; } }
  g.computeVertexNormals();
  return g;
}
const colored = (g, c) => { g = g.index ? g.toNonIndexed() : g; if (!g.attributes.normal) g.computeVertexNormals(); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };

// ------------------------------------------------------------------ shared shader patch: haze, desaturation, glass reflection
const HAZE = new THREE.Color().setRGB(0.4, 0.31, 0.36, THREE.LinearSRGBColorSpace);
export const SKY_NIGHT = { value: 0 }; // M13 nightfall: 0 dusk haze … 1 night haze (shared by every skyline material)
function skyPatch(mat, refl = 0) {
  mat.fog = false;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSun = { value: SUN_DIR }; sh.uniforms.uHaze = { value: HAZE }; sh.uniforms.uRefl = { value: refl }; sh.uniforms.uNight = SKY_NIGHT;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSkyW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSkyW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vSkyW; uniform vec3 uSun, uHaze; uniform float uRefl, uNight;
      float skH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      vec3 skyC(vec3 d){ float h = d.y;
        vec3 c = mix(vec3(1.25, 0.58, 0.32), vec3(0.42, 0.28, 0.38), smoothstep(0.0, 0.22, h));
        c = mix(c, vec3(0.10, 0.11, 0.22), smoothstep(0.18, 0.75, h));
        float sd = max(dot(d, uSun), 0.0);
        c += vec3(1.6, 0.7, 0.3) * pow(sd, 5.0) * 0.9 + vec3(2.4, 1.2, 0.55) * pow(sd, 48.0) * 2.0;
        c = mix(c, vec3(0.42, 0.33, 0.38), smoothstep(0.08, -0.05, h) * 0.7);
        return mix(c, vec3(0.05, 0.04, 0.05), smoothstep(-0.02, -0.3, h)); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float zGlass = 0.0;
        #ifdef USE_MAP
          zGlass = 1.0 - smoothstep(0.012, 0.06, dot(diffuseColor.rgb, vec3(0.333)));
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_EMISSIVEMAP
          zGlass *= 1.0 - clamp(dot(emissiveColor.rgb, vec3(0.6)), 0.0, 1.0);
        #endif`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        {
          vec3 vd = normalize(vSkyW - cameraPosition); float dist = length(vSkyW - cameraPosition);
          vec3 col = gl_FragColor.rgb;
          if (uRefl > 0.0 && zGlass > 0.01) {
            vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
            #ifdef USE_MAP
              vec2 cell = floor(vMapUv * vec2(${COLS * 2}.0, ${ROWS}.0)); // panes are never perfectly flat
              nW = normalize(nW + vec3(skH(cell) - 0.5, (skH(cell + 7.1) - 0.5) * 0.6, skH(cell + 3.3) - 0.5) * 0.06);
            #endif
            vec3 R = reflect(vd, nW);
            float F = 0.3 + 0.7 * pow(1.0 - max(dot(-vd, nW), 0.0), 4.0);
            float sr = max(dot(R, uSun), 0.0);
            col = mix(col, (skyC(R) * 0.85 + vec3(1.5, 0.62, 0.26) * pow(sr, 2.5) * 0.7 * uRefl) * mix(1.0, 0.1, uNight), zGlass * uRefl * F);
          }
          // aerial perspective: fade + desaturate with distance, a little less up high, warmer toward the sun
          float sd = max(dot(vd, uSun), 0.0);
          vec3 hz = mix(uHaze + vec3(1.1, 0.5, 0.25) * pow(sd, 4.0) * 0.55, vec3(0.03, 0.036, 0.07), uNight);
          float f = 1.0 - exp(-max(dist - 30.0, 0.0) * 0.0068);
          f *= mix(1.0, 0.72, smoothstep(10.0, 110.0, vSkyW.y));
          float l = dot(col, vec3(0.3, 0.59, 0.11));
          col = mix(col, vec3(l) * vec3(1.0, 0.95, 1.0), clamp(f * 1.05, 0.0, 0.7));
          gl_FragColor.rgb = mix(col, hz, f);
        }`);
  };
  mat.customProgramCacheKey = () => 'skyline-' + (refl > 0 ? 'r' : 'n') + (mat.map ? 'm' : '');
  return mat;
}

// ------------------------------------------------------------------ city
export function buildSkyline(scene, seed = 21) {
  const r = mulberry(seed);
  const styles = ['brick', 'stone', 'deco', 'concrete', 'glass'];
  const sets = Object.fromEntries(styles.map((s, i) => [s, paintStyle(s, seed + i * 17)]));
  const geo = Object.fromEntries(styles.map((s) => [s, []])), detail = [], lights = [];
  const C = (hex) => new THREE.Color(hex);
  const roofCol = { brick: C('#2b2624'), stone: C('#3a342e'), deco: C('#3a3630'), concrete: C('#3d3d3b'), glass: C('#2a2f35') };
  const trimCol = { brick: C('#a89480'), stone: C('#c9bba2'), deco: C('#bfb39e'), concrete: C('#86847e'), glass: C('#56616c') };
  const place = (g, x, z, rot) => { g.rotateY(rot); g.translate(x, 0, z); return g; };
  const box = (w, h, d, x, y, z, col) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col);
  const cyl = (rt, rb, h, x, y, z, col, seg = 8) => colored(new THREE.CylinderGeometry(rt, rb, h, seg).translate(x, y + h / 2, z), col);
  const beacon = (x, y, z, s = 0.5, c = '#ff2a10') => lights.push(colored(new THREE.OctahedronGeometry(s, 0).translate(x, y, z), C(c).multiplyScalar(6)));
  const ringCap = (P, y, col, parts) => parts.push(colored(cap(P, y), col));
  // cornice: projecting band with a soffit, then a parapet wall above the roof
  const cornice = (P, y, style, parts, proj = 0.6, hgt = 0.7) => {
    const O = offset(P, proj), col = trimCol[style];
    parts.push(colored(sideWalls(O, y - hgt, y, { uv: false }), col), colored(cap(O, y - hgt, true), col.clone().multiplyScalar(0.6)), colored(cap(O, y), col));
    const In = offset(P, -0.35);
    parts.push(colored(sideWalls(P, y, y + 1.0, { uv: false }), roofCol[style]), colored(cap(P, y + 1.0), col.clone().multiplyScalar(0.8)));
    ringCap(In, y + 0.05, roofCol[style], parts);
  };
  const clutter = (P, top, style, parts, tall) => {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const [x, z] of P) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const cw = (maxX - minX) * 0.55, cd = (maxZ - minZ) * 0.55, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const rp = () => [cx + (r() - 0.5) * cw, cz + (r() - 0.5) * cd];
    const hv = 2 + Math.floor(r() * (tall ? 5 : 3));
    for (let k = 0; k < hv; k++) { const [x, z] = rp(); parts.push(box(1.2 + r() * 2.4, 0.8 + r() * 1.4, 1 + r() * 1.8, x, top, z, C(r() < 0.5 ? '#5d5f61' : '#46484a'))); }
    if (tall) {
      const pw = cw * (0.5 + r() * 0.3), pd = cd * (0.5 + r() * 0.3), ph = 3.5 + r() * 3; // mechanical penthouse with louvres
      parts.push(box(pw, ph, pd, cx, top, cz, roofCol[style].clone().multiplyScalar(1.3)));
      for (let k = 0; k < 3; k++) parts.push(box(pw + 0.06, 0.18, pd + 0.06, cx, top + ph * (0.35 + k * 0.18), cz, C('#26282a')));
      for (let k = 0; k < 2 + Math.floor(r() * 3); k++) { const [x, z] = rp(); const R = 1 + r() * 0.8; parts.push(cyl(R * 0.8, R, 2.4, x, top, z, C('#6a6c6e'), 10), cyl(R * 0.85, R * 0.85, 0.3, x, top + 2.4, z, C('#2c2c2c'), 10)); } // cooling towers
      const masts = 1 + Math.floor(r() * 3);
      for (let k = 0; k < masts; k++) { const [x, z] = rp(); const ah = 6 + r() * 16; parts.push(cyl(0.06, 0.2, ah, x, top + ph, z, C('#2a2a2c'), 5)); beacon(x, top + ph + ah + 0.2, z, 0.35); }
      if (r() < 0.5) { const [x, z] = rp(); parts.push(colored(new THREE.ConeGeometry(1.1, 0.6, 10, 1, true).rotateX(-1.1).translate(x, top + 2, z), C('#9a9c9e')), cyl(0.08, 0.08, 1.8, x, top, z, C('#333'), 4)); } // dish
      if (r() < 0.6) { const [x, z] = rp(); parts.push(box(0.4, 1.6, 0.4, x, top, z, C('#c8b030')), box(0.3, 0.3, cw * 0.6, x, top + 1.6, z, C('#c8b030'))); } // window-washer davit
    } else if ((style === 'brick' || style === 'stone') && r() < 0.65) { // timber water tower on steel legs
      const [wx, wz] = rp(), R = 1.5 + r() * 0.8, H = 3 + r() * 1.5;
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.16, 3, 0.16, wx + lx * R * 0.7, top, wz + lz * R * 0.7, C('#2a2a2a')));
      parts.push(cyl(R, R, H, wx, top + 3, wz, C('#5a4636'), 10), cyl(R * 0.98, R * 0.98, 0.2, wx, top + 3, wz, C('#3a2e24'), 10));
      parts.push(colored(new THREE.ConeGeometry(R * 1.08, 1.3, 10).translate(wx, top + 3 + H + 0.65, wz), C('#3a3634')));
    }
    if (r() < 0.35) { const [x, z] = rp(); parts.push(box(2.4, 2.6, 2.4, x, top, z, roofCol[style])); }
  };

  const building = (x, z, rot, style, w, d, h, opts = {}) => {
    const parts = [];
    let shape = opts.shape || (style === 'brick' ? (r() < 0.45 ? 'L' : 'rect') : style === 'stone' ? ['rect', 'L', 'chamfer'][Math.floor(r() * 3)]
      : style === 'deco' ? (r() < 0.5 ? 'chamfer' : 'rect') : style === 'concrete' ? ['rect', 'round', 'L'][Math.floor(r() * 3)] : ['round', 'chamfer', 'skew', 'oct', 'rect'][Math.floor(r() * 5)]);
    let P = ccw(FP[shape](w, d, r));
    const u0 = Math.floor(r() * COLS) / COLS, v0 = Math.floor(r() * ROWS) / ROWS;
    const tall = h > 52;
    // tier plan: wedding-cake setbacks for masonry, 1-2 for slabs and glass
    const tiers = style === 'deco' ? 3 : style === 'stone' ? (tall ? 3 : r() < 0.5 ? 2 : 1) : style === 'brick' ? 1 : style === 'concrete' ? (r() < 0.4 ? 2 : 1) : (r() < 0.45 ? 2 : 1);
    let y = 0;
    for (let t = 0; t < tiers; t++) {
      const last = t === tiers - 1;
      const frac = tiers === 1 ? 1 : t === 0 ? 0.55 + r() * 0.15 : last ? 1 : 0.8 + r() * 0.08;
      const target = last ? h : y + (h - y) * frac;
      const hh = Math.max(2, Math.round((target - y) / FLOOR)) * FLOOR;
      const sloped = last && style === 'glass' && opts.slope;
      const topF = sloped ? ([px, pz]) => y + hh + (px * opts.slope[0] + pz * opts.slope[1]) : y + hh;
      geo[style].push(place(sideWalls(P, y, topF, { u0: u0 + t * 0.29, v0 }), x, z, rot));
      y += hh;
      if (sloped) { parts.push(colored(cap(P, topF), C('#3a4652'))); for (const [px, pz] of P.filter((_, i) => i % 2 === 0)) beacon(px, topF([px, pz]) + 0.3, pz, 0.22, '#ffffff'); }
      else if (style === 'glass') { parts.push(colored(sideWalls(offset(P, 0.15), y - 1.0, y + 0.6, { uv: false }), trimCol.glass), colored(cap(offset(P, 0.15), y + 0.6), roofCol.glass)); }
      else cornice(P, y, style, parts, style === 'concrete' ? 0.3 : style === 'brick' ? 0.7 : 0.55, style === 'concrete' ? 0.5 : 0.8);
      if (!last) { // set back: shrink inward (keeps L's and chamfers), or switch to a centred tower on big floors
        const minDim = Math.min(w, d);
        P = r() < 0.5 || shape === 'L' ? ccw(offset(P, -minDim * (0.12 + r() * 0.06))) : ccw(FP[style === 'deco' ? 'chamfer' : 'rect'](w * (0.55 + r() * 0.15), d * (0.55 + r() * 0.15), r));
      }
    }
    let top = y;
    // crowns
    if (style === 'deco' || (style === 'stone' && tall)) { // stepped art-deco top + lantern + spire
      let Q = P;
      for (let k = 0; k < 3; k++) {
        Q = ccw(offset(Q, -Math.min(w, d) * 0.07)); const sh = 2.2 + r() * 1.6;
        geo[style].push(place(sideWalls(Q, top, top + sh, { u0, v0: v0 + 0.5 }), x, z, rot)); top += sh;
        parts.push(colored(cap(Q, top), trimCol[style]));
        for (const [px, pz] of Q) if (r() < 0.5) parts.push(box(0.5, 1.6, 0.5, px, top, pz, trimCol[style])); // finials
      }
      const tipH = 6 + r() * 8, Tq = scaleP(Q, 0.12);
      parts.push(colored(sideWalls(Q, top, top + tipH, { Q: Tq, uv: false }), C('#9c9a94')));
      for (let k = 1; k <= 3; k++) lights.push(colored(sideWalls(scaleP(Q, 1 - k * 0.22 + 0.02), top + tipH * k * 0.22 - 0.15, top + tipH * k * 0.22 + 0.05, { Q: scaleP(Q, 1 - k * 0.22), uv: false }), C('#ffcf8a').multiplyScalar(1.6)));
      const sp = 8 + r() * 10; parts.push(cyl(0.05, 0.35, sp, 0, top + tipH, 0, C('#b8b6b0'), 6)); beacon(0, top + tipH + sp + 0.2, 0, 0.4);
    } else if (style === 'glass' && !opts.slope && r() < 0.55) { // tapered glass crown
      const ch = 6 + r() * 10, Q = scaleP(P, 0.45 + r() * 0.2);
      geo.glass.push(place(sideWalls(P, top, top + ch, { Q, u0, v0 }), x, z, rot));
      parts.push(colored(cap(Q, top + ch), roofCol.glass));
      const sp = 10 + r() * 16; parts.push(cyl(0.05, 0.3, sp, 0, top + ch, 0, C('#2c2c2e'), 6)); beacon(0, top + ch + sp + 0.2, 0, 0.45);
      top += ch;
    } else if (!opts.slope) clutter(P, top + 0.05, style, parts, tall);
    for (const p of parts) detail.push(place(p, x, z, rot));
  };

  // rings around the plaza: walk-ups close in, mid-rise behind, towers far back. Hero towers are placed so
  // that, from the plaza, they mirror the low sun.
  const rings = [[76, 18, 20, 40, ['brick', 'stone', 'brick', 'concrete', 'brick']], [96, 24, 28, 66, ['stone', 'concrete', 'brick', 'glass', 'deco']], [132, 26, 50, 118, ['glass', 'concrete', 'glass', 'deco', 'stone']]];
  let count = 0;
  const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  for (const [R0, n, hMin, hMax, mix] of rings) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.14, dd = R0 + (r() - 0.5) * 14;
    const style = mix[Math.floor(r() * mix.length)];
    const w = style === 'glass' ? 15 + r() * 12 : style === 'deco' ? 16 + r() * 10 : 12 + r() * 14, dep = w * (0.7 + r() * 0.5);
    const hh = hMin + Math.pow(r(), 1.5) * (hMax - hMin) * (style === 'glass' || style === 'deco' ? 1.2 : 1);
    building(Math.cos(a) * dd, Math.sin(a) * dd, -a + Math.PI / 2, style, w, dep, hh); count++;
  }
  // hero glass towers opposite the sun (their faces reflect it), one with a raked roof
  for (const [da, R0, h, opts] of [[0.32, 112, 104, { shape: 'skew', slope: [0.55, 0.2] }], [-0.26, 118, 92, { shape: 'round' }], [Math.PI * 0.62, 120, 98, { shape: 'chamfer' }]]) {
    const a = sunAz + Math.PI + da;
    building(Math.cos(a) * R0, Math.sin(a) * R0, -a + Math.PI / 2, 'glass', 24, 20, h, opts); count++;
  }

  const group = new THREE.Group(); group.name = 'skyline';
  const props = { brick: [0.9, 0, 0.25], stone: [0.85, 0, 0.25], deco: [0.8, 0, 0.3], concrete: [0.9, 0, 0.3], glass: [0.2, 0.0, 1.0] };
  const tint = { brick: '#a99ca0', stone: '#948c94', deco: '#9a929a', concrete: '#8f8a92', glass: '#a8a6b4' };
  for (const s of styles) {
    if (!geo[s].length) continue;
    const T = sets[s];
    const m = skyPatch(new THREE.MeshStandardMaterial({ color: tint[s], map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), emissiveMap: T.emissiveMap, emissive: C('#ffffff'), emissiveIntensity: 1.7, roughness: props[s][0], metalness: props[s][1], envMapIntensity: 0.35 }), props[s][2]);
    const mesh = new THREE.Mesh(mergeGeometries(geo[s]), m); mesh.matrixAutoUpdate = false; group.add(mesh);
  }
  const dm = new THREE.Mesh(mergeGeometries(detail), skyPatch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 })));
  dm.matrixAutoUpdate = false; group.add(dm);
  if (lights.length) { const lm = new THREE.Mesh(mergeGeometries(lights), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false })); lm.matrixAutoUpdate = false; group.add(lm); }
  scene.add(group);
  let tris = 0; group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { group, count, tris, drawCalls: group.children.length };
}
