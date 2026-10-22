// Fire axe: buyable heavy melee that takes over V. Procedural model + keyframed viewmodel swings
// (alternating right/left sweeps, a lunging overhead chop when a target is a few metres out).
import * as THREE from 'three';
import { clamp, lerp } from '../core/util.js';

export const AXE = {
  id: 'axe', name: 'FIRE AXE', short: 'AXE', type: 'Heavy melee', cost: 1500,
  range: 2.9, lungeRange: 3.4, lungeMin: 2.6, lungeMax: 5.5, lungeSpeed: 9,
  dmg: [280, 210, 150], // first, second, third zombie in the arc (cleave)
  cone: 0.3,            // cos of half-angle of the sweep
};

const stdMat = (o) => new THREE.MeshStandardMaterial(o);
export function axeModel(materials = {}) {
  const g = new THREE.Group();
  const wood = stdMat({ color: '#8a5a32', roughness: 0.62, metalness: 0 });
  const paint = stdMat({ color: '#b3161b', roughness: 0.42, metalness: 0.35 });
  const steel = stdMat({ color: '#c9ccd0', roughness: 0.22, metalness: 1 });
  const grip = stdMat({ color: '#1c1c1c', roughness: 0.9, metalness: 0 });
  // haft along +Y, slightly tapered, with a rubber grip at the bottom
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.78, 12), wood); haft.position.y = 0.33; g.add(haft);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), wood); knob.position.y = -0.06; knob.scale.set(1, 0.7, 1.2); g.add(knob);
  const rub = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.025, 0.2, 12), grip); rub.position.y = 0.04; g.add(rub);
  // head: eye socket block, wedge blade (edge toward -X) and a pick spike toward +X
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.05), paint); eye.position.y = 0.69; g.add(eye);
  const bs = new THREE.Shape();
  bs.moveTo(0, 0.035); bs.lineTo(-0.1, 0.07); bs.quadraticCurveTo(-0.135, 0, -0.1, -0.075); bs.lineTo(0, -0.04); bs.lineTo(0, 0.035);
  const bladeGeo = new THREE.ExtrudeGeometry(bs, { depth: 0.026, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.004, bevelSegments: 1, steps: 1 });
  bladeGeo.translate(-0.03, 0, -0.013);
  const blade = new THREE.Mesh(bladeGeo, paint); blade.position.y = 0.69; g.add(blade);
  const es = new THREE.Shape(); // bright ground edge
  es.moveTo(-0.098, 0.068); es.quadraticCurveTo(-0.135, 0, -0.098, -0.073); es.lineTo(-0.115, -0.07); es.quadraticCurveTo(-0.15, 0, -0.115, 0.066);
  const edgeGeo = new THREE.ExtrudeGeometry(es, { depth: 0.012, bevelEnabled: false }); edgeGeo.translate(-0.03 + 0.016, 0, -0.006);
  const edge = new THREE.Mesh(edgeGeo, steel); edge.position.y = 0.69; g.add(edge);
  const pick = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.13, 4), paint); pick.rotation.z = -Math.PI / 2; pick.position.set(0.09, 0.69, 0); g.add(pick);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.04, 4), steel); tip.rotation.z = -Math.PI / 2; tip.position.set(0.165, 0.69, 0); g.add(tip);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  g.userData.parts = { wood, paint, steel };
  return g;
}

// keyframes: [t, px, py, pz, rx, ry, rz]
const SWING_R = [
  [0.0, 0.42, -0.6, -0.35, 0.2, 0, -0.4],
  [0.13, 0.3, 0.02, -0.25, 0.75, -0.25, -1.05],
  [0.2, 0.08, -0.06, -0.5, -0.35, -0.55, 1.25],
  [0.3, -0.3, -0.26, -0.38, -0.7, -0.4, 1.85],
  [0.45, -0.34, -0.42, -0.34, -0.6, -0.3, 1.9],
  [0.66, 0.42, -0.6, -0.35, 0.2, 0, -0.4],
];
const LUNGE = [
  [0.0, 0.3, -0.6, -0.3, 0.4, -Math.PI / 2, 0],
  [0.15, 0.12, 0.12, -0.2, 1.1, -Math.PI / 2, 0.15],
  [0.26, 0.04, -0.12, -0.55, -1.15, -Math.PI / 2, 0.05],
  [0.36, 0.02, -0.36, -0.5, -1.7, -Math.PI / 2, 0],
  [0.55, 0.05, -0.45, -0.45, -1.6, -Math.PI / 2, 0],
  [0.78, 0.3, -0.6, -0.3, 0.4, -Math.PI / 2, 0],
];
const HIT_T = { R: 0.19, L: 0.19, lunge: 0.25 };
const END_T = { R: 0.66, L: 0.66, lunge: 0.78 };

function sample(K, t, mirror) {
  let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1], u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1), s = u * u * (3 - 2 * u);
  const o = [];
  for (let k = 1; k < 7; k++) o.push(lerp(a[k], b[k], s));
  if (mirror) { o[0] = -o[0]; o[4] = -o[4]; o[5] = -o[5]; }
  return o;
}

export class AxeVM {
  constructor(vmCamera, materials) {
    this.root = new THREE.Group(); this.root.visible = false; vmCamera.add(this.root);
    this.axe = axeModel(); this.root.add(this.axe);
    // gloved fist + sleeve wrapped round the grip
    const glove = materials?.glove || stdMat({ color: '#4a4b4c', roughness: 1 });
    const sleeve = materials?.sleeve || stdMat({ color: '#3b4032', roughness: 0.95 });
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), glove); fist.scale.set(1.05, 1.25, 0.95); fist.position.set(0, 0.05, 0.004); this.root.add(fist);
    const knuckles = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.04, 0.07, 10), glove); knuckles.rotation.x = Math.PI / 2; knuckles.position.set(0, 0.05, -0.02); this.root.add(knuckles);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 0.5, 12), sleeve); arm.rotation.x = Math.PI / 2 - 0.25; arm.position.set(0.02, -0.02, 0.27); this.root.add(arm);
    this.root.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    this.owned = false; this.swing = null; this.side = 1; this.queued = false;
  }
  reset() { this.owned = false; this.swing = null; this.queued = false; this.root.visible = false; }
  busy() { return !!this.swing; }
  start(kind) {
    if (this.swing) { if (this.swing.t > HIT_T[this.swing.kind]) this.queued = kind || true; return false; }
    if (kind !== 'lunge') { kind = this.side > 0 ? 'R' : 'L'; this.side = -this.side; }
    this.swing = { kind, t: 0, hit: false, whoosh: false };
    return true;
  }
  // returns 'hit' on the frame the blade connects
  update(dt) {
    const S = this.swing; let ev = null;
    if (!S) { this.root.visible = false; return null; }
    S.t += dt;
    if (!S.whoosh && S.t > 0.1) { S.whoosh = true; ev = 'whoosh'; }
    if (!S.hit && S.t >= HIT_T[S.kind]) { S.hit = true; ev = 'hit'; }
    const K = S.kind === 'lunge' ? LUNGE : SWING_R, o = sample(K, S.t, S.kind === 'L');
    this.root.position.set(o[0], o[1], o[2]); this.root.rotation.set(o[3], o[4], o[5]);
    this.root.visible = true;
    if (S.t >= END_T[S.kind] || (this.queued && S.t > HIT_T[S.kind] + 0.2)) {
      const q = this.queued; this.swing = null; this.queued = false;
      if (q) this.start(q === 'lunge' ? 'lunge' : null);
    }
    return ev;
  }
}
