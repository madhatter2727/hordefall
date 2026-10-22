import * as THREE from 'three';
import { CRATE, FORGE } from '../tuning.js';

// M11: the SALVAGE CRATE (mystery weapon roulette) and THE FORGE (one-tier weapon upgrade machine).
// Both are solid props (colliders are added before the nav grids are built); everything else is state + visuals.

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.userData.canvas = c; return t;
}
function grain(g, w, h, n, a) { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 6, 1 + Math.random() * 2); } }

// painted steel with dents/scuffs + stencil
function crateSkin() {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = '#3d4a33'; g.fillRect(0, 0, w, h); grain(g, w, h, 3000, 0.08);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 6; for (let x = 32; x < w; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.fillStyle = 'rgba(230,220,190,.75)'; g.font = '700 46px Teko, Impact, sans-serif'; g.textAlign = 'left'; g.fillText('SALVAGE', 26, 72);
    g.font = '600 22px Teko, Impact, sans-serif'; g.fillText('UNIT 7 · HANDLE WITH CARE', 28, 104);
    g.fillStyle = 'rgba(120,80,40,.4)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, h - 30 + Math.random() * 30, 4 + Math.random() * 30, 2 + Math.random() * 6); // rust at the bottom
  });
}
function questionTex(col) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#05070a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = col; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = col; g.font = '700 200px Teko, Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, h / 2 + 14);
  });
}
function hazardTex() {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#d9a21a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16140f'; for (let x = -64; x < w + 64; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
    grain(g, w, h, 600, 0.15);
  });
}
function forgeSkin() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b2e33'; g.fillRect(0, 0, w, h); grain(g, w, h, 6000, 0.08);
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 4; for (let y = 64; y < h; y += 128) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = 'rgba(160,165,170,.6)'; for (let y = 64; y < h; y += 128) for (let x = 20; x < w; x += 60) { g.beginPath(); g.arc(x, y - 10, 4, 0, 6.3); g.fill(); g.beginPath(); g.arc(x, y + 10, 4, 0, 6.3); g.fill(); }
    g.fillStyle = 'rgba(110,60,25,.35)'; for (let i = 0; i < 90; i++) g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 8 + Math.random() * 50); // rust streaks
  });
}

