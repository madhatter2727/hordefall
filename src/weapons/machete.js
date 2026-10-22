// Machete: free heavy melee everyone starts with. Slot 4 draws it (left-click swings), V swings it
// from any gun. Procedural model: long, gently curved blade with a ground bright edge, grime and blood,
// cord-wrapped grip, small guard. Keyframed viewmodel slashes (forehand / backhand diagonals,
// lunging overhead chop when a target is a few metres out) with a motion smear.
import * as THREE from 'three';
import { clamp } from '../core/util.js';

export const MACHETE = {
  id: 'machete', name: 'MACHETE', short: 'MACHETE', type: 'Heavy melee · free',
  range: 3.0, lungeRange: 3.5, lungeMin: 2.6, lungeMax: 5.5, lungeSpeed: 9.5,
  dmg: [320, 240, 170], // first, second, third zombie in the arc (cleave)
  cone: 0.28,           // cos of half-angle of the sweep
};

const stdMat = (o) => new THREE.MeshStandardMaterial(o);
const L = 0.56, Y0 = 0.115; // blade length, blade root height above the hand
// blade outline in (x, y): edge on -X, spine on +X, bending gently toward the spine (convex edge)
const bend = (u) => 0.07 * u * u;
const edgeX = (u) => -(0.02 + 0.02 * Math.sin(Math.min(1, u / 0.82) * Math.PI * 0.55)) + bend(u);
const spineX = (u) => 0.02 - 0.004 * u + bend(u);

function bladeTextures() {
  const W = 256, H = 1024, mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const col = mk(), rough = mk(), g = col.getContext('2d'), r = rough.getContext('2d');
  // brushed steel along the length
  g.fillStyle = '#b9bcc0'; g.fillRect(0, 0, W, H); r.fillStyle = '#5a5a5a'; r.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * W, y = Math.random() * H, l = 30 + Math.random() * 160, a = Math.random() * 0.12;
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(30,30,30,${a})`; g.fillRect(x, y, 1, l);
    r.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${a * 0.6})`; r.fillRect(x, y, 1, l);
  }
  // grime: dark oily blotches, heavier near the guard and along the spine
  for (let i = 0; i < 70; i++) {
    const y = Math.pow(Math.random(), 1.8) * H * 0.85, x = W * (0.5 + Math.random() * 0.5), rx = 6 + Math.random() * 18, ry = 30 + Math.random() * 120;
    for (const [c, a] of [[g, `rgba(52,44,34,${0.12 + Math.random() * 0.16})`], [r, 'rgba(235,235,235,.35)']]) {
      c.save(); c.translate(x, y); c.scale(rx, ry); const gr = c.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, a); gr.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 1, 0, Math.PI * 2); c.fill(); c.restore();
    }
  }
  // a dark oily band near the guard and along the spine
  { const gr = g.createLinearGradient(0, 0, 0, H * 0.22); gr.addColorStop(0, 'rgba(38,32,24,.55)'); gr.addColorStop(1, 'rgba(38,32,24,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.22);
    const sp = g.createLinearGradient(W, 0, W * 0.72, 0); sp.addColorStop(0, 'rgba(38,32,24,.45)'); sp.addColorStop(1, 'rgba(38,32,24,0)'); g.fillStyle = sp; g.fillRect(0, 0, W, H); }
  // rust freckles
  for (let i = 0; i < 260; i++) { const x = Math.random() * W, y = Math.random() * H, s = 1 + Math.random() * 3;
    g.fillStyle = `rgba(${120 + Math.random() * 40},${55 + Math.random() * 20},25,${0.25 + Math.random() * 0.4})`; g.fillRect(x, y, s, s);
    r.fillStyle = 'rgba(255,255,255,.7)'; r.fillRect(x, y, s, s); }
  // blood: a smear from the edge toward the spine over the front half, plus drips and spatter
  const blood = (x, y, rx, ry, a) => { g.save(); g.translate(x, y); g.scale(rx, ry); const b = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    b.addColorStop(0, `rgba(105,4,6,${a})`); b.addColorStop(0.7, `rgba(78,3,5,${a * 0.85})`); b.addColorStop(1, 'rgba(60,4,6,0)');
    g.fillStyle = b; g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2); g.fill(); g.restore();
    r.save(); r.translate(x, y); r.scale(rx, ry); r.fillStyle = `rgba(40,40,40,${a * 0.8})`; r.beginPath(); r.arc(0, 0, 1, 0, Math.PI * 2); r.fill(); r.restore(); };
  // smear wiped back from the edge over the front half (long, thin, fading toward the spine)
  for (let i = 0; i < 40; i++) { const y = H * (0.48 + Math.random() * 0.44); blood(W * (0.08 + Math.random() * 0.24), y, 16 + Math.random() * 38, 7 + Math.random() * 18, 0.6 + Math.random() * 0.35); }
  for (let i = 0; i < 14; i++) blood(W * (0.25 + Math.random() * 0.25), H * (0.5 + Math.random() * 0.4), 18 + Math.random() * 30, 4 + Math.random() * 8, 0.35 + Math.random() * 0.3);
  for (let i = 0; i < 60; i++) blood(Math.random() * W * 0.75, H * (0.35 + Math.random() * 0.6), 1.2 + Math.random() * 3, 1.2 + Math.random() * 3.5, 0.75);
  for (let i = 0; i < 6; i++) { const x = W * (0.15 + Math.random() * 0.5), y = H * (0.55 + Math.random() * 0.3); g.fillStyle = 'rgba(80,5,7,.75)'; g.fillRect(x, y - 40 - Math.random() * 80, 3, 60 + Math.random() * 60); }
  const t = (c, srgb) => { const tx = new THREE.CanvasTexture(c); if (srgb) tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8;
    // ExtrudeGeometry front-face UVs are raw shape coords (metres): map x[-0.075,0.07] y[0,L] to the canvas
    tx.repeat.set(1 / 0.145, 1 / L); tx.offset.set(0.075 / 0.145, 0); return tx; };
  return { map: t(col, true), roughnessMap: t(rough, false) };
}

function cordTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#17130f'; g.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 10) { // diagonal cord wraps
    const gr = g.createLinearGradient(0, y, 0, y + 10); gr.addColorStop(0, '#0c0a08'); gr.addColorStop(0.5, '#3a3128'); gr.addColorStop(1, '#0c0a08');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 6); g.lineTo(64, y + 14); g.lineTo(0, y + 8); g.fill();
  }
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(120,30,20,${Math.random() * 0.18})`; g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

let _tex = null;
export function macheteModel() {
  _tex ||= { ...bladeTextures(), cord: cordTexture() };
  const g = new THREE.Group();
  const steel = stdMat({ color: '#a4a8ae', map: _tex.map, roughnessMap: _tex.roughnessMap, roughness: 0.75, metalness: 0.9, envMapIntensity: 1.0 });
  const edgeM = stdMat({ color: '#e9ecef', roughness: 0.16, metalness: 1, envMapIntensity: 2.0 });
  const grip = stdMat({ color: '#ffffff', map: _tex.cord, roughness: 0.92, metalness: 0 });
  const dark = stdMat({ color: '#2a2b2d', roughness: 0.45, metalness: 0.85 });
  const brass = stdMat({ color: '#a9864a', roughness: 0.35, metalness: 1 });
  const N = 28, pts = (f) => Array.from({ length: N + 1 }, (_, i) => f(i / N));
  // blade body (inset from the edge), then the bright ground bevel along the edge
  const body = new THREE.Shape(), tipU = 1;
  const tip = new THREE.Vector2(edgeX(tipU) * 0.2 + spineX(tipU) * 0.8 + 0.004, L + 0.012);
  body.moveTo(spineX(0), 0);
  pts((u) => u * 0.9).forEach((u) => body.lineTo(spineX(u), u * L));
  body.quadraticCurveTo(spineX(0.97) + 0.002, L * 0.985, tip.x, tip.y); // clipped spine into the point
  const inset = 0.0075;
  body.quadraticCurveTo(edgeX(0.985) + inset * 0.6, L * 0.97, edgeX(0.94) + inset, L * 0.94);
  pts((u) => 0.94 - u * 0.94).forEach((u) => body.lineTo(edgeX(u) + inset, u * L));
  body.lineTo(spineX(0), 0);
  const bodyGeo = new THREE.ExtrudeGeometry(body, { depth: 0.0035, bevelEnabled: true, bevelThickness: 0.0012, bevelSize: 0.0012, bevelSegments: 2, curveSegments: 10 });
  bodyGeo.translate(0, Y0, -0.00175);
  const edgeS = new THREE.Shape();
  edgeS.moveTo(edgeX(0) + inset, 0);
  pts((u) => u * 0.94).forEach((u) => edgeS.lineTo(edgeX(u) + inset, u * L));
  edgeS.quadraticCurveTo(edgeX(0.985) + inset * 0.6, L * 0.97, tip.x, tip.y);
  edgeS.quadraticCurveTo(edgeX(0.985) - 0.001, L * 0.975, edgeX(0.94), L * 0.94);
  pts((u) => 0.94 - u * 0.94).forEach((u) => edgeS.lineTo(edgeX(u), u * L));
  const edgeGeo = new THREE.ExtrudeGeometry(edgeS, { depth: 0.0016, bevelEnabled: true, bevelThickness: 0.0009, bevelSize: 0.0006, bevelSegments: 1, curveSegments: 8 });
  edgeGeo.translate(0, Y0, -0.0008);
  const blade = new THREE.Mesh(bodyGeo, steel), edge = new THREE.Mesh(edgeGeo, edgeM);
  g.add(blade, edge);
  // fuller: a dark groove pressed along the spine side
  const ful = new THREE.Shape(); ful.moveTo(spineX(0.06) - 0.006, 0.06 * L);
  pts((u) => 0.06 + u * 0.5).forEach((u) => ful.lineTo(spineX(u) - 0.006, u * L));
  pts((u) => 0.56 - u * 0.5).forEach((u) => ful.lineTo(spineX(u) - 0.011, u * L));
  const fulGeo = new THREE.ShapeGeometry(ful); fulGeo.translate(0, Y0, 0.00295);
  const fulM = stdMat({ color: '#4c4f53', roughness: 0.5, metalness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
  g.add(new THREE.Mesh(fulGeo, fulM));
  // tang + slab grip wrapped in cord, brass pins, flared pommel
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.017, 0.15, 14, 1), grip);
  handle.scale.set(1, 1, 0.72); handle.position.set(0.0, 0.03, 0); g.add(handle);
  grip.map.repeat.set(1, 1.4);
  for (const y of [-0.025, 0.085]) { const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.026, 8), brass); pin.rotation.x = Math.PI / 2; pin.position.set(0, y, 0); g.add(pin); }
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), dark); pommel.scale.set(1.15, 0.6, 0.8); pommel.position.set(-0.004, -0.05, 0); g.add(pommel);
  // small guard: a short crossbar, swept forward on the edge side
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.012, 0.022), dark); guard.position.set(-0.004, 0.108, 0); g.add(guard);
  const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 8), dark); lip.position.set(-0.046, 0.115, 0); lip.rotation.z = 0.5; g.add(lip);
  const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.0165, 0.012, 14), dark); ferrule.scale.set(1, 1, 0.75); ferrule.position.y = 0.098; g.add(ferrule);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.userData.parts = { steel, edgeM, grip };
  return g;
}

// keyframes: [t, hand position, blade direction, edge direction] in viewmodel-camera space (-Z forward)
const K = (t, p, d, b) => ({ t, p: new THREE.Vector3(...p), q: basis(d, b) });
function basis(d, b) {
  const Y = new THREE.Vector3(...d).normalize(), X = new THREE.Vector3(...b).multiplyScalar(-1); // the edge sits on local -X
  X.addScaledVector(Y, -X.dot(Y)).normalize();
  const Z = new THREE.Vector3().crossVectors(X, Y);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
const LOW = [[0.42, -0.62, -0.42], [0.3, 0.95, 0.1], [-0.95, 0.3, 0]];      // off-screen, bottom right
const IDLE = [[0.25, -0.3, -0.58], [-0.32, 0.88, -0.35], [-0.75, -0.25, -0.6]]; // held up, flat of the blade toward you
const SETS = {
  // forehand: wound up over the right shoulder, fast diagonal down-left, follow-through low-left
  R: [[0.13, [0.3, -0.06, -0.5], [0.3, 0.9, 0.3], [-0.7, 0.2, -0.7]],
      [0.2, [0.05, -0.15, -0.6], [-0.65, 0.4, -0.65], [-0.45, -0.85, 0.1]],
      [0.31, [-0.22, -0.34, -0.55], [-0.9, -0.25, -0.35], [0.25, -0.95, 0]],
      [0.42, [-0.28, -0.42, -0.5], [-0.7, -0.6, -0.2], [0.6, -0.75, 0.1]]],
  // backhand: cocked over the left shoulder, diagonal down-right
  L: [[0.13, [-0.14, -0.06, -0.5], [-0.35, 0.88, 0.3], [0.7, 0.2, -0.7]],
      [0.2, [0.02, -0.16, -0.6], [0.65, 0.4, -0.65], [0.45, -0.85, 0.1]],
      [0.31, [0.26, -0.36, -0.55], [0.9, -0.25, -0.35], [-0.25, -0.95, 0]],
      [0.42, [0.32, -0.44, -0.5], [0.7, -0.6, -0.2], [-0.6, -0.75, 0.1]]],
  // lunge: raised high, chops down through the middle of the screen
  lunge: [[0.15, [0.12, -0.02, -0.4], [0.1, 0.65, 0.75], [0, 0.75, -0.65]],
          [0.25, [0.06, -0.12, -0.6], [0.05, 0.55, -0.85], [0, -0.85, -0.5]],
          [0.36, [0.04, -0.3, -0.6], [0, -0.3, -0.95], [0, -0.95, 0.3]],
          [0.52, [0.05, -0.44, -0.55], [0, -0.6, -0.8], [0, -0.8, 0.6]]],
};
const END = { R: 0.62, L: 0.62, lunge: 0.74 };
const HIT_T = { R: 0.19, L: 0.19, lunge: 0.25 };
const SMEAR = { R: [0.135, 0.34], L: [0.135, 0.34], lunge: [0.16, 0.4] };
const cache = {};
function keys(kind, from) {
  const id = kind + from; if (cache[id]) return cache[id];
  const rest = from === 'idle' ? IDLE : LOW;
  return (cache[id] = [K(0, ...rest), ...SETS[kind].map((k) => K(...k)), K(END[kind], ...rest)]);
}
function sample(ks, t, outP, outQ) {
  let i = 0; while (i < ks.length - 2 && t > ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], u = clamp((t - a.t) / (b.t - a.t), 0, 1), s = u * u * (3 - 2 * u);
  outP.lerpVectors(a.p, b.p, s); outQ.slerpQuaternions(a.q, b.q, s);
}

export class MacheteVM {
  constructor(vmCamera, materials) {
    this.cam = vmCamera;
    this.root = new THREE.Group(); this.root.visible = false; vmCamera.add(this.root);
    this.blade = macheteModel(); this.root.add(this.blade);
    // gloved fist wrapped round the grip: palm, four curled fingers, thumb over the top, sleeve
    const glove = materials?.glove || stdMat({ color: '#4a4b4c', roughness: 1 });
    const sleeve = materials?.sleeve || stdMat({ color: '#3b4032', roughness: 0.95 });
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 10), glove); palm.scale.set(1.0, 1.55, 0.95); palm.position.set(0.02, 0.03, 0.018); this.root.add(palm);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0105 - i * 0.0006, 8, 14, Math.PI * 1.35), glove);
      f.rotation.set(Math.PI / 2, 0, -0.5); f.position.set(0, 0.07 - i * 0.024, 0); this.root.add(f);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.035, 4, 8), glove); thumb.position.set(-0.012, 0.075, -0.016); thumb.rotation.set(0.6, 0, 0.9); this.root.add(thumb);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.07, 12), glove); wrist.position.set(0.012, -0.055, 0.02); wrist.rotation.set(0.35, 0, -0.2); this.root.add(wrist);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.031, 0.036, 0.09, 12), sleeve); cuff.position.set(0.024, -0.11, 0.04); cuff.rotation.set(0.35, 0, -0.2); this.root.add(cuff);
    this.root.traverse((m) => { if (m.isMesh) m.castShadow = false; });
    // motion smear: a ribbon traced by the blade over the last few frames
    const S = 14; this.trail = { n: S, base: [], tip: [] };
    for (let i = 0; i < S; i++) { this.trail.base.push(new THREE.Vector3()); this.trail.tip.push(new THREE.Vector3()); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S * 2 * 3), 3));
    const a = new Float32Array(S * 2 * 4); geo.setAttribute('color', new THREE.BufferAttribute(a, 4));
    const idx = []; for (let i = 0; i < S - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } geo.setIndex(idx);
    this.smear = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    this.smear.frustumCulled = false; this.smear.visible = false; vmCamera.add(this.smear);
    this.reset();
  }
  reset() { this.swing = null; this.queued = false; this.side = 1; this.drawn = false; this.drawT = 0; this.root.visible = false; this.smear.visible = false; this.trailCount = 0; }
  busy() { return !!this.swing; }
  out() { return this.drawn || !!this.swing; }
  draw() { if (this.drawn) return false; this.drawn = true; this.drawT = 0; return true; }
  holster() { this.drawn = false; this.queued = false; }
  start(kind) {
    if (this.swing) { if (this.swing.t > HIT_T[this.swing.kind]) this.queued = kind || true; return false; }
    if (kind !== 'lunge') { kind = this.side > 0 ? 'R' : 'L'; this.side = -this.side; }
    this.swing = { kind, t: 0, hit: false, whoosh: false, from: this.drawn ? 'idle' : 'low' };
    this.trailCount = 0;
    return true;
  }
  // returns 'whoosh' / 'hit' on the frames those happen
  update(dt, moving = 0, time = 0) {
    const S = this.swing; let ev = null;
    if (!S) {
      this.smear.visible = false;
      if (!this.drawn) { this.root.visible = false; return null; }
      // held: raise from below, then breathe and bob with your stride
      this.drawT = Math.min(1, this.drawT + dt / 0.3);
      const k = this.drawT * this.drawT * (3 - 2 * this.drawT);
      const kl = keys('R', 'idle'), lo = keys('R', 'low')[0];
      this.root.position.lerpVectors(lo.p, kl[0].p, k); this.root.quaternion.slerpQuaternions(lo.q, kl[0].q, k);
      const bob = Math.sin(time * 9) * 0.012 * moving, br = Math.sin(time * 1.7) * 0.004;
      this.root.position.y += bob * k + br; this.root.position.x += Math.cos(time * 4.5) * 0.008 * moving;
      this.root.rotateZ(Math.sin(time * 4.5) * 0.03 * moving);
      this.root.visible = true; return null;
    }
    S.t += dt;
    if (!S.whoosh && S.t > 0.1) { S.whoosh = true; ev = 'whoosh'; }
    if (!S.hit && S.t >= HIT_T[S.kind]) { S.hit = true; ev = 'hit'; }
    sample(keys(S.kind, S.from), S.t, this.root.position, this.root.quaternion);
    this.root.visible = true;
    this.updateSmear(S);
    const end = END[S.kind];
    if (S.t >= end || (this.queued && S.t > HIT_T[S.kind] + 0.17)) {
      const q = this.queued; this.swing = null; this.queued = false; this.smear.visible = false;
      if (q) this.start(q === 'lunge' ? 'lunge' : null);
      else if (this.drawn) this.drawT = 1;
    }
    return ev;
  }
  updateSmear(S) {
    const [a, b] = SMEAR[S.kind], T = this.trail;
    if (S.t < a || S.t > b + 0.08) { this.smear.visible = false; return; }
    this.root.updateMatrix();
    const base = new THREE.Vector3(0, Y0 + 0.2, 0).applyMatrix4(this.root.matrix), tip = new THREE.Vector3(0, Y0 + L, 0).applyMatrix4(this.root.matrix);
    if (S.t <= b) { T.base.pop(); T.tip.pop(); T.base.unshift(base); T.tip.unshift(tip); this.trailCount = Math.min(T.n, this.trailCount + 1); }
    else this.trailCount = Math.max(0, this.trailCount - 2);
    const pos = this.smear.geometry.attributes.position, col = this.smear.geometry.attributes.color, n = this.trailCount;
    const fade = S.t > b ? 1 - (S.t - b) / 0.08 : 1;
    for (let i = 0; i < T.n; i++) {
      const j = Math.min(i, Math.max(0, n - 1));
      pos.setXYZ(i * 2, T.base[j].x, T.base[j].y, T.base[j].z); pos.setXYZ(i * 2 + 1, T.tip[j].x, T.tip[j].y, T.tip[j].z);
      const w = n > 1 ? Math.max(0, 1 - i / (n - 1)) : 0, al = 0.32 * w * w * fade;
      col.setXYZW(i * 2, 0.7, 0.72, 0.75, 0); col.setXYZW(i * 2 + 1, al * 1.1, al * 1.12, al * 1.15, al);
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.smear.visible = n > 2;
  }
}

// exposed for the pose lab / screenshot scripts
export const POSES = { LOW, IDLE, SETS, END, HIT_T, cache };
