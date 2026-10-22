import * as THREE from 'three';
import { DRINKS } from '../tuning.js';

// M12: four perk-drink vending machines. Each has its own silhouette, colour, lit sign and hum.
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function tex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// lit marquee: name in a neon outline, price underneath
function signTex(d) {
  return tex(512, 192, (g, w, h) => {
    g.fillStyle = '#07070a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = d.color; g.lineWidth = 8; g.shadowColor = d.color; g.shadowBlur = 18; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#fff'; g.font = '700 66px Teko, Impact, sans-serif'; g.textAlign = 'center'; g.fillText(d.name, w / 2, 98);
    g.shadowBlur = 0; g.fillStyle = d.color; g.font = '600 38px Teko, Impact, sans-serif'; g.fillText(`${d.blurb.toUpperCase()} · ${d.price.toLocaleString()}`, w / 2, 152);
  });
}
// the drink's own label (cans, bottles, the HUD icon)
export function drinkIconURL(d, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), s = size / 64;
  g.fillStyle = 'rgba(10,10,14,.85)'; g.beginPath(); g.arc(32 * s, 32 * s, 30 * s, 0, 6.3); g.fill();
  g.strokeStyle = d.color; g.lineWidth = 3 * s; g.stroke();
  g.fillStyle = d.color; g.strokeStyle = d.color; g.lineWidth = 4 * s; g.lineCap = 'round'; g.lineJoin = 'round';
  g.save(); g.translate(32 * s, 32 * s); g.scale(s, s);
  if (d.id === 'bulwark') { g.beginPath(); g.moveTo(0, -18); g.lineTo(15, -11); g.lineTo(13, 6); g.quadraticCurveTo(8, 15, 0, 19); g.quadraticCurveTo(-8, 15, -13, 6); g.lineTo(-15, -11); g.closePath(); g.fill(); g.fillStyle = '#111'; g.fillRect(-2.5, -9, 5, 18); g.fillRect(-9, -2.5, 18, 5); }
  else if (d.id === 'snapload') { g.beginPath(); g.arc(0, 0, 14, -2.5, 2.2); g.stroke(); g.beginPath(); g.moveTo(-13, -14); g.lineTo(-6, -8); g.lineTo(-15, -4); g.closePath(); g.fill(); g.fillRect(-3, -6, 6, 12); }
  else if (d.id === 'hairtrigger') { for (const y of [-9, 1, 11]) { g.beginPath(); g.moveTo(-14, y - 6); g.lineTo(2, y - 6); g.lineTo(12, y - 2); g.lineTo(2, y + 2); g.lineTo(-14, y + 2); g.closePath(); g.fill(); } }
  else { g.beginPath(); g.moveTo(-15, 4); g.lineTo(-7, 4); g.lineTo(-3, -6); g.lineTo(2, 12); g.lineTo(6, -2); g.lineTo(15, -2); g.stroke(); g.beginPath(); g.arc(0, -14, 4, 0, 6.3); g.fill(); }
  g.restore(); return c.toDataURL();
}
function labelTex(d) {
  return tex(256, 128, (g, w, h) => {
    g.fillStyle = d.color; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, 34, w, 60);
    g.fillStyle = '#fff'; g.font = '700 30px Teko, Impact, sans-serif'; g.textAlign = 'center'; g.fillText(d.name.split(' ')[0], w / 2, 76);
    g.fillStyle = 'rgba(255,255,255,.35)'; for (let x = 0; x < w; x += 16) g.fillRect(x, 6, 8, 3);
  });
}