// a gun from the view-model set, without hands, as a world prop
function displayGun(arsenal, id) {
  const model = arsenal.all[id]?.model; if (!model) return null;
  const M = arsenal.models.materials, hide = new Set([M.glove, M.knuckle, M.palm, M.sleeve, M.cuff]);
  const gun = model.root.clone(true); gun.visible = true;
  gun.traverse((o) => { if (o.isMesh && hide.has(o.material)) o.visible = false; if (o.isLight) o.visible = false; if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  if (model.leftHand) { const i = model.root.children.indexOf(model.leftHand); if (i >= 0) gun.children[i].visible = false; }
  // strip the muzzle flash / light the arsenal parents to the current gun
  for (const c of [...gun.children]) if (c.type === 'Group' && c.children.some((k) => k.material?.blending === THREE.AdditiveBlending)) gun.remove(c);
  const wrap = new THREE.Group(); wrap.add(gun);
  const box = new THREE.Box3().setFromObject(gun), ctr = box.getCenter(new THREE.Vector3()); gun.position.sub(ctr);
  wrap.userData.len = box.getSize(new THREE.Vector3()).z;
  return wrap;
}

function beamMesh(color) {
  const tex = canvasTex(4, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,1)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 16, 16, 1, true), new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  m.geometry.translate(0, 8, 0); m.renderOrder = 3; return m;
}

export class Stations {
  // hooks: { audio, spark(pos, color, n), smoke(pos), banner(title, sub), pts(), spend(n), refund(n), give(id), wave(), ownsId(id) }
  constructor(scene, colliders, arsenal, hooks) {
    this.scene = scene; this.arsenal = arsenal; this.hooks = hooks; this.t = 0;
    this.buildCrates(colliders);
    this.buildForge(colliders);
    // camo for upgraded guns: one animated texture shared by every upgraded material
    this.camo = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 46; i++) { const x = Math.random() * w, y = Math.random() * h, r = 10 + Math.random() * 34; const gr = g.createRadialGradient(x, y, 0, x, y, r); const c = ['#ff3df0', '#3df5ff', '#8a5bff', '#ff9a2e'][i % 4]; gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.fill(); }
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2; for (let i = 0; i < 30; i++) { g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 40; y += (Math.random() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
    });
    this.camo.wrapS = this.camo.wrapT = THREE.RepeatWrapping; this.camo.repeat.set(0.35, 0.35);
    this._v = new THREE.Vector3();
  }

  // ------------------------------------------------------------------ crate
  buildCrates(colliders) {
    const skin = crateSkin();
    const body = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.7, metalness: 0.45 });
    const steel = new THREE.MeshStandardMaterial({ color: '#2a2c2f', roughness: 0.45, metalness: 0.85 });
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4a2c', roughness: 0.9, metalness: 0 });
    const W = 1.5, H = 0.62, D = 0.8, PH = 0.14;
    this.crates = CRATE.spots.map((s, i) => {
      const g = new THREE.Group(); g.position.set(s.x, 0, s.z); g.rotation.y = s.ry;
      // pallet
      for (const z of [-0.3, 0, 0.3]) { const b = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.1, 0.14), wood); b.position.set(0, 0.05, z); g.add(b); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, 0.04, D + 0.06), wood); top.position.y = PH - 0.02; g.add(top);
      // box body, corner brackets, carry handles
      const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), body); box.position.y = PH + H / 2; box.castShadow = box.receiveShadow = true; g.add(box);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, H + 0.02, 0.1), steel); c.position.set(sx * (W / 2 - 0.03), PH + H / 2, sz * (D / 2 - 0.03)); g.add(c); }
      for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 14, Math.PI), steel); h.position.set(sx * (W / 2 + 0.01), PH + H * 0.62, 0); h.rotation.set(0, Math.PI / 2, Math.PI); g.add(h); }
      // glowing "?" panel on the front
      const qOn = questionTex('#6fe3ff'), qOff = questionTex('#2a3036');
      const panelMat = new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: qOn, emissiveIntensity: 2.2, roughness: 0.4 });
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), panelMat); panel.position.set(0, PH + H / 2, D / 2 + 0.006); g.add(panel);
      // lid on a hinge at the back top edge
      const hinge = new THREE.Group(); hinge.position.set(0, PH + H, -D / 2); g.add(hinge);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(W + 0.04, 0.08, D + 0.04), body); lid.position.set(0, 0.04, D / 2); lid.castShadow = true; hinge.add(lid);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 12), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#6fe3ff', emissiveIntensity: 3 })); lamp.position.set(W / 2 - 0.16, 0.115, D / 2 + 0.2); hinge.add(lamp);
      // chains + padlock (dormant crates only)
      const chains = new THREE.Group();
      for (const x of [-0.42, 0.42]) { const c = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.014, 5, 30), steel); c.scale.set(1, 0.9, 1.05); c.rotation.y = Math.PI / 2; c.position.set(x, PH + H / 2 + 0.03, 0); chains.add(c); }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.04), new THREE.MeshStandardMaterial({ color: '#a2864a', metalness: 0.9, roughness: 0.35 })); lock.position.set(0.42, PH + 0.18, D / 2 + 0.05); chains.add(lock);
      g.add(chains);
      const light = this.crateLight || (this.crateLight = new THREE.PointLight('#6fe3ff', 0, 5, 2)); // one light, moved to the live crate
      const beam = beamMesh(new THREE.Color(0.35, 0.85, 1.4)); beam.position.y = PH + H + 1.7; g.add(beam);
      // "CRATE MOVED" sign (shown at the old spot, arrow pointing at the new one)
      const sign = new THREE.Group(); sign.position.set(0, PH + H + 0.75, 0); sign.visible = false; this.scene.add(sign); sign.position.add(g.position);
      this.scene.add(g);
      colliders.push({ minX: s.x - (Math.abs(Math.sin(s.ry)) > 0.5 ? D : W) / 2 - 0.05, maxX: s.x + (Math.abs(Math.sin(s.ry)) > 0.5 ? D : W) / 2 + 0.05, minY: 0, maxY: PH + H + 0.08, minZ: s.z - (Math.abs(Math.sin(s.ry)) > 0.5 ? W : D) / 2 - 0.05, maxZ: s.z + (Math.abs(Math.sin(s.ry)) > 0.5 ? W : D) / 2 + 0.05, walk: false, mat: 'metal' });
      const normal = new THREE.Vector3(Math.sin(s.ry), 0, Math.cos(s.ry));
      return { i, spot: s, group: g, hinge, panel, panelMat, qOn, qOff, lamp, chains, light, beam, sign, normal, pos: new THREE.Vector3(s.x, 0, s.z), top: PH + H };
    });
    this.crateLight.position.set(0, 0.22 + 0.62 + 0.6, 0.3);
    this.crate = { at: 0, state: 'idle', t: 0, spins: 0, shown: null, result: null, lid: 0, next: -1 };
    this.setActive(0);
    // gun displays for the roulette, built lazily on first use (the arsenal builds models before us)
    this.displays = {};
  }
  display(id) {
    if (this.displays[id] === undefined) { const d = displayGun(this.arsenal, id); if (d) { d.visible = false; d.scale.setScalar(1.25); this.scene.add(d); } this.displays[id] = d; }
    return this.displays[id];
  }
  setActive(i) {
    this.crate.at = i;
    for (const c of this.crates) {
      const on = c.i === i;
      c.chains.visible = !on; c.panelMat.emissiveMap = on ? c.qOn : c.qOff; c.panelMat.emissiveIntensity = on ? 2.2 : 0.6; c.panelMat.needsUpdate = true;
      c.lamp.material.emissiveIntensity = on ? 3 : 0.05; c.beam.visible = on;
      if (on) { c.group.add(this.crateLight); this.crateLight.intensity = 1.6; }
    }
  }
  roll() {
    const owned = new Set(this.arsenal.weapons.map((w) => w.base.id));
    const pool = Object.entries(CRATE.pool).filter(([id]) => this.arsenal.all[id] && !owned.has(id));
    let sum = pool.reduce((a, [, w]) => a + w, 0), r = Math.random() * sum;
    for (const [id, w] of pool) if ((r -= w) <= 0) return id;
    return pool.length ? pool[pool.length - 1][0] : 'ar';
  }
  // F at the crate
  useCrate() {
    const C = this.crate, H = this.hooks;
    if (C.state === 'idle') {
      if (!H.spend(CRATE.cost)) return false;
      C.state = 'spin'; C.t = 0; C.tick = 0; C.cycle = 0; C.spins++;
      C.jam = C.spins > CRATE.jamAfter && Math.random() < CRATE.jam;
      C.result = this.roll();
      H.audio.play('crateOpen');
      return true;
    }
    if (C.state === 'offer') {
      const id = C.result; H.give(id);
      this.hideShown(); C.state = 'close'; C.t = 0; H.audio.play('buy');
      return true;
    }
    return false;
  }
  hideShown() { if (this.crate.shown) this.crate.shown.visible = false; this.crate.shown = null; }
  showGun(id, c) {
    const d = this.display(id); if (!d) return;
    if (this.crate.shown && this.crate.shown !== d) this.crate.shown.visible = false;
    this.crate.shown = d; d.visible = true;
    d.position.set(c.spot.x, c.top + 0.25, c.spot.z);
  }
  updateCrate(dt) {
    const C = this.crate, c = this.crates[C.at], H = this.hooks;
    C.t += dt;
    let lidT = 0;
    if (C.state === 'spin') {
      lidT = 1;
      // roulette: guns swap fast, then slower and slower
      const k = clamp01(C.t / CRATE.spin), interval = 0.06 + 0.42 * k * k * k;
      C.tick -= dt;
      if (C.t > 0.35 && C.tick <= 0) {
        C.tick = interval;
        const ids = Object.keys(CRATE.pool).filter((id) => this.arsenal.all[id]);
        let id = ids[(C.cycle++ * 3 + ((Math.random() * ids.length) | 0)) % ids.length];
        if (this.crate.shown && ids.length > 1) while (this.displays[id] === this.crate.shown) id = ids[(Math.random() * ids.length) | 0];
        this.showGun(id, c); H.audio.play('crateTick', { k });
      }
      if (this.crate.shown) {
        const d = this.crate.shown, rise = smooth(clamp01((C.t - 0.3) / 1.2));
        d.position.y = c.top + 0.2 + rise * 0.75 + Math.sin(C.t * 3) * 0.03; d.rotation.y = C.t * (7 - 5 * k);
      }
      c.light.intensity = 1.6 + Math.sin(C.t * 30) * 0.6 * (1 - k);
      if (C.t >= CRATE.spin) {
        if (C.jam) {
          this.hideShown(); C.state = 'jam'; C.t = 0; H.refund(CRATE.cost);
          let n; do n = (Math.random() * this.crates.length) | 0; while (n === C.at && this.crates.length > 1);
          C.next = n; H.audio.play('crateJam'); H.spark(new THREE.Vector3(c.spot.x, c.top + 0.4, c.spot.z), 0xff6a3a, 40);
          H.banner('CRATE JAMMED', 'It is hauling itself to a new spot — follow the blue beam', 'crate');
        } else {
          this.showGun(C.result, c); C.state = 'offer'; C.t = 0; H.audio.play('crateLand', { rare: this.arsenal.all[C.result].base.rare });
        }
      }
    } else if (C.state === 'offer') {
      lidT = 1;
      const d = this.crate.shown, k = clamp01(C.t / CRATE.hold);
      if (d) { d.rotation.y += dt * 0.8; d.position.y = c.top + 0.95 - k * 0.65 + Math.sin(C.t * 2.2) * 0.04; }
      c.light.intensity = 1.6 + (this.arsenal.all[C.result]?.base.rare ? Math.sin(C.t * 8) * 0.8 : 0);
      if (C.t >= CRATE.hold) { this.hideShown(); C.state = 'close'; C.t = 0; H.audio.play('crateClose'); }
    } else if (C.state === 'close') {
      lidT = 1 - smooth(clamp01(C.t / 0.5));
      if (C.t >= 0.5) { C.state = 'idle'; C.t = 0; H.audio.play('crateClose'); }
    } else if (C.state === 'jam') {
      // lid slams, the crate shudders, sparks, goes dark; then a sign points at where it went
      lidT = C.t < 0.15 ? 1 - C.t / 0.15 : 0;
      const shake = C.t < 1.4 ? (1.4 - C.t) * 0.04 : 0;
      c.group.position.set(c.spot.x + (Math.random() - 0.5) * shake, 0, c.spot.z + (Math.random() - 0.5) * shake);
      c.light.color.set('#ff4a2a'); c.light.intensity = Math.random() < 0.5 ? 2 : 0.2;
      if (Math.random() < dt * 14 && C.t < 1.4) H.spark(new THREE.Vector3(c.spot.x + (Math.random() - 0.5), c.top, c.spot.z + (Math.random() - 0.5) * 0.6), 0xffb040, 6);
      if (C.t >= 1.4) {
        c.group.position.set(c.spot.x, 0, c.spot.z); c.light.color.set('#6fe3ff');
        const from = C.at; this.setActive(-1); this.crateLight.intensity = 0; C.from = from; C.state = 'moving'; C.t = 0;
        this.showSign(from, C.next);
      }
    } else if (C.state === 'moving') {
      const n = this.crates[C.next];
      n.beam.visible = Math.random() < 0.5 + C.t / CRATE.moveTime * 0.5; n.beam.material.opacity = 0.35 + 0.15 * Math.sin(C.t * 10);
      if (C.t >= CRATE.moveTime) { this.crates[C.from].sign.visible = false; this.setActive(C.next); C.state = 'idle'; C.t = 0; C.spins = 0; H.audio.play('crateArrive'); }
    }
    C.lid += (lidT - C.lid) * Math.min(1, dt * (lidT > C.lid ? 9 : 16));
    if (c && C.at >= 0) c.hinge.rotation.x = -C.lid * 1.75;
    for (const k of this.crates) if (k.beam.visible) { k.beam.rotation.y += dt * 0.6; if (C.state !== 'moving') k.beam.material.opacity = 0.22 + 0.06 * Math.sin(this.t * 2 + k.i); }
  }
  showSign(from, to) {
    const a = this.crates[from], b = this.crates[to], s = a.sign;
    s.clear();
    const dx = b.spot.x - a.spot.x, dz = b.spot.z - a.spot.z, dist = Math.round(Math.hypot(dx, dz));
    const make = (flip) => canvasTex(512, 192, (g, w, h) => {
      g.fillStyle = '#d9a21a'; g.fillRect(0, 0, w, h); g.fillStyle = '#121212'; g.fillRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#ffcf6a'; g.font = '700 58px Teko, Impact, sans-serif'; g.textAlign = 'center'; g.fillText('CRATE MOVED', w / 2 - (flip ? -40 : 40), 78);
      g.font = '600 36px Teko, Impact, sans-serif'; g.fillStyle = '#6fe3ff'; g.fillText(`${dist} M · FOLLOW THE BEAM`, w / 2 - (flip ? -40 : 40), 136);
      g.fillStyle = '#6fe3ff'; g.save(); g.translate(flip ? 56 : w - 56, h / 2); if (flip) g.scale(-1, 1);
      g.beginPath(); g.moveTo(-30, -26); g.lineTo(8, -26); g.lineTo(8, -46); g.lineTo(44, 0); g.lineTo(8, 46); g.lineTo(8, 26); g.lineTo(-30, 26); g.closePath(); g.fill(); g.restore();
    });
    const geo = new THREE.PlaneGeometry(1.5, 0.56);
    const front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: make(false), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0, roughness: 0.6 }));
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: make(true), roughness: 0.6 })); back.rotation.y = Math.PI;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), new THREE.MeshStandardMaterial({ color: '#333', metalness: 0.8, roughness: 0.4 })); post.position.y = -0.55;
    front.material.emissive.set('#ffffff'); front.material.emissiveMap = front.material.map; front.material.emissiveIntensity = 0.7;
    back.material.emissive = new THREE.Color('#ffffff'); back.material.emissiveMap = back.material.map; back.material.emissiveIntensity = 0.7;
    s.add(front, back, post);
    s.rotation.y = -Math.atan2(dz, dx); // sign's +x (arrow on the front face) points at the new spot
    s.visible = true;
  }

  // ------------------------------------------------------------------ forge
  buildForge(colliders) {
    const F = FORGE, g = new THREE.Group(); g.position.set(F.x, 0, F.z); g.rotation.y = F.ry;
    const skin = forgeSkin(), haz = hazardTex(); haz.wrapS = THREE.RepeatWrapping; haz.repeat.set(4, 1);
    const body = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.55, metalness: 0.75 });
    const dark = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.6, metalness: 0.7 });
    const pipe = new THREE.MeshStandardMaterial({ color: '#5a4a3a', roughness: 0.4, metalness: 0.9 });
    const hz = new THREE.MeshStandardMaterial({ map: haz, roughness: 0.7, metalness: 0.2 });
    const W = 2.3, Dp = 1.4, Hm = 1.9;
    const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.22, Dp + 0.3), dark); base.position.y = 0.11; g.add(base);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(W + 0.32, 0.1, Dp + 0.32), hz); stripe.position.y = 0.2; g.add(stripe);
    const main = new THREE.Mesh(new THREE.BoxGeometry(W, Hm, Dp), body); main.position.y = 0.22 + Hm / 2; main.castShadow = main.receiveShadow = true; g.add(main);
    const hood = new THREE.Mesh(new THREE.BoxGeometry(W + 0.12, 0.18, Dp + 0.12), dark); hood.position.y = 0.22 + Hm + 0.09; g.add(hood);
    // intake slot with a shutter, tray in front of it
    const slot = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.34, 0.1), new THREE.MeshStandardMaterial({ color: '#050505', emissive: '#ff5a10', emissiveIntensity: 0.0, roughness: 1 }));
    slot.position.set(-0.3, 1.05, Dp / 2 - 0.03); g.add(slot);
    const shutter = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.36, 0.03), new THREE.MeshStandardMaterial({ map: haz, roughness: 0.6, metalness: 0.5 })); shutter.position.set(-0.3, 1.05, Dp / 2 + 0.03); g.add(shutter);
    const tray = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.5), dark); tray.position.set(-0.3, 0.86, Dp / 2 + 0.25); g.add(tray);
    for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.25, 0.4), dark); b.rotation.x = -0.6; b.position.set(-0.3 + sx * 0.62, 0.78, Dp / 2 + 0.17); g.add(b); }
    // control panel (canvas screen), knobs, big lever
    const panelC = document.createElement('canvas'); panelC.width = 384; panelC.height = 256;
    const panelT = new THREE.CanvasTexture(panelC); panelT.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.4), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffffff', emissiveMap: panelT, emissiveIntensity: 1.6, roughness: 0.3 }));
    const pbox = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.55, 0.12), dark); pbox.position.set(0.72, 1.32, Dp / 2 + 0.04); pbox.rotation.x = -0.25; g.add(pbox);
    screen.position.set(0.72, 1.335, Dp / 2 + 0.105); screen.rotation.x = -0.25; g.add(screen);
    const knobs = []; for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 14), new THREE.MeshStandardMaterial({ color: ['#c83a2a', '#e0b030', '#3aa860'][i], roughness: 0.4, emissive: ['#c83a2a', '#e0b030', '#3aa860'][i], emissiveIntensity: 0.4 })); k.rotation.x = Math.PI / 2 - 0.25; k.position.set(0.52 + i * 0.2, 0.98, Dp / 2 + 0.12); g.add(k); knobs.push(k); }
    const lever = new THREE.Group(); lever.position.set(W / 2 + 0.06, 1.1, 0.2); g.add(lever);
    const lbar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 10), pipe); lbar.position.y = 0.27; lever.add(lbar);
    const lball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshStandardMaterial({ color: '#b02a1a', roughness: 0.35 })); lball.position.y = 0.56; lever.add(lball);
    // pistons on the sides, exhaust stacks, warning beacon, cables
    const pistons = [];
    for (const sx of [-1, 1]) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.8, 16), pipe); sleeve.position.set(sx * (W / 2 + 0.11), 0.75, -0.3); g.add(sleeve);
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 12), new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.2 })); rod.position.set(sx * (W / 2 + 0.11), 1.4, -0.3); g.add(rod); pistons.push(rod);
    }
    const stacks = [];
    for (const x of [-0.7, -0.3]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.8, 14), pipe); st.position.set(x, 0.22 + Hm + 0.5, -0.35); g.add(st); stacks.push(st); }
    const bea = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.16, 14), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#ffae2a', emissiveIntensity: 2.5 })); bea.position.set(0.7, 0.22 + Hm + 0.26, 0.3); g.add(bea);
    for (let i = 0; i < 3; i++) { const cab = new THREE.Mesh(new THREE.TorusGeometry(0.3 + i * 0.06, 0.025, 6, 16, Math.PI), dark); cab.position.set(-W / 2 - 0.02, 0.9 + i * 0.25, 0.2 - i * 0.2); cab.rotation.y = Math.PI / 2; g.add(cab); }
    // nameplate
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.24), new THREE.MeshStandardMaterial({ map: canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#c99a3e'; c.fillRect(0, 0, w, h); c.fillStyle = '#181512'; c.fillRect(6, 6, w - 12, h - 12); c.fillStyle = '#ffcf6a'; c.font = '700 84px Teko, Impact, sans-serif'; c.textAlign = 'center'; c.fillText('THE FORGE', w / 2, 96); }), roughness: 0.5, metalness: 0.4 }));
    plate.position.set(-0.3, 1.78, Dp / 2 + 0.005); g.add(plate);
    const glow = new THREE.PointLight('#ff7a2a', 0.0, 4, 2); glow.position.set(-0.3, 1.1, Dp / 2 + 0.6); g.add(glow);
    const panelLight = { color: new THREE.Color() }; // the screen is emissive; no extra light (keeps the light count down)
    this.scene.add(g);
    // collider: rotated box -> axis-aligned bounds
    const ext = (W + 0.3) / 2, exd = (Dp + 0.3) / 2, c = Math.abs(Math.cos(F.ry)), s = Math.abs(Math.sin(F.ry));
    const hx = ext * c + exd * s, hzz = ext * s + exd * c;
    colliders.push({ minX: F.x - hx, maxX: F.x + hx, minY: 0, maxY: 2.4, minZ: F.z - hzz, maxZ: F.z + hzz, walk: false, mat: 'metal' });
    const normal = new THREE.Vector3(Math.sin(F.ry), 0, Math.cos(F.ry));
    const slotW = new THREE.Vector3(-0.3, 1.05, Dp / 2).applyAxisAngle(new THREE.Vector3(0, 1, 0), F.ry).add(g.position);
    const trayW = new THREE.Vector3(-0.3, 1.02, Dp / 2 + 0.3).applyAxisAngle(new THREE.Vector3(0, 1, 0), F.ry).add(g.position);
    this.forge = { group: g, pos: new THREE.Vector3(F.x, 0, F.z), normal, front: Dp / 2 + 0.15, slot, shutter, glow, panelLight, panelC, panelT, pistons, stacks, bea, lever, knobs,
      slotW, trayW, state: 'idle', t: 0, gun: null, w: null, lastPanel: '' };
    this.drawPanel();
  }
  forgeCost() { return this.hooks.wave() >= FORGE.unlockWave ? FORGE.cost : FORGE.earlyCost; }
  drawPanel(progress = 0) {
    const F = this.forge, unlocked = this.hooks.wave() >= FORGE.unlockWave;
    const key = F.state + '|' + unlocked + '|' + Math.round(progress * 20);
    if (key === F.lastPanel) return; F.lastPanel = key;
    const g = F.panelC.getContext('2d'), w = 384, h = 256;
    g.fillStyle = '#04110a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,255,150,.2)'; g.lineWidth = 1; for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const col = F.state === 'work' ? '#ffb040' : F.state === 'ready' ? '#ff6af0' : unlocked ? '#5aff9a' : '#ffb040';
    g.fillStyle = col; g.font = '700 54px Teko, Impact, sans-serif'; g.textAlign = 'center';
    const title = F.state === 'work' ? 'FORGING…' : F.state === 'ready' ? 'COLLECT' : unlocked ? 'ONLINE' : 'STANDBY';
    g.fillText(title, w / 2, 70);
    g.font = '600 30px Teko, Impact, sans-serif'; g.fillStyle = 'rgba(220,255,230,.85)';
    if (F.state === 'work' || F.state === 'ready') {
      g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(40, 120, w - 80, 40); g.fillStyle = col; g.fillRect(46, 126, (w - 92) * (F.state === 'ready' ? 1 : progress), 28);
      g.fillStyle = 'rgba(220,255,230,.85)'; g.fillText(F.state === 'ready' ? 'UPGRADE COMPLETE' : 'DO NOT INSERT HANDS', w / 2, 205);
    } else {
      g.fillText(`UPGRADE · ${this.forgeCost().toLocaleString()} PTS`, w / 2, 130);
      g.fillText(unlocked ? 'INSERT WEAPON' : `FULL POWER AT WAVE ${FORGE.unlockWave}`, w / 2, 180);
    }
    for (let i = 0; i < 5; i++) { g.fillStyle = i < (unlocked ? 5 : 2) ? col : 'rgba(255,255,255,.12)'; g.fillRect(60 + i * 56, 226, 40, 10); }
    F.panelT.needsUpdate = true;
    F.panelLight.color.set(col);
  }
  // F at the forge
  useForge() {
    const F = this.forge, A = this.arsenal, H = this.hooks;
    if (F.state === 'idle') {
      const w = A.current; if (!w || w.up || A.bladeOut || A.swap) return false;
      if (!H.spend(this.forgeCost())) return false;
      F.w = w; w.forging = true; F.state = 'feed'; F.t = 0;
      F.gun = displayGun(A, w.base.id); F.gun.scale.setScalar(1.0); this.scene.add(F.gun);
      F.gun.rotation.set(0, FORGE.ry + Math.PI / 2, 0);
      A.forgeTake(w); // out of your hands
      H.audio.play('forgeStart');
      return true;
    }
    if (F.state === 'ready') {
      const w = F.w; this.scene.remove(F.gun); F.gun = null; F.w = null; F.state = 'idle'; F.t = 0;
      this.applyCamo(w.model.root); A.forgeReturn(w); H.audio.play('forgeTake'); H.upgraded(w);
      return true;
    }
    return false;
  }
  updateForge(dt) {
    const F = this.forge, H = this.hooks; F.t += dt;
    let shutter = 0, glow = 0;
    if (F.state === 'feed') {
      // the gun slides off your hands onto the tray and into the slot
      const k = smooth(clamp01(F.t / 0.9));
      F.gun.position.lerpVectors(F.trayW.clone().addScaledVector(F.normal, 0.5).setY(1.25), F.slotW, k);
      shutter = 1;
      if (F.t >= 0.9) { F.gun.visible = false; F.state = 'work'; F.t = 0; }
    } else if (F.state === 'work') {
      const k = clamp01(F.t / FORGE.time);
      glow = 0.6 + 0.4 * Math.sin(F.t * 25);
      F.group.position.set(FORGE.x + (Math.random() - 0.5) * 0.012, 0, FORGE.z + (Math.random() - 0.5) * 0.012);
      for (const [i, p] of F.pistons.entries()) p.position.y = 1.4 + Math.sin(F.t * 9 + i * Math.PI) * 0.15;
      F.lever.rotation.x = -0.9 * smooth(clamp01(F.t / 0.3));
      if (Math.random() < dt * 22) H.spark(F.slotW.clone().addScaledVector(F.normal, 0.08).add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.2, 0)), Math.random() < 0.5 ? 0xffc060 : 0xff6af0, 5);
      if (Math.random() < dt * 4) for (const s of F.stacks) H.smoke(s.getWorldPosition(this._v).add(new THREE.Vector3(0, 0.45, 0)));
      this.drawPanel(k);
      if (F.t >= FORGE.time) {
        F.state = 'eject'; F.t = 0; F.group.position.set(FORGE.x, 0, FORGE.z);
        this.applyCamo(F.gun); F.gun.visible = true; H.audio.play('forgeDone');
        H.spark(F.slotW.clone().addScaledVector(F.normal, 0.2), 0xff6af0, 30);
      }
    } else if (F.state === 'eject') {
      const k = smooth(clamp01(F.t / 0.7)); shutter = 1; glow = 1 - k * 0.5;
      F.gun.position.lerpVectors(F.slotW, F.trayW.clone().setY(1.12), k);
      F.lever.rotation.x = -0.9 * (1 - k);
      if (F.t >= 0.7) { F.state = 'ready'; F.t = 0; }
    } else if (F.state === 'ready') {
      shutter = 1; glow = 0.5;
      F.gun.position.copy(F.trayW).setY(1.12 + Math.sin(F.t * 2.5) * 0.03); F.gun.rotation.y += dt * 0.7;
    }
    F.shutter.position.y = 1.05 + (F.shutter.userData.k = (F.shutter.userData.k || 0) + (shutter - (F.shutter.userData.k || 0)) * Math.min(1, dt * 8)) * 0.36;
    F.slot.material.emissiveIntensity = glow * 3; F.glow.intensity = glow * 3;
    F.bea.material.emissiveIntensity = F.state === 'work' ? (Math.sin(F.t * 14) > 0 ? 4 : 0.3) : 2;
    if (F.state !== 'work') this.drawPanel();
  }
  // glowing animated camo + emissive tint on every gun material (not the hands)
  applyCamo(root) {
    const M = this.arsenal.models.materials, skip = new Set([M.glove, M.knuckle, M.palm, M.sleeve, M.cuff, M.fiber, M.lensGlass]);
    const cache = this._camoCache || (this._camoCache = new Map());
    root.traverse((o) => {
      if (!o.isMesh || skip.has(o.material) || !o.material.isMeshStandardMaterial || o.material.userData.camo) return;
      let m = cache.get(o.material);
      if (!m) {
        m = o.material.clone(); m.onBeforeCompile = o.material.onBeforeCompile; m.customProgramCacheKey = o.material.customProgramCacheKey;
        m.emissive = new THREE.Color('#ffffff'); m.emissiveMap = this.camo; m.emissiveIntensity = 1.1; m.color = m.color.clone().multiplyScalar(0.55);
        m.userData.camo = true; cache.set(o.material, m);
      }
      o.userData.orig = o.material; o.material = m;
    });
  }
  removeCamo(root) { root.traverse((o) => { if (o.isMesh && o.userData.orig) { o.material = o.userData.orig; delete o.userData.orig; } }); }

  // ------------------------------------------------------------------ shared
  // what the player is standing at and looking toward: { kind: 'crate'|'forge', ... }
  target(pos, look) {
    const pick = (p, n, front, reach) => {
      const v = this._v.set(p.x + n.x * front - pos.x, 0, p.z + n.z * front - pos.z), d = v.length();
      if (d > reach) return -1;
      const fx = p.x - pos.x, fz = p.z - pos.z, fl = Math.hypot(fx, fz) || 1;
      const facing = (fx * look.x + fz * look.z) / fl;
      const inFront = (pos.x - p.x) * n.x + (pos.z - p.z) * n.z;
      return facing > 0.35 && inFront > 0 ? d : -1;
    };
    const C = this.crate;
    if (C.at >= 0) { const c = this.crates[C.at]; if (pick(c.pos, c.normal, 0.4, 2.8) >= 0 || (C.state === 'offer' && Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) < 2.2)) return { kind: 'crate', state: C.state, id: C.result }; }
    const F = this.forge; if (pick(F.pos, F.normal, F.front, 2.8) >= 0) return { kind: 'forge', state: F.state };
    return null;
  }
  update(dt, t) {
    this.t = t; this.updateCrate(dt); this.updateForge(dt);
    this.camo.offset.x = (t * 0.05) % 1; this.camo.offset.y = (t * 0.033) % 1;
  }
  // map icons
  icons() {
    const C = this.crate, out = [];
    if (C.at >= 0) out.push({ kind: 'crate', x: this.crates[C.at].spot.x, z: this.crates[C.at].spot.z });
    else if (C.state === 'moving') out.push({ kind: 'crate', x: this.crates[C.next].spot.x, z: this.crates[C.next].spot.z, moving: true });
    out.push({ kind: 'forge', x: FORGE.x, z: FORGE.z, on: this.hooks.wave() >= FORGE.unlockWave });
    return out;
  }
  reset() {
    const C = this.crate; this.hideShown();
    for (const c of this.crates) { c.sign.visible = false; c.group.position.set(c.spot.x, 0, c.spot.z); c.hinge.rotation.x = 0; c.light.color.set('#6fe3ff'); }
    Object.assign(C, { state: 'idle', t: 0, spins: 0, lid: 0, result: null, next: -1 }); this.setActive(0);
    const F = this.forge; if (F.gun) this.scene.remove(F.gun); F.gun = null; F.w = null; F.state = 'idle'; F.t = 0; F.lastPanel = ''; this.drawPanel();
  }
}
