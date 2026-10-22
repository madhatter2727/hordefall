// Fire axe: buyable heavy melee that takes over V. Procedural model + keyframed viewmodel swings
// (alternating right/left sweeps, a lunging overhead chop when a target is a few metres out).
import * as THREE from 'three';
import { clamp } from '../core/util.js';

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

// keyframes: [t, hand position, haft direction, blade-edge direction] in viewmodel-camera space (-Z forward)
const K = (t, p, d, b) => ({ t, p: new THREE.Vector3(...p), q: basis(d, b) });
function basis(d, b) {
  const Y = new THREE.Vector3(...d).normalize(), X = new THREE.Vector3(...b).multiplyScalar(-1); // the edge sits on local -X
  X.addScaledVector(Y, -X.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
const REST = [[0.45, -0.6, -0.45], [0.3, 0.95, 0.1], [-0.95, 0.3, 0]];
// diagonal slash in the screen plane: head starts up-right, cuts through the centre, ends low-left
const SWING = [
  K(0, ...REST),
  K(0.13, [0.28, -0.1, -0.5], [0.5, 0.85, 0.05], [-0.85, 0.5, 0]),
  K(0.2, [0.12, -0.18, -0.55], [-0.6, 0.5, -0.6], [-0.5, -0.6, 0]),
  K(0.3, [-0.18, -0.3, -0.5], [-0.9, -0.3, -0.3], [0.3, -0.9, 0]),
  K(0.45, [-0.3, -0.42, -0.45], [-0.8, -0.55, 0.1], [0.55, -0.8, 0]),
  K(0.66, ...REST),
];
const LREST = [[0.3, -0.62, -0.45], [0.05, 0.95, 0.3], [0, 0.3, -0.95]];
// overhead chop: raised behind the head, comes down through the middle of the screen
const LUNGE = [
  K(0, ...LREST),
  K(0.15, [0.1, -0.05, -0.5], [0.1, 0.7, 0.7], [0, 0.7, -0.7]),
  K(0.25, [0.06, -0.12, -0.6], [0.05, 0.55, -0.85], [0, -0.85, -0.5]),
  K(0.36, [0.04, -0.3, -0.6], [0, -0.3, -0.95], [0, -0.95, 0.3]),
  K(0.55, [0.05, -0.42, -0.55], [0, -0.6, -0.8], [0, -0.8, 0.6]),
  K(0.78, ...LREST),
];
const HIT_T = { R: 0.19, L: 0.19, lunge: 0.25 };
const END_T = { R: 0.66, L: 0.66, lunge: 0.78 };
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

function sample(keys, t, mirror, outP, outQ) {
  let i = 0; while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1], u = clamp((t - a.t) / (b.t - a.t), 0, 1), s = u * u * (3 - 2 * u);
  outP.lerpVectors(a.p, b.p, s); outQ.slerpQuaternions(a.q, b.q, s);
  if (mirror) { // reflect the pose across the screen's vertical axis, keeping a proper rotation
    outP.x = -outP.x;
    const m = new THREE.Matrix4().makeRotationFromQuaternion(outQ), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
    m.extractBasis(X, Y, Z); X.x = -X.x; Y.x = -Y.x; Z.x = -Z.x; X.negate();
    outQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, new THREE.Vector3().crossVectors(X, Y)));
  }
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
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.07, 12), sleeve); cuff.position.set(0, -0.03, 0.03); cuff.rotation.x = 0.5; this.root.add(cuff);
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
    sample(S.kind === 'lunge' ? LUNGE : SWING, S.t, S.kind === 'L', this.root.position, this.root.quaternion);
    this.root.visible = true;
    if (S.t >= END_T[S.kind] || (this.queued && S.t > HIT_T[S.kind] + 0.2)) {
      const q = this.queued; this.swing = null; this.queued = false;
      if (q) this.start(q === 'lunge' ? 'lunge' : null);
    }
    return ev;
  }
}
