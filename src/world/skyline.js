// Distant city: low-poly but believable buildings in four facade styles (brick walk-up, pre-war limestone,
// concrete slab block, glass tower). Facades are procedurally painted canvases (albedo + baked recess
// normal map + lit-window emissive), one tiling texture set per style. All geometry is merged: one mesh per
// style + one vertex-coloured mesh for roofs, cornices, parapets, water towers, HVAC and antennas.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry } from '../core/util.js';

const BAY = 3, FLOOR = 3.2, COLS = 8, ROWS = 8; // one texture tile = 8 bays x 8 floors
const TILE_W = BAY * COLS, TILE_H = FLOOR * ROWS;

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texOf(c, srgb = true) { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }

// paint one facade style; returns { map, normalMap, emissiveMap }
function paintStyle(style, seed) {
  const S = 512, bw = S / COLS, fh = S / ROWS, r = mulberry(seed);
  const [ac, a] = cv(S, S), [hc, h] = cv(S, S), [ec, e] = cv(S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  h.fillStyle = '#fff'; h.fillRect(0, 0, S, S);
  const base = { brick: '#7a3e2c', stone: '#b9a990', concrete: '#8a8a86', glass: '#1c2530' }[style];
  a.fillStyle = base; a.fillRect(0, 0, S, S);
  // material grain
  for (let i = 0; i < 9000; i++) {
    const x = r() * S, y = r() * S, v = r();
    a.fillStyle = style === 'glass' ? `rgba(160,190,220,${v * 0.03})` : `rgba(${v < 0.5 ? '0,0,0' : '255,240,220'},${0.03 + r() * 0.05})`;
    a.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
  }
  if (style === 'brick') { // courses + mortar
    for (let y = 0; y < S; y += 4) { a.fillStyle = 'rgba(30,15,10,.18)'; a.fillRect(0, y, S, 1); }
    for (let y = 0; y < S; y += 4) for (let x = (y / 4) % 2 ? 0 : 5; x < S; x += 10) { a.fillStyle = `rgba(${r() < 0.5 ? '40,15,8' : '150,80,55'},${0.15 + r() * 0.2})`; a.fillRect(x, y + 1, 9, 3); }
  }
  if (style === 'concrete') for (let y = 0; y < S; y += fh) { a.fillStyle = 'rgba(0,0,0,.25)'; a.fillRect(0, y, S, 2); for (let x = 0; x < S; x += bw * 2) a.fillRect(x, y, 2, fh); }
  if (style === 'stone') for (let y = 0; y < S; y += fh / 4) { a.fillStyle = 'rgba(60,45,30,.12)'; a.fillRect(0, y, S, 1); }
  for (let fy = 0; fy < ROWS; fy++) {
    const y0 = fy * fh;
    // horizontal bands: string courses, slab edges
    if (style === 'stone') { a.fillStyle = 'rgba(235,225,205,.5)'; a.fillRect(0, y0 + fh - 7, S, 5); h.fillStyle = '#fff'; }
    if (style === 'brick') { a.fillStyle = 'rgba(190,170,150,.55)'; a.fillRect(0, y0 + fh - 4, S, 3); }
    if (style === 'glass') { a.fillStyle = '#3a4550'; a.fillRect(0, y0 + fh - 9, S, 9); h.fillStyle = '#ddd'; h.fillRect(0, y0 + fh - 9, S, 9); }
    if (style === 'concrete') { // ribbon window per floor
      const wy = y0 + fh * 0.28, wh = fh * 0.46;
      a.fillStyle = '#20262c'; a.fillRect(0, wy, S, wh); h.fillStyle = '#222'; h.fillRect(0, wy, S, wh);
      for (let x = 0; x < S; x += bw / 2) { a.fillStyle = '#5c5f60'; a.fillRect(x, wy, 3, wh); h.fillStyle = '#999'; h.fillRect(x, wy, 3, wh); }
      a.fillStyle = 'rgba(150,170,190,.12)'; a.fillRect(0, wy, S, wh * 0.4);
    }
    for (let fx = 0; fx < COLS; fx++) {
      const x0 = fx * bw;
      const lit = r() < (style === 'glass' ? 0.16 : 0.13), warm = r() < 0.75, broken = r() < 0.08, glow = 0.35 + r() * 0.65;
      const fill = (x, y, w, hh) => {
        a.fillStyle = broken ? '#060606' : style === 'glass' ? '#2a3848' : '#141820'; a.fillRect(x, y, w, hh);
        a.fillStyle = 'rgba(170,190,215,.14)'; a.fillRect(x, y, w, hh * 0.35); // sky reflection
        h.fillStyle = '#000'; h.fillRect(x, y, w, hh);
        if (lit && !broken) { e.globalAlpha = glow; e.fillStyle = warm ? '#ffb066' : '#cfe2ff'; e.fillRect(x + 1, y + 1, w - 2, hh - 2); e.globalAlpha = glow * 0.5; e.fillStyle = '#000'; e.fillRect(x + w * (0.2 + r() * 0.5), y, 2 + r() * 4, hh); e.globalAlpha = 1; }
      };
      if (style === 'brick') {
        const w = bw * 0.46, hh = fh * 0.55, x = x0 + (bw - w) / 2, y = y0 + fh * 0.18;
        a.fillStyle = '#c8b8a0'; a.fillRect(x - 3, y - 6, w + 6, 6); a.fillRect(x - 2, y + hh, w + 4, 4); // lintel + sill
        h.fillStyle = '#fff'; fill(x, y, w, hh);
        a.fillStyle = 'rgba(200,200,200,.35)'; a.fillRect(x + w / 2 - 1, y, 2, hh); a.fillRect(x, y + hh / 2, w, 2);
        if (r() < 0.12 && fy < ROWS - 1) { a.fillStyle = 'rgba(25,25,25,.85)'; a.fillRect(x - 6, y + hh + 4, w + 12, 3); for (let k = 0; k < 6; k++) a.fillRect(x - 6 + k * (w + 12) / 5, y + hh - 10, 1.5, 14); } // fire escape slat
      } else if (style === 'stone') {
        const w = bw * 0.3, hh = fh * 0.58, y = y0 + fh * 0.16;
        for (const k of [0.17, 0.53]) { const x = x0 + bw * k; fill(x, y, w, hh); a.fillStyle = 'rgba(240,230,210,.6)'; a.fillRect(x - 2, y + hh, w + 4, 3); a.beginPath(); a.arc(x + w / 2, y + 1, w / 2 + 2, Math.PI, 0); a.fillStyle = 'rgba(120,100,80,.35)'; a.fill(); }
      } else if (style === 'glass') {
        fill(x0 + 2, y0 + 2, bw - 4, fh - 13);
        a.fillStyle = '#56616b'; a.fillRect(x0, y0, 3, fh); h.fillStyle = '#ccc'; h.fillRect(x0, y0, 3, fh);
      } else if (style === 'concrete' && lit) {
        e.globalAlpha = glow; e.fillStyle = warm ? '#ffb066' : '#d6e6ff'; e.fillRect(x0 + 2, y0 + fh * 0.3, bw - 4, fh * 0.42); e.globalAlpha = 1;
      }
    }
  }
  // grime streaks below sills / from the roofline
  for (let k = 0; k < (style === 'glass' ? 10 : 70); k++) { a.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.12})`; a.fillRect(r() * S, r() * S, 1 + r() * 3, 20 + r() * 90); }
  // height -> tangent-space normal map
  const hd = h.getImageData(0, 0, S, S).data, [nc, n] = cv(S, S), out = n.createImageData(S, S);
  const H = (x, y) => hd[(((y + S) % S) * S + ((x + S) % S)) * 4] / 255;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * 2.2, dy = (H(x, y - 1) - H(x, y + 1)) * 2.2, l = Math.hypot(dx, dy, 1), i = (y * S + x) * 4;
    out.data[i] = (dx / l * 0.5 + 0.5) * 255; out.data[i + 1] = (-dy / l * 0.5 + 0.5) * 255; out.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; out.data[i + 3] = 255;
  }
  n.putImageData(out, 0, 0);
  return { map: texOf(ac), normalMap: texOf(nc, false), emissiveMap: texOf(ec) };
}

// four walls of a box as quads with world-scaled UVs (u in tiles along the wall, v in tiles up from the ground)
function walls(w, h, d, y0, u0, v0) {
  const pos = [], nor = [], uv = [], idx = [];
  const sides = [ // [start x,z], [end x,z], normal
    [[-w / 2, d / 2], [w / 2, d / 2], [0, 1]], [[w / 2, d / 2], [w / 2, -d / 2], [1, 0]],
    [[w / 2, -d / 2], [-w / 2, -d / 2], [0, -1]], [[-w / 2, -d / 2], [-w / 2, d / 2], [-1, 0]],
  ];
  let u = u0;
  for (const [a, b, nn] of sides) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = pos.length / 3;
    const ua = u, ub = u + L / TILE_W, va = v0 + y0 / TILE_H, vb = v0 + (y0 + h) / TILE_H;
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y0 + h, b[1], a[0], y0 + h, a[1]);
    for (let i = 0; i < 4; i++) nor.push(nn[0], 0, nn[1]);
    uv.push(ua, va, ub, va, ub, vb, ua, vb);
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    u = ub;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}
const colored = (g, c) => { g = g.index ? g.toNonIndexed() : g; const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); g.deleteAttribute('uv'); return g; };

export function buildSkyline(scene, seed = 21) {
  const r = mulberry(seed);
  const styles = ['brick', 'stone', 'concrete', 'glass'];
  const sets = Object.fromEntries(styles.map((s, i) => [s, paintStyle(s, seed + i * 17)]));
  const geo = { brick: [], stone: [], concrete: [], glass: [] }, detail = [];
  const C = (hex) => new THREE.Color(hex);
  const roofCol = { brick: C('#2b2624'), stone: C('#3a342e'), concrete: C('#3b3b3a'), glass: C('#2a2f35') };
  const trimCol = { brick: C('#a89480'), stone: C('#cdbfa6'), concrete: C('#77756f'), glass: C('#4c5660') };
  const place = (g, x, z, rot) => { g.rotateY(rot); g.translate(x, 0, z); return g; };
  const box = (w, h, d, x, y, z, col) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), col);

  const building = (x, z, rot, style, w, d, h) => {
    const parts = [];
    const tiers = style === 'glass' ? 1 + (r() < 0.5 ? 1 : 0) : style === 'concrete' ? 1 : r() < 0.55 ? 2 : 1;
    let y = 0, cw = w, cd = d, th = tiers === 2 ? h * (0.6 + r() * 0.15) : h;
    const u0 = Math.floor(r() * COLS) / COLS, v0 = Math.floor(r() * ROWS) / ROWS;
    for (let t = 0; t < tiers; t++) {
      const hh = Math.round(th / FLOOR) * FLOOR;
      geo[style].push(place(walls(cw, hh, cd, y, u0 + t * 0.37, v0), x, z, rot));
      y += hh;
      // roof slab, cornice / parapet
      parts.push(box(cw, 0.2, cd, 0, y, 0, roofCol[style]));
      if (style === 'glass') parts.push(box(cw + 0.2, 0.9, cd + 0.2, 0, y - 0.9, 0, trimCol[style]));
      else {
        parts.push(box(cw + (style === 'concrete' ? 0.3 : 1.0), style === 'concrete' ? 0.5 : 0.7, cd + (style === 'concrete' ? 0.3 : 1.0), 0, y - 0.35, 0, trimCol[style])); // cornice
        for (const [px, pz, pw, pd] of [[0, cd / 2, cw, 0.3], [0, -cd / 2, cw, 0.3], [cw / 2, 0, 0.3, cd], [-cw / 2, 0, 0.3, cd]]) parts.push(box(pw, 1.0, pd, px, y, pz, roofCol[style])); // parapet
      }
      // set back for the next tier
      cw *= 0.6 + r() * 0.2; cd *= 0.6 + r() * 0.2; th = h - y + r() * 8;
    }
    // rooftop clutter on the top tier
    const top = y;
    if ((style === 'brick' || style === 'stone') && r() < 0.65) { // timber water tower on steel legs
      const wx = (r() - 0.5) * cw * 0.5, wz = (r() - 0.5) * cd * 0.5, R = 1.6 + r() * 0.8, H = 3 + r() * 1.5;
      for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) parts.push(box(0.18, 3, 0.18, wx + lx * R * 0.7, top, wz + lz * R * 0.7, C('#2a2a2a')));
      parts.push(colored(new THREE.CylinderGeometry(R, R, H, 10, 1, true).translate(wx, top + 3 + H / 2, wz), C('#5a4636')));
      parts.push(colored(new THREE.CylinderGeometry(R * 0.98, R * 0.98, 0.2, 10).translate(wx, top + 3, wz), C('#3a2e24')));
      parts.push(colored(new THREE.ConeGeometry(R * 1.08, 1.3, 10).translate(wx, top + 3 + H + 0.65, wz), C('#3a3634')));
    }
    const hv = Math.floor(r() * 4) + (style === 'glass' ? 1 : 0);
    for (let k = 0; k < hv; k++) { const bw = 1.5 + r() * 2.5, bd = 1.2 + r() * 2, bh = 1 + r() * 1.6; parts.push(box(bw, bh, bd, (r() - 0.5) * (cw / 0.7 - bw) * 0.6, top, (r() - 0.5) * (cd / 0.7 - bd) * 0.6, C(r() < 0.5 ? '#585a5c' : '#47494a'))); }
    if (r() < 0.35) parts.push(box(2.4, 2.6, 2.4, (r() - 0.5) * cw * 0.3, top, (r() - 0.5) * cd * 0.3, roofCol[style])); // stair bulkhead
    if (style === 'glass' || r() < 0.3) { // antenna mast / spire
      const ah = style === 'glass' && h > 60 ? 12 + r() * 14 : 4 + r() * 6;
      parts.push(colored(new THREE.CylinderGeometry(0.08, 0.22, ah, 5).translate((r() - 0.5) * cw * 0.3, top + ah / 2, (r() - 0.5) * cd * 0.3), C('#2c2c2e')));
    }
    for (const p of parts) detail.push(place(p, x, z, rot));
  };

  // rings around the plaza: walk-ups close in, towers behind; leave the gate sight-lines a bit more open
  const rings = [[76, 16, 20, 42, ['brick', 'stone', 'brick', 'concrete']], [92, 24, 28, 70, ['stone', 'concrete', 'brick', 'glass']], [128, 22, 45, 115, ['glass', 'concrete', 'glass', 'stone']]];
  let count = 0;
  for (const [R0, n, hMin, hMax, mix] of rings) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.12, d = R0 + (r() - 0.5) * 14;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const style = mix[Math.floor(r() * mix.length)];
    const w = style === 'glass' ? 14 + r() * 12 : 12 + r() * 14, dd = w * (0.7 + r() * 0.5);
    const h = hMin + Math.pow(r(), 1.6) * (hMax - hMin) * (style === 'glass' ? 1.25 : 1);
    building(x, z, -a + Math.PI / 2, style, w, dd, h); count++;
  }

  const group = new THREE.Group(); group.name = 'skyline';
  const props = { brick: [0.9, 0], stone: [0.85, 0], concrete: [0.92, 0], glass: [0.18, 0.7] };
  for (const s of styles) {
    if (!geo[s].length) continue;
    const T = sets[s];
    const m = new THREE.MeshStandardMaterial({ color: { brick: '#a99ca0', stone: '#8f8790', concrete: '#8d8790', glass: '#a8a6b4' }[s], map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), emissiveMap: T.emissiveMap, emissive: C('#ffffff'), emissiveIntensity: 1.9, roughness: props[s][0], metalness: props[s][1], envMapIntensity: s === 'glass' ? 1.4 : 0.5 });
    const mesh = new THREE.Mesh(mergeGeometries(geo[s]), m); mesh.matrixAutoUpdate = false; group.add(mesh);
  }
  const dm = new THREE.Mesh(mergeGeometries(detail), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.1 }));
  dm.matrixAutoUpdate = false; group.add(dm);
  // haze: a soft, fog-coloured gradient band at the horizon sits in front of the far ring
  scene.add(group);
  let tris = 0; group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
  return { group, count, tris, drawCalls: group.children.length };
}