export class Drinks {
  // hooks: { audio, spend(n), owned(), buy(d), vmCamera }
  constructor(scene, colliders, hooks) {
    this.scene = scene; this.hooks = hooks; this.list = []; this._v = new THREE.Vector3(); this.humT = {};
    const metal = new THREE.MeshStandardMaterial({ color: '#25262b', roughness: 0.45, metalness: 0.8 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.18, metalness: 1 });
    DRINKS.list.forEach((d, i) => {
      const col = new THREE.Color(d.color);
      const paint = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.55), roughness: 0.35, metalness: 0.35 });
      const glow = new THREE.MeshStandardMaterial({ color: '#000', emissive: col, emissiveIntensity: 2.6 });
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z); g.rotation.y = d.ry;
      const W = 1.0, D = 0.8, H = 1.95;
      // body: each machine has its own shape (0 rounded-top cabinet, 1 slanted sci-fi front, 2 twin-column, 3 apothecary cabinet)
      const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), paint); body.position.y = H / 2 + 0.06; body.castShadow = body.receiveShadow = true; g.add(body);
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(W + 0.08, 0.08, D + 0.06), metal); plinth.position.y = 0.04; g.add(plinth);
      if (i === 0) { const dome = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, W, 24, 1, false, 0, Math.PI), paint); dome.rotation.set(0, 0, Math.PI / 2); dome.position.y = H + 0.06; g.add(dome); }
      if (i === 1) { const wedge = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.5, 0.3), paint); wedge.rotation.x = -0.5; wedge.position.set(0, H - 0.1, D / 2 - 0.02); g.add(wedge); for (const sx of [-1, 1]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, H * 0.9, 0.2), glow); fin.position.set(sx * (W / 2 + 0.02), H / 2, D / 2 - 0.1); g.add(fin); } }
      if (i === 2) { for (const sx of [-1, 1]) { const colm = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, H + 0.25, 16), chrome); colm.position.set(sx * (W / 2 + 0.08), (H + 0.25) / 2, D / 2 - 0.15); g.add(colm); const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), glow); bulb.position.set(sx * (W / 2 + 0.08), H + 0.33, D / 2 - 0.15); g.add(bulb); } }
      if (i === 3) { const crown = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.42, 4), paint); crown.rotation.y = Math.PI / 4; crown.position.y = H + 0.27; g.add(crown); const orb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), glow); orb.position.y = H + 0.55; g.add(orb); for (const sx of [-1, 1]) { const curl = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 8, 18, Math.PI * 1.5), chrome); curl.position.set(sx * 0.52, 0.5, D / 2); g.add(curl); } }
      // lit sign up top, glass window with drinks stacked behind it, coin slot, dispenser flap
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, 0.36), new THREE.MeshStandardMaterial({ color: '#000', emissive: '#fff', emissiveMap: signTex(d), emissiveIntensity: 1.8 }));
      sign.position.set(0, H - 0.2 + (i === 1 ? -0.12 : 0), D / 2 + 0.006 + (i === 1 ? 0.17 : 0)); if (i === 1) sign.rotation.x = -0.5; g.add(sign);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.22, 0.95), new THREE.MeshStandardMaterial({ color: '#0b0f14', roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.45 }));
      glass.position.set(-0.05, 1.05, D / 2 + 0.008); g.add(glass);
      const label = new THREE.MeshStandardMaterial({ map: labelTex(d), roughness: 0.3, metalness: 0.4, emissive: col, emissiveIntensity: 0.25 });
      const can = i % 2 ? new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12) : new THREE.CylinderGeometry(0.035, 0.05, 0.2, 12);
      const stock = new THREE.InstancedMesh(can, label, 15); let k = 0;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) { const m = new THREE.Matrix4().makeTranslation(-0.36 + c * 0.155, 0.7 + r * 0.3, D / 2 - 0.12); stock.setMatrixAt(k++, m); }
      g.add(stock);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.22, 0.95), glow); back.material = glow.clone(); back.material.emissiveIntensity = 0.5; back.position.set(-0.05, 1.05, D / 2 - 0.2); g.add(back);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.04), chrome); slot.position.set(0.42, 1.0, D / 2 + 0.02); g.add(slot);
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 12), glow); btn.rotation.x = Math.PI / 2; btn.position.set(0.42, 1.2, D / 2 + 0.02); g.add(btn);
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.05), metal); flap.position.set(0, 0.33, D / 2 + 0.02); g.add(flap);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.035, 0.04), glow); trim.position.set(0, 0.5, D / 2 + 0.01); g.add(trim);
      const light = { intensity: 0 }; // emissive only: no extra real-time lights (keeps the frame cost flat)
      scene.add(g);
      const c = Math.abs(Math.cos(d.ry)), s = Math.abs(Math.sin(d.ry)), hx = ((W + 0.3) / 2) * c + ((D + 0.1) / 2) * s, hz = ((W + 0.3) / 2) * s + ((D + 0.1) / 2) * c;
      colliders.push({ minX: d.x - hx, maxX: d.x + hx, minY: 0, maxY: H + 0.4, minZ: d.z - hz, maxZ: d.z + hz, walk: false, mat: 'metal' });
      this.list.push({ d, group: g, sign, glow, light, pos: new THREE.Vector3(d.x, 0, d.z), normal: new THREE.Vector3(Math.sin(d.ry), 0, Math.cos(d.ry)), label });
    });
    this.buildViewBottle(hooks.vmCamera);
    this.anim = null;
  }
  // first-person drink: the can comes up from below, tips to your mouth, drains, drops away
  buildViewBottle(vmCamera) {
    this.vm = new THREE.Group(); this.vm.visible = false; vmCamera.add(this.vm);
    this.vmLabel = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.5 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.12, 20), this.vmLabel);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.033, 0.012, 20), new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.25 })); top.position.y = 0.066;
    const tab = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.002, 6, 12), top.material); tab.position.set(0.01, 0.073, 0); tab.rotation.x = Math.PI / 2;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), new THREE.MeshStandardMaterial({ color: '#4a4b4c', roughness: 1 })); hand.scale.set(0.8, 1.15, 0.85); hand.position.set(0.028, -0.01, 0.012);
    this.vm.add(body, top, tab, hand);
  }
  target(pos, look) {
    for (const m of this.list) {
      const fx = m.pos.x + m.normal.x * 0.4 - pos.x, fz = m.pos.z + m.normal.z * 0.4 - pos.z, d = Math.hypot(fx, fz);
      if (d > 2.6) continue;
      const cx = m.pos.x - pos.x, cz = m.pos.z - pos.z, cl = Math.hypot(cx, cz) || 1;
      if ((cx * look.x + cz * look.z) / cl < 0.35) continue;
      if ((pos.x - m.pos.x) * m.normal.x + (pos.z - m.pos.z) * m.normal.z <= 0) continue;
      return m;
    }
    return null;
  }
  use(m) {
    const H = this.hooks, owned = H.owned();
    if (this.anim || owned[m.d.id] || Object.keys(owned).length >= DRINKS.limit) { H.audio.play('dry'); return false; }
    if (!H.spend(m.d.price)) return false;
    this.vmLabel.map = m.label.map; this.vmLabel.color.set('#ffffff'); this.vmLabel.needsUpdate = true;
    this.anim = { t: 0, m, applied: false }; this.vm.visible = true; H.audio.play('drinkOpen');
    return true;
  }
  get drinking() { return !!this.anim; }
  update(dt, playerPos) {
    const t = performance.now() / 1000;
    for (const m of this.list) {
      const k = 0.85 + 0.15 * Math.sin(t * 3 + m.d.x) + (Math.random() < 0.01 ? -0.5 : 0); // neon buzz + rare flicker
      m.sign.material.emissiveIntensity = 1.8 * k; m.light.intensity = 1.4 * k;
      const dist = Math.hypot(playerPos.x - m.pos.x, playerPos.z - m.pos.z);
      if (dist < DRINKS.humRange && (this.humT[m.d.id] || 0) < t) { this.humT[m.d.id] = t + 7; this.hooks.audio.play('drinkHum', { id: m.d.id, gain: 1 - dist / DRINKS.humRange }); }
    }
    const A = this.anim; if (!A) return;
    A.t += dt; const T = DRINKS.drinkTime, k = A.t / T;
    const up = smooth(clamp01(k / 0.25)), down = smooth(clamp01((k - 0.82) / 0.18)), tip = smooth(clamp01((k - 0.25) / 0.2)) * (1 - down);
    this.vm.position.set(0.05 - 0.07 * tip, -0.32 + 0.22 * up + 0.06 * tip - 0.3 * down, -0.3 + 0.1 * tip);
    this.vm.rotation.set(1.35 * tip + 0.15, 0.2, -0.25 * up + 0.3 * tip);
    if (k > 0.3 && !A.glug) { A.glug = true; this.hooks.audio.play('drinkGulp'); }
    if (k > 0.75 && !A.applied) { A.applied = true; this.hooks.buy(A.m.d); }
    if (k >= 1) { this.vm.visible = false; this.anim = null; }
  }
  icons() { return this.list.map((m) => ({ kind: 'drink', x: m.d.x, z: m.d.z, color: m.d.color })); }
  reset() { this.anim = null; this.vm.visible = false; }
}
