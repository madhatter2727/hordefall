import * as THREE from 'three';
import { rand } from '../core/util.js';

// Red fuel drums: shootable, chain-react, respawn between waves.
function barrelTexture() {
  const W = 1024, H = 512, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#8f1d14'; x.fillRect(0, 0, W, H);
  // paint mottling + drips + rust bloom
  for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '40,8,5' : '170,50,35'},${Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 4 + Math.random() * 30, 0, 6.28); x.fill(); }
  for (let i = 0; i < 70; i++) { const px = Math.random() * W, py = Math.random() * H * 0.3; x.fillStyle = `rgba(70,30,15,${0.2 + Math.random() * 0.3})`; x.fillRect(px, py, 2 + Math.random() * 4, 40 + Math.random() * 160); }
  // hazard band
  x.fillStyle = '#e8b81c'; x.fillRect(0, H * 0.42, W, H * 0.16);
  x.save(); x.beginPath(); x.rect(0, H * 0.42, W, H * 0.16); x.clip(); x.fillStyle = '#111';
  for (let k = -40; k < W + 40; k += 48) { x.beginPath(); x.moveTo(k, H * 0.42); x.lineTo(k + 24, H * 0.42); x.lineTo(k + 24 - 82, H * 0.58); x.lineTo(k - 82, H * 0.58); x.fill(); }
  x.restore();
  // flammable diamonds (two sides)
  for (const cx of [W * 0.25, W * 0.75]) {
    x.save(); x.translate(cx, H * 0.24); x.rotate(Math.PI / 4);
    x.fillStyle = '#f0e6d6'; x.fillRect(-46, -46, 92, 92); x.strokeStyle = '#141414'; x.lineWidth = 5; x.strokeRect(-40, -40, 80, 80);
    x.restore();
    x.fillStyle = '#141414'; x.beginPath(); // flame glyph
    x.moveTo(cx, H * 0.24 - 30); x.quadraticCurveTo(cx + 26, H * 0.24 + 2, cx + 12, H * 0.24 + 22); x.quadraticCurveTo(cx, H * 0.24 + 30, cx - 12, H * 0.24 + 22);
    x.quadraticCurveTo(cx - 24, H * 0.24 + 4, cx - 6, H * 0.24 - 6); x.quadraticCurveTo(cx - 2, H * 0.24 + 8, cx + 2, H * 0.24 + 4); x.quadraticCurveTo(cx + 6, H * 0.24 - 10, cx, H * 0.24 - 30); x.fill();
    x.font = '700 30px Arial'; x.textAlign = 'center'; x.fillStyle = '#f2e9dc'; x.fillText('FLAMMABLE', cx, H * 0.76);
    x.font = '600 18px Arial'; x.fillText('UN 1203  ·  KEEP AWAY FROM FIRE', cx, H * 0.83);
  }
  // scratches through to bare metal
  x.lineCap = 'round';
  for (let i = 0; i < 260; i++) { x.strokeStyle = `rgba(${150 + Math.random() * 60},${130 + Math.random() * 40},${110 + Math.random() * 30},${0.2 + Math.random() * 0.5})`; x.lineWidth = 0.6 + Math.random() * 1.6; const px = Math.random() * W, py = Math.random() * H, a = Math.random() * 6.28, l = 4 + Math.random() * 26; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  // grime toward the bottom
  const g = x.createLinearGradient(0, H, 0, H * 0.6); g.addColorStop(0, 'rgba(25,15,8,.75)'); g.addColorStop(1, 'rgba(25,15,8,0)'); x.fillStyle = g; x.fillRect(0, H * 0.6, W, H * 0.4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export class Barrels {
  constructor(scene, arena, assets) {
    this.list = [];
    // ribbed steel drum (lathe): rolling hoops + chimes, then a lid
    const R = 0.29, Hh = 0.88, pts = [[0, 0.0], [R - 0.012, 0.0], [R, 0.012], [R, 0.03], [R + 0.004, 0.035], [R, 0.04]];
    for (const hy of [0.3, 0.58]) pts.push([R, hy - 0.02], [R + 0.012, hy - 0.008], [R + 0.012, hy + 0.008], [R, hy + 0.02]);
    pts.push([R, Hh - 0.04], [R + 0.004, Hh - 0.035], [R, Hh - 0.03], [R, Hh - 0.012], [R - 0.012, Hh], [R - 0.03, Hh], [R - 0.03, Hh - 0.012], [0, Hh - 0.012]);
    const geo = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 28);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, Math.min(1, geo.attributes.position.getY(i) / Hh)); // wrap the label by height
    geo.computeVertexNormals();
    const nrm = assets.textures?.rusty_metal_02?.normalMap?.clone(); if (nrm) { nrm.repeat.set(3, 2); nrm.needsUpdate = true; }
    const mat = new THREE.MeshStandardMaterial({ map: barrelTexture(), metalness: 0.45, roughness: 0.55, normalMap: nrm || null, normalScale: new THREE.Vector2(0.35, 0.35) });
    const bung = new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10); bung.translate(0.15, Hh - 0.002, 0.05);
    const lidGeo = new THREE.CylinderGeometry(R - 0.03, R - 0.03, 0.004, 24); lidGeo.translate(0, Hh - 0.012, 0);
    this.mesh = new THREE.InstancedMesh(geo, mat, 24);
    this.lid = new THREE.InstancedMesh(lidGeo, new THREE.MeshStandardMaterial({ color: '#6e1510', metalness: 0.5, roughness: 0.45 }), 24);
    this.bung = new THREE.InstancedMesh(bung, new THREE.MeshStandardMaterial({ color: '#b7b0a5', metalness: 1, roughness: 0.35 }), 24);
    for (const m of [this.mesh, this.lid, this.bung]) { m.castShadow = true; m.receiveShadow = true; m.count = 0; scene.add(m); }
    const spots = [[-13.6, -10.1], [-12.9, -10.7], [-3.5, -12.9], [-2.8, -13.5], [12.4, 7.0], [12.3, 7.8], [-10.1, 8.2], [9.0, -8.6],
      [-20.6, 13.5], [22.0, -11.2], [2.4, 7.6], [-24.5, -10.5], [26.5, 9.5], [7.6, -23.5]];
    const cols = arena.colliders;
    for (const [x, z] of spots) {
      const blocked = cols.some((c) => !c.ground && x + 0.35 > c.minX && x - 0.35 < c.maxX && z + 0.35 > c.minZ && z - 0.35 < c.maxZ && c.minY < 0.9);
      if (blocked) continue;
      const col = { minX: x - 0.3, maxX: x + 0.3, minY: 0, maxY: Hh, minZ: z - 0.3, maxZ: z + 0.3, walk: false, mat: 'metal' };
      const b = { pos: new THREE.Vector3(x, 0, z), rot: Math.random() * 6.28, hp: 0, alive: true, fuse: -1, col, home: { ...col }, burnT: 0 };
      col.barrel = b; cols.push(col); this.list.push(b);
    }
    this.mesh.count = this.lid.count = this.bung.count = this.list.length;
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(1, 1, 1); this.up = new THREE.Vector3(0, 1, 0);
    this.respawn();
  }
  sync() {
    this.list.forEach((b, i) => {
      this.q.setFromAxisAngle(this.up, b.rot);
      this.s.setScalar(b.alive ? 1 : 0);
      this.m.compose(b.pos, this.q, this.s);
      for (const m of [this.mesh, this.lid, this.bung]) m.setMatrixAt(i, this.m);
    });
    for (const m of [this.mesh, this.lid, this.bung]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); }
  }
  respawn(avoid = null) {
    for (const b of this.list) {
      if (!b.alive && avoid && Math.hypot(avoid.x - b.pos.x, avoid.z - b.pos.z) < 1.2) continue; // don't drop one on the player
      b.alive = true; b.hp = 36; b.fuse = -1; b.burnT = 0; Object.assign(b.col, b.home);
    }
    this.sync();
  }
  // returns true if this hit set it off (or lit the fuse)
  damage(b, amount, delay = 0) {
    if (!b.alive || b.fuse >= 0) return false;
    b.hp -= amount;
    if (b.hp <= 0) { b.fuse = delay; return true; }
    b.burnT = Math.max(b.burnT, 0.6); // punctured: it vents flame for a moment
    return false;
  }
  update(dt, fx, onExplode) {
    for (const b of this.list) {
      if (!b.alive) continue;
      if (b.burnT > 0) {
        b.burnT -= dt;
        if (Math.random() < 0.6) fx.add.spawn({ pos: b.pos.clone().add(new THREE.Vector3(rand(-0.15, 0.15), 0.9, rand(-0.15, 0.15))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3)), life: rand(0.2, 0.4), size: rand(0.12, 0.22), grow: 0.3, col: new THREE.Color(4, 1.6, 0.35) });
      }
      if (b.fuse >= 0 && (b.fuse -= dt) < 0) {
        b.alive = false; b.fuse = -1;
        b.col.minY = -60; b.col.maxY = -59; // collider gone until respawn
        this.sync();
        onExplode(b.pos.clone().setY(0.5), b);
      }
    }
  }
  near(p, r) { return this.list.filter((b) => b.alive && b.fuse < 0 && b.pos.distanceTo(p) < r); }
}
