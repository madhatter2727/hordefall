// Power-up drops: a small fixed pool of glowing tokens (coin + loot beam + ground ring + soft light).
// Everything is built once; spawning only re-skins and repositions a pooled slot (no shader recompiles,
// no per-frame allocations).
import * as THREE from 'three';
import { POWERUPS } from './tuning.js';

export const POWER_TYPES = {
  bounty: { name: 'BOUNTY ×2', sub: 'Every point counts double', color: '#ffc531', timed: true },
  resupply: { name: 'RESUPPLY', sub: 'All guns and grenades refilled', color: '#4dff8a' },
  reaper: { name: 'REAPER', sub: 'Any hit kills', color: '#b678ff', timed: true },
  deadfall: { name: 'DEADFALL', sub: 'The whole horde drops', color: '#ff4a2a' },
};

function drawIcon(g, type, S, col) {
  const c = S / 2;
  g.save(); g.translate(c, c);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = S * 0.05; g.lineCap = g.lineJoin = 'round';
  if (type === 'bounty') {
    g.font = `800 ${S * 0.46}px Teko, Impact, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('×2', 0, S * 0.03);
  } else if (type === 'resupply') {
    for (const x of [-0.17, 0, 0.17]) { // three rounds standing in a row
      const X = x * S, w = S * 0.1;
      g.beginPath(); g.moveTo(X - w / 2, S * 0.24); g.lineTo(X - w / 2, -S * 0.08); g.quadraticCurveTo(X, -S * 0.3, X + w / 2, -S * 0.08); g.lineTo(X + w / 2, S * 0.24); g.closePath(); g.fill();
      g.fillRect(X - w * 0.6, S * 0.12, w * 1.2, S * 0.03);
    }
  } else if (type === 'reaper') { // skull
    g.beginPath(); g.arc(0, -S * 0.05, S * 0.24, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(S * 0.13, S * 0.25); g.lineTo(-S * 0.13, S * 0.25); g.closePath(); g.fill();
    g.globalCompositeOperation = 'destination-out';
    for (const x of [-0.1, 0.1]) { g.beginPath(); g.ellipse(x * S, -S * 0.04, S * 0.065, S * 0.08, 0, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.moveTo(0, S * 0.06); g.lineTo(-S * 0.03, S * 0.12); g.lineTo(S * 0.03, S * 0.12); g.fill();
    for (const x of [-0.06, 0, 0.06]) g.fillRect(x * S - S * 0.012, S * 0.17, S * 0.024, S * 0.09);
    g.globalCompositeOperation = 'source-over';
  } else { // deadfall: falling bolt over a starburst
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, r = (i % 2 ? 0.16 : 0.34) * S; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = col; g.beginPath(); g.moveTo(S * 0.04, -S * 0.26); g.lineTo(-S * 0.1, S * 0.03); g.lineTo(0, S * 0.03); g.lineTo(-S * 0.05, S * 0.26); g.lineTo(S * 0.11, -S * 0.04); g.lineTo(0, -S * 0.04); g.closePath(); g.fill();
  }
  g.restore();
}
// coin face: coloured disc, bright rim, white icon
function faceCanvas(type, S = 256) {
  const T = POWER_TYPES[type], cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S / 2); gr.addColorStop(0, T.color); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.strokeStyle = '#fff'; g.lineWidth = S * 0.035; g.beginPath(); g.arc(S / 2, S / 2, S * 0.43, 0, Math.PI * 2); g.stroke();
  g.globalAlpha = 0.5; g.lineWidth = S * 0.015; g.beginPath(); g.arc(S / 2, S / 2, S * 0.37, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  drawIcon(g, type, S, T.color);
  return cv;
}
export function powerIconURL(type) { // HUD icon (transparent background, coloured glyph)
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  g.fillStyle = POWER_TYPES[type].color; g.beginPath(); g.arc(S / 2, S / 2, S * 0.47, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.arc(S / 2, S / 2, S * 0.4, 0, Math.PI * 2); g.fill();
  drawIcon(g, type, S, POWER_TYPES[type].color);
  return cv.toDataURL();
}
function glowTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const g = cv.getContext('2d');
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S); return new THREE.CanvasTexture(cv);
}
function beamTexture() {
  const cv = document.createElement('canvas'); cv.width = 4; cv.height = 128; const g = cv.getContext('2d');
  const gr = g.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(0.35, 'rgba(255,255,255,.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128); return new THREE.CanvasTexture(cv);
}

export class PowerUps {
  constructor(scene, hooks) {
    this.hooks = hooks; // { groundAt(x, z, y), audio, onDrop(type) }
    this.tex = {}; for (const k in POWER_TYPES) { const t = new THREE.CanvasTexture(faceCanvas(k)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; this.tex[k] = t; }
    const glow = glowTexture(), beam = beamTexture(), add = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false };
    const coinGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 36); coinGeo.rotateX(Math.PI / 2);
    const beamGeo = new THREE.CylinderGeometry(0.22, 0.32, 4.2, 20, 1, true); beamGeo.translate(0, 2.1, 0);
    const ringGeo = new THREE.RingGeometry(0.55, 0.75, 40); ringGeo.rotateX(-Math.PI / 2);
    this.slots = [];
    for (let i = 0; i < POWERUPS.maxOnMap; i++) {
      const root = new THREE.Group(); root.visible = false;
      const rim = new THREE.MeshStandardMaterial({ color: '#888', emissive: '#fff', emissiveIntensity: 1.2, metalness: 0.9, roughness: 0.25 });
      const face = new THREE.MeshStandardMaterial({ color: '#fff', map: this.tex.bounty, emissive: '#fff', emissiveMap: this.tex.bounty, emissiveIntensity: 1.6, metalness: 0.3, roughness: 0.4 });
      const coin = new THREE.Mesh(coinGeo, [rim, face, face]); coin.position.y = 1.0; root.add(coin);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#fff', ...add, opacity: 0.8 })); halo.scale.setScalar(1.6); halo.position.y = 1.0; root.add(halo);
      const beamM = new THREE.MeshBasicMaterial({ map: beam, color: '#fff', ...add, side: THREE.DoubleSide, opacity: 0.55 });
      const bm = new THREE.Mesh(beamGeo, beamM); root.add(bm);
      const ringM = new THREE.MeshBasicMaterial({ color: '#fff', ...add, side: THREE.DoubleSide, opacity: 0.6 });
      const ring = new THREE.Mesh(ringGeo, ringM); ring.position.y = 0.03; root.add(ring);
      const light = new THREE.PointLight('#fff', 0, 6, 2); light.position.y = 1.1; root.add(light);
      root.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      scene.add(root);
      this.slots.push({ root, coin, halo, bm, ring, rim, face, light, type: null, life: 0, phase: Math.random() * 6, pos: new THREE.Vector3(), col: new THREE.Color() });
    }
    this.reset();
  }
  reset() { for (const s of this.slots) { s.type = null; s.life = 0; s.root.visible = false; s.light.intensity = 0; } this.waveDrops = 0; this.gap = 0; }
  newWave() { this.waveDrops = 0; }
  // roll for a drop where a husk died
  maybeDrop(pos, wave) {
    const C = POWERUPS.chance, chance = Math.min(C.max, C.base + C.perWave * Math.max(0, wave - 1));
    if (this.gap > 0 || this.waveDrops >= POWERUPS.perWave(wave) || Math.random() > chance) return null;
    let sum = 0; for (const k in POWERUPS.weights) sum += POWERUPS.weights[k];
    let r = Math.random() * sum, type = 'bounty';
    for (const k in POWERUPS.weights) { r -= POWERUPS.weights[k]; if (r <= 0) { type = k; break; } }
    return this.spawn(type, pos.x, pos.z, pos.y);
  }
  spawn(type, x, z, y = 0) {
    const s = this.slots.find((q) => !q.type) || this.slots.reduce((a, b) => (a.life < b.life ? a : b));
    const T = POWER_TYPES[type];
    s.type = type; s.life = POWERUPS.life; s.col.set(T.color);
    s.pos.set(x, this.hooks.groundAt(x, z, y + 0.5), z); s.root.position.copy(s.pos); s.root.visible = true;
    s.face.map = s.face.emissiveMap = this.tex[type]; s.face.needsUpdate = false;
    s.rim.color.copy(s.col); s.rim.emissive.copy(s.col);
    s.halo.material.color.copy(s.col); s.bm.material.color.copy(s.col); s.ring.material.color.copy(s.col); s.light.color.copy(s.col);
    this.waveDrops++; this.gap = POWERUPS.minGap;
    this.hooks.audio.play('powerDrop');
    return s;
  }
  // returns the type picked up this frame, if any
  update(dt, time, player) {
    this.gap -= dt;
    let picked = null;
    for (const s of this.slots) {
      if (!s.type) continue;
      s.life -= dt;
      if (s.life <= 0) { s.type = null; s.root.visible = false; s.light.intensity = 0; continue; }
      const bob = Math.sin(time * 2.4 + s.phase);
      s.coin.position.y = 1.0 + bob * 0.12; s.halo.position.y = s.coin.position.y;
      s.coin.rotation.y = time * 2.2 + s.phase;
      const pulse = 0.8 + 0.2 * Math.sin(time * 5 + s.phase);
      s.ring.scale.setScalar(0.9 + 0.15 * Math.sin(time * 3 + s.phase)); s.ring.material.opacity = 0.5 * pulse;
      s.halo.material.opacity = 0.75 * pulse; s.light.intensity = 2.2 * pulse;
      // blink faster and faster before it vanishes
      const B = POWERUPS.blink;
      s.root.visible = s.life > B || Math.sin(time * (8 + (B - s.life) * 4)) > -0.2;
      const dx = player.pos.x - s.pos.x, dz = player.pos.z - s.pos.z;
      if (!picked && player.alive && dx * dx + dz * dz < POWERUPS.pickRadius * POWERUPS.pickRadius && Math.abs(player.pos.y - s.pos.y) < 1.6) {
        picked = s.type; s.type = null; s.root.visible = false; s.light.intensity = 0;
      }
    }
    return picked;
  }
  active() { return this.slots.filter((s) => s.type); }
}
