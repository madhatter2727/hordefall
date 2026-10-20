import * as THREE from 'three';

// Chalk-outlined weapon boards bolted to container walls. Walk up, look at one, press F.
const SPOTS = [
  { id: 'smg', x: -12, y: 1.45, z: 13.77, ny: Math.PI },        // container south face
  { id: 'sg', x: 8, y: 1.45, z: -18.77, ny: 0 },                // container north face
  { id: 'mr', x: 13.17, y: 1.45, z: 10.6, ny: -Math.PI / 2 },   // container west face
  { id: 'lmg', x: 18.77, y: 1.45, z: -13.2, ny: -Math.PI / 2 }, // container west face
];

function boardTexture(name, cost) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#1d2220'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 2400; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * 512, Math.random() * 256, 2 + Math.random() * 10, 1 + Math.random() * 2); }
  g.strokeStyle = 'rgba(232,226,210,.55)'; g.lineWidth = 3; g.setLineDash([14, 8]); g.strokeRect(22, 30, 468, 150); g.setLineDash([]);
  g.fillStyle = '#c99a3e'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 246, 512, 10);
  g.fillStyle = 'rgba(240,234,220,.9)'; g.font = '600 40px Teko, Impact, sans-serif'; g.textAlign = 'left'; g.fillText(name, 26, 228);
  g.fillStyle = '#ffcf6a'; g.textAlign = 'right'; g.fillText(cost.toLocaleString(), 490, 228);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class WallBuys {
  constructor(scene, arsenal, weapons) {
    this.list = [];
    const M = arsenal.models.materials, hide = new Set([M.glove, M.knuckle, M.palm, M.sleeve, M.cuff]);
    for (const s of SPOTS) {
      const def = weapons.find((d) => d.id === s.id), model = arsenal.models[s.id];
      if (!def || !model) continue;
      const g = new THREE.Group(); g.position.set(s.x, s.y, s.z); g.rotation.y = s.ny;
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), new THREE.MeshStandardMaterial({ map: boardTexture(def.name, def.cost), roughness: 0.92, metalness: 0 }));
      board.position.z = 0.02; g.add(board);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.93, 0.03), new THREE.MeshStandardMaterial({ color: '#3c3a36', roughness: 0.6, metalness: 0.7 }));
      g.add(frame);
      const gun = model.root.clone(true); gun.visible = true;
      gun.traverse((o) => { if (o.isMesh && hide.has(o.material)) o.visible = false; });
      if (model.leftHand) { const idx = model.root.children.indexOf(model.leftHand); if (idx >= 0) gun.children[idx].visible = false; }
      gun.position.set(0, 0.1, 0.07); gun.rotation.set(0, Math.PI / 2, 0); gun.scale.setScalar(s.id === 'lmg' ? 1.2 : 1.45);
      // centre the gun on the board
      const box = new THREE.Box3().setFromObject(gun); const ctr = box.getCenter(new THREE.Vector3());
      gun.position.x -= ctr.x; gun.position.y += 0.1 - ctr.y;
      gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      g.add(gun);
      const lamp = new THREE.PointLight('#ffd9a0', 0.7, 2.6, 2); lamp.position.set(0, 0.55, 0.75); g.add(lamp);
      scene.add(g);
      const normal = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.ny);
      this.list.push({ id: s.id, def, pos: new THREE.Vector3(s.x, 0, s.z), normal, group: g, gun });
    }
    this._v = new THREE.Vector3();
  }
  // the board the player is standing at and looking toward, if any
  nearest(pos, lookDir) {
    let best = null, bd = 1e9;
    for (const b of this.list) {
      const v = this._v.set(b.pos.x - pos.x, 0, b.pos.z - pos.z), d = v.length();
      if (d > 2.4 || d < 0.05) continue;
      const front = -(v.x * b.normal.x + v.z * b.normal.z); // in front of the board
      if (front < 0.2) continue;
      v.divideScalar(d);
      const facing = v.x * lookDir.x + v.z * lookDir.z;
      if (facing < 0.45) continue;
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  update(t) { for (const b of this.list) b.gun.position.z = 0.07 + Math.sin(t * 1.3 + b.pos.x) * 0.004; }
}
