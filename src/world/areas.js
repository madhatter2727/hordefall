// M13 — locked areas behind buyable barriers: THE DEPOT ROOF (chained gate at the foot of a caged steel
// stair) and THE UNDERPASS (an old subway concourse behind a roll-up shutter). Buying a barrier plays its
// opening animation + sound, removes its collider, and tells the game to rebuild nav / minimap / spawns.
// Opened areas stay open for the rest of the run; reset() closes them again on restart.
import * as THREE from 'three';
import { AREAS } from '../tuning.js';
import { corrugated, concrete } from './textures.js';

const std = (o) => new THREE.MeshStandardMaterial(o);

function signTex(lines, { w = 512, h = 160, bg = '#12100e', fg = '#ffd27a', accent = '#ff6a2a' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = accent; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach(([t, size, col], i) => { g.font = `900 ${size}px Impact, Arial Black, sans-serif`; g.fillStyle = col || fg; g.fillText(t, w / 2, h * (lines.length === 1 ? 0.5 : 0.32 + i * 0.4)); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function meshTex() { // wire-mesh cage panel (alpha tested)
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 5;
  for (let i = -128; i < 256; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke(); g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
function tileTex() { // cream subway tiles with grime toward the floor
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#6d6a60'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16) for (let x = 0; x < 256; x += 32) {
    const v = 190 + Math.random() * 30 - y * 0.25; g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.88})`; g.fillRect(x + ((y / 16) % 2) * 16 + 1, y + 1, 30, 14);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

export class Areas {
  constructor(scene, colliders, hooks = {}) {
    this.scene = scene; this.colliders = colliders; this.hooks = hooks;
    this.group = new THREE.Group(); scene.add(this.group);
    this.mat = {
      steel: std({ color: '#3b3d40', metalness: 0.75, roughness: 0.45 }),
      dark: std({ color: '#1d1e20', metalness: 0.6, roughness: 0.6 }),
      yellow: std({ color: '#c99a1e', metalness: 0.3, roughness: 0.55 }),
      cage: std({ color: '#8a9096', metalness: 0.8, roughness: 0.4, alphaMap: meshTex(), alphaTest: 0.5, side: THREE.DoubleSide }),
      brick: std({ ...corrugated({ color: [92, 98, 90], seed: 21 }), metalness: 0.35 }),
      roof: std({ color: '#2a2826', roughness: 0.95 }),
      tile: std({ map: tileTex(), roughness: 0.4 }),
      floor: std({ ...concrete({ seed: 41, base: [70, 68, 66], size: 256 }), roughness: 0.7 }),
      chain: std({ color: '#9aa0a6', metalness: 0.9, roughness: 0.3 }),
      tube: std({ color: '#000', emissive: new THREE.Color('#d8f2ff'), emissiveIntensity: 2.2 }),
    };
    this.tubes = [];
    this.list = AREAS.list.map((def) => ({ def, id: def.id, open: false, t: 0, cols: [], barrier: null, spawns: def.spawns.map(([x, y, z]) => new THREE.Vector3(x, y, z)) }));
    for (const a of this.list) (a.id === 'roof' ? this.buildRoof : this.buildUnderpass).call(this, a);
  }
  box(w, h, d, x, y, z, mat, col = null, shadow = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; this.group.add(m);
    if (col) this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2, minZ: z - d / 2, maxZ: z + d / 2, walk: false, mat: 'metal', ...col });
    return m;
  }
  col(minX, maxX, minY, maxY, minZ, maxZ, extra = {}) { const c = { minX, maxX, minY, maxY, minZ, maxZ, walk: false, mat: 'metal', ...extra }; this.colliders.push(c); return c; }
  priceSign(a, w, x, y, z, ry) {
    const tex = signTex([[a.def.name, 58], [`${a.def.price} POINTS  ·  F TO OPEN`, 40, '#ffffff']]);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.31), std({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6 }));
    m.position.set(x, y, z); m.rotation.y = ry; this.group.add(m); return m;
  }

  // ---------- THE DEPOT ROOF: warehouse block in the NW corner, caged steel stair, chained gate ----------
  buildRoof(a) {
    const [x0, z0] = a.def.rect, Y = a.def.roofY, xe = -25.5, ze = -27.5; // roof block east / south edges
    const cx = (x0 + xe) / 2, cz = (z0 + ze) / 2, W = xe - x0, D = ze - z0;
    this.box(W, Y, D, cx, Y / 2, cz, this.mat.brick, { walk: true, mat: 'concrete' });
    this.box(W - 0.1, 0.06, D - 0.1, cx, Y + 0.03, cz, this.mat.roof, null, false);
    const depot = signTex([['DEPOT 7', 80, '#e8e1d0']], { bg: '#5a1e16', accent: '#e8e1d0', w: 512, h: 128 });
    const ds = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), std({ map: depot, roughness: 0.8 })); ds.position.set(cx - 1.5, 2.3, ze + 0.02); this.group.add(ds);
    this.box(3.4, 2.4, 0.1, cx + 2.6, 1.2, ze + 0.04, std({ ...corrugated({ color: [120, 104, 70], seed: 22 }) }), null, false); // painted roll door (shut)
    // parapets (taller than nav "TALL", so zombies can't step off the roof edges)
    const P = 0.9, pt = 0.25;
    this.box(W, P, pt, cx, Y + P / 2, ze - pt / 2, this.mat.brick, { mat: 'concrete' });
    this.box(pt, P, (-31.6) - z0, xe - pt / 2, Y + P / 2, (z0 - 31.6) / 2, this.mat.brick, { mat: 'concrete' });
    this.box(pt, P, ze - (-28.4), xe - pt / 2, Y + P / 2, (ze - 28.4) / 2, this.mat.brick, { mat: 'concrete' });
    // caged steel stair (8 x 0.4 m risers) climbing west from the gate to the roof
    const zs0 = -31.4, zs1 = -28.6, zw = zs1 - zs0, zc = (zs0 + zs1) / 2;
    for (let k = 1; k <= 8; k++) {
      const xa = -20.7 - 0.6 * k, xb = xa + 0.6, h = 0.4 * k;
      this.col(xa, xb, 0, h, zs0, zs1, { walk: true });
      this.box(0.6, 0.06, zw, (xa + xb) / 2, h - 0.03, zc, this.mat.steel, null, false);
      this.box(0.03, 0.4, zw - 0.1, xb - 0.02, h - 0.2, zc, this.mat.dark, null, false); // riser
      this.box(0.07, 0.035, zw, xb - 0.035, h - 0.017, zc, this.mat.yellow, null, false); // hazard nosing
    }
    const len = 5.3, xm = -25.5 + len / 2;
    for (const zz of [zs0 - 0.1, zs1 + 0.1]) {
      this.col(-25.5, -20.2, 0, 3.7, zz - 0.1, zz + 0.1);
      const stringer = this.box(len * 1.07, 0.3, 0.12, xm, 1.75, zz, this.mat.steel); stringer.rotation.z = -Math.atan2(3.2, 4.8);
      const cage = new THREE.Mesh(new THREE.PlaneGeometry(len, 3.6), this.mat.cage); cage.position.set(xm, 1.85, zz); cage.material.map = null; cage.material.alphaMap.repeat.set(len, 3.6); this.group.add(cage);
      for (let i = 0; i <= 4; i++) this.box(0.1, 3.7, 0.1, -25.5 + i * (len / 4), 1.85, zz, this.mat.dark);
      this.box(len, 0.1, 0.12, xm, 3.7, zz, this.mat.dark);
    }
    // the chained gate at the stair foot
    const gx = a.def.barrier.x, leafW = zw / 2;
    a.cols.push(this.col(gx - 0.1, gx + 0.1, 0, 3.4, zs0, zs1));
    this.box(0.16, 3.6, 0.16, gx, 1.8, zs0 - 0.08, this.mat.dark); this.box(0.16, 3.6, 0.16, gx, 1.8, zs1 + 0.08, this.mat.dark);
    const leaf = (hz, dir) => {
      const piv = new THREE.Group(); piv.position.set(gx, 0, hz); this.group.add(piv);
      const add = (w, h, d, x, y, z, m) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; piv.add(b); };
      for (const y of [0.25, 1.7, 3.15]) add(0.07, 0.1, leafW, 0, y, dir * leafW / 2, this.mat.steel);
      for (let i = 0; i <= 7; i++) add(0.045, 3.0, 0.045, 0, 1.7, dir * (0.05 + i * (leafW - 0.1) / 7), this.mat.steel);
      const diag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, Math.hypot(leafW, 1.45)), this.mat.steel); diag.position.set(0, 0.97, dir * leafW / 2); diag.rotation.x = dir * Math.atan2(1.45, leafW); piv.add(diag);
      return piv;
    };
    const L = leaf(zs0, 1), R = leaf(zs1, -1);
    // chain wrapped across both leaves + a padlock
    const chain = new THREE.Group(); chain.position.set(gx + 0.08, 0, zc); this.group.add(chain);
    const link = new THREE.TorusGeometry(0.045, 0.014, 5, 10);
    for (const [y0, tilt] of [[1.55, 0.35], [1.75, -0.3]]) for (let i = -9; i <= 9; i++) {
      const m = new THREE.Mesh(link, this.mat.chain); m.position.set(0, y0 + i * 0.075 * Math.sin(tilt), i * 0.075 * Math.cos(tilt)); m.rotation.set(i % 2 ? Math.PI / 2 : 0, Math.PI / 2, 0); chain.add(m);
    }
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.13), std({ color: '#b08a2c', metalness: 0.85, roughness: 0.3 })); lock.position.set(0.04, 1.55, 0); chain.add(lock);
    const sign = this.priceSign(a, 2.4, gx + 0.14, 2.75, zc, Math.PI / 2);
    a.barrier = { kind: 'gate', L, R, chain, sign, front: new THREE.Vector3(gx + 1.2, 0, zc) };
    // rooftop details: AC unit (cover), roof hatch where zombies climb out, vent stacks
    this.box(1.6, 1.2, 1.3, -34.6, Y + 0.6, -34.6, this.mat.steel, { mat: 'metal' });
    for (const [hx, hz] of [[-30, -34.2], [-34.2, -28.8]]) {
      this.box(1.1, 0.16, 1.1, hx, Y + 0.08, hz, this.mat.dark, null, false);
      const lid = this.box(1.0, 0.06, 1.0, hx, Y + 0.6, hz - 0.45, this.mat.steel, null, false); lid.rotation.x = -1.2;
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), std({ color: '#000', roughness: 1 })); hole.rotation.x = -Math.PI / 2; hole.position.set(hx, Y + 0.17, hz); this.group.add(hole);
    }
    for (const vx of [-28, -27.4]) { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.4, 10), this.mat.steel); v.position.set(vx, Y + 0.7, -35.3); this.group.add(v); }
  }

  // ---------- THE UNDERPASS: tiled subway concourse in the SE corner behind a roll-up shutter ----------
  buildUnderpass(a) {
    const [x0, z0] = a.def.rect, x1 = 36.6, z1 = 36.6, Hh = 4.4, sx0 = 29.5, sx1 = 32.5, sh = 3.7, b = a.def.barrier;
    // outer walls (concrete outside, tiles inside), ceiling slab high enough for the Colossus
    this.box(0.4, Hh, z1 - z0, x0, Hh / 2, (z0 + z1) / 2, this.mat.brick, { mat: 'concrete' });
    this.box(sx0 - x0, Hh, 0.4, (x0 + sx0) / 2, Hh / 2, z0, this.mat.brick, { mat: 'concrete' });
    this.box(x1 - sx1, Hh, 0.4, (sx1 + x1) / 2, Hh / 2, z0, this.mat.brick, { mat: 'concrete' });
    this.box(sx1 - sx0, Hh - sh, 0.4, (sx0 + sx1) / 2, sh + (Hh - sh) / 2, z0, this.mat.brick, { mat: 'concrete' });
    this.box(0.4, Hh, z1 - z0, 35.7, Hh / 2, (z0 + z1) / 2, this.mat.brick, { mat: 'concrete' });
    this.box(x1 - x0, Hh, 0.4, (x0 + x1) / 2, Hh / 2, 35.7, this.mat.brick, { mat: 'concrete' });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(35.5 - x0, 35.5 - z0), std({ color: '#55575a', emissive: '#23262a', roughness: 0.9 })); ceil.rotation.x = Math.PI / 2; ceil.position.set((x0 + 35.5) / 2, 3.89, (z0 + 35.5) / 2); this.group.add(ceil);
    this.box(x1 - x0, 0.4, z1 - z0, (x0 + x1) / 2, 4.1, (z0 + z1) / 2, this.mat.dark, { mat: 'concrete', minY: 3.9 });
    const ti = this.mat.tile.clone(); ti.map = this.mat.tile.map.clone(); ti.map.repeat.set(7, 3.2); ti.map.needsUpdate = true;
    const wall = (w, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 3.9), ti); m.position.set(x, 1.95, z); m.rotation.y = ry; m.receiveShadow = true; this.group.add(m); };
    wall(35.5 - x0, (x0 + 35.5) / 2, 35.48, Math.PI); wall(35.5 - z0, 35.48, (z0 + 35.5) / 2, -Math.PI / 2); wall(35.5 - z0, x0 + 0.21, (z0 + 35.5) / 2, Math.PI / 2);
    wall(sx0 - x0, (x0 + sx0) / 2, z0 + 0.21, 0); wall(35.5 - sx1, (sx1 + 35.5) / 2, z0 + 0.21, 0);
    const band = std({ color: '#2f5b4a', roughness: 0.5 }); // painted band round the concourse at head height
    this.box(35.5 - x0 - 0.4, 0.22, 0.02, (x0 + 35.5) / 2, 2.3, 35.46, band, null, false); this.box(0.02, 0.22, 35.5 - z0 - 0.4, 35.46, 2.3, (z0 + 35.5) / 2, band, null, false);
    this.box(0.02, 0.22, 35.5 - z0 - 0.4, x0 + 0.22, 2.3, (z0 + 35.5) / 2, band, null, false);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(35.5 - x0, 35.5 - z0), this.mat.floor); fl.rotation.x = -Math.PI / 2; fl.position.set((x0 + 35.5) / 2, 0.012, (z0 + 35.5) / 2); fl.receiveShadow = true; this.group.add(fl);
    // yellow platform-edge strip + a stairwell down to the trains (spawn point at its top)
    this.box(35.5 - x0 - 0.4, 0.02, 0.3, (x0 + 35.5) / 2, 0.03, 35.2, this.mat.yellow, null, false);
    this.col(33.1, 36.5, 0, 3.85, 33.7, 36.5);
    const well = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.7), std({ color: '#050505', roughness: 1 })); well.rotation.x = -Math.PI / 2; well.position.set(34.3, 0.03, 34.6); this.group.add(well);
    for (let k = 0; k < 5; k++) this.box(2.1, 0.05, 0.3, 34.3, 0.035, 33.95 + k * 0.3, std({ color: new THREE.Color().setScalar(0.18 - k * 0.028), roughness: 0.9 }), null, false);
    for (const rx of [33.15, 35.4]) this.box(0.06, 1.0, 1.75, rx, 0.5, 34.55, this.mat.steel, null, false);
    this.box(2.3, 0.06, 0.06, 34.3, 1.0, 33.68, this.mat.steel, null, false);
    const tr = signTex([['TRAINS  ↓', 70, '#ffffff']], { bg: '#163a6b', accent: '#ffffff', w: 512, h: 128 });
    const ts = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), std({ map: tr, emissive: '#ffffff', emissiveMap: tr, emissiveIntensity: 0.6 })); ts.position.set(34.3, 3.3, 33.66); ts.rotation.y = Math.PI; this.group.add(ts);
    const ln = signTex([['LINE 4 · CANAL ST', 54, '#ffffff']], { bg: '#7a1f1f', accent: '#ffffff', w: 512, h: 112 });
    const ls = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7), std({ map: ln, roughness: 0.6 })); ls.position.set(x0 + 0.23, 2.6, 31); ls.rotation.y = Math.PI / 2; this.group.add(ls);
    // pillars + flickering fluorescent tubes (emissive only, no extra real-time lights)
    for (const [px, pz] of [[29.5, 31.5]]) this.box(0.6, 3.9, 0.6, px - 1.6, 1.95, pz + 2.6, this.mat.tile, { mat: 'concrete' });
    for (const [tx, tz] of [[28.5, 29.5], [32.5, 29.5], [28.5, 33.5], [31.5, 33.5]]) {
      this.box(0.18, 0.08, 1.4, tx, 3.85, tz, this.mat.dark, null, false);
      const t = this.box(0.08, 0.05, 1.3, tx, 3.8, tz, this.mat.tube.clone(), null, false);
      this.tubes.push({ m: t, bad: this.tubes.length === 1, seed: Math.random() * 10 });
    }
    // roll-up shutter + motor drum above the doorway (outside face)
    const SW = sx1 - sx0, sm = std({ ...corrugated({ color: [150, 156, 150], seed: 33 }), color: '#a9c0c8', metalness: 0.6 });
    for (const k of ['map', 'normalMap', 'roughnessMap']) { sm[k] = sm[k].clone(); sm[k].wrapS = sm[k].wrapT = THREE.RepeatWrapping; sm[k].repeat.set(3.2, 1); sm[k].needsUpdate = true; }
    const sg = new THREE.BoxGeometry(SW - 0.1, sh, 0.08), uv = sg.attributes.uv; // swap u/v so the ribs run sideways (roll-up slats)
    for (let i = 0; i < uv.count; i++) { const u = uv.getX(i); uv.setX(i, uv.getY(i)); uv.setY(i, u); }
    const shutter = new THREE.Mesh(sg, sm); shutter.geometry.translate(0, -sh / 2, 0); shutter.position.set(b.x, sh, z0 - 0.22); shutter.castShadow = true; this.group.add(shutter);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, SW + 0.2, 14), this.mat.steel); drum.rotation.z = Math.PI / 2; drum.position.set(b.x, sh + 0.2, z0 - 0.5); this.group.add(drum);
    for (const gx of [sx0 + 0.05, sx1 - 0.05]) this.box(0.12, sh, 0.12, gx, sh / 2, z0 - 0.3, this.mat.dark);
    const hz = new THREE.Mesh(new THREE.PlaneGeometry(SW, 0.25), std({ color: '#c99a1e' })); hz.position.set(b.x, 0.14, z0 - 0.27); hz.rotation.y = Math.PI; this.group.add(hz);
    a.cols.push(this.col(sx0, sx1, 0, sh, z0 - 0.3, z0 + 0.2));
    const sign = this.priceSign(a, 2.6, b.x, sh + 0.35, z0 - 0.22 - 0.03, Math.PI);
    sign.position.z = z0 - 0.23; sign.scale.setScalar(0.95);
    sign.position.y = 3.98;
    a.barrier = { kind: 'shutter', shutter, sh, sign, front: new THREE.Vector3(b.x, 0, z0 - 1.3) };
  }

  isOpen(id) { return !!this.list.find((a) => a.id === id)?.open; }
  openSpawns() { const out = []; for (const a of this.list) if (a.open) out.push(...a.spawns); return out; }
  // the locked barrier the player is standing at and facing, if any
  target(pos, look) {
    for (const a of this.list) {
      if (a.open) continue;
      const f = a.barrier.front, dx = f.x - pos.x, dz = f.z - pos.z;
      if (Math.hypot(dx, dz) > 2.6 || Math.abs(pos.y - f.y) > 2) continue;
      const bx = a.def.barrier.x - pos.x, bz = a.def.barrier.z - pos.z, bl = Math.hypot(bx, bz) || 1;
      if (look && (look.x * bx + look.z * bz) / bl < 0.2) continue;
      return a;
    }
    return null;
  }
  open(a, silent = false) {
    if (a.open) return;
    a.open = true; a.t = silent ? 99 : 0;
    for (const c of a.cols) { const i = this.colliders.indexOf(c); if (i >= 0) this.colliders.splice(i, 1); }
    if (!silent) this.hooks.audio?.play(a.barrier.kind === 'gate' ? 'gateOpen' : 'shutterOpen');
    this.hooks.onOpen?.(a);
  }
  update(dt, time) {
    for (const a of this.list) {
      const B = a.barrier;
      if (a.open && a.t < 3) a.t += dt;
      const t = a.open ? Math.min(a.t, 3) : 0;
      if (B.kind === 'gate') {
        // chain + padlock drop and fade, then the leaves swing outward with a little overshoot
        const fall = Math.min(1, t / 0.5);
        B.chain.position.y = -1.45 * fall * fall; B.chain.rotation.x = fall * 0.6; B.chain.visible = t < 2.2;
        const s = THREE.MathUtils.clamp((t - 0.5) / 1.1, 0, 1), e = 1 - Math.pow(1 - s, 3), bounce = s >= 1 ? Math.sin(Math.min(1, (t - 1.6) / 0.6) * Math.PI) * 0.06 * (1 - Math.min(1, (t - 1.6) / 0.6)) : 0;
        const ang = (e * 1.75) - bounce;
        B.L.rotation.y = ang; B.R.rotation.y = -ang;
        B.sign.visible = !a.open;
      } else {
        const s = THREE.MathUtils.clamp((t - 0.12) / 1.7, 0, 1), e = s * s * (3 - 2 * s);
        B.shutter.scale.y = Math.max(0.04, 1 - e); B.shutter.position.y = B.sh + e * 0.15;
        B.shutter.position.x = a.def.barrier.x + (s > 0 && s < 1 ? Math.sin(time * 70) * 0.008 : 0);
        B.sign.visible = !a.open;
      }
    }
    for (const T of this.tubes) {
      const fl = T.bad ? (Math.sin(time * 37 + T.seed) > 0.55 || Math.sin(time * 2.3 + T.seed) > 0.8 ? 0.15 : 1) : 0.92 + 0.08 * Math.sin(time * 120 + T.seed);
      T.m.material.emissiveIntensity = 2.2 * fl;
    }
  }
  reset() {
    let changed = false;
    for (const a of this.list) if (a.open) { a.open = false; a.t = 0; for (const c of a.cols) this.colliders.push(c); changed = true; }
    this.update(0, 0);
    if (changed) this.hooks.onReset?.();
  }
  // footprints for the minimap: locked areas get a red hatch + padlock, open ones a green outline
  mapRects() { return this.list.map((a) => ({ rect: a.def.rect, open: a.open, name: a.def.name, price: a.def.price, gate: a.def.barrier })); }
}
