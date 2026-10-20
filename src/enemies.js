import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, damp, rand, rayCapsule, raySphere } from './core/util.js';
import { ARENA } from './world/arena.js';

// ---------------------------------------------------------------------------
// HUSKS: charred humanoids with ember cracks. Bodies are 15-joint skeletons drawn
// with one InstancedMesh per body part; alive they run a procedural gait, dead
// they become Verlet ragdolls and burn away with a dissolve shader.
// ---------------------------------------------------------------------------
const J = { pelvis: 0, chest: 1, head: 2, lSh: 3, lEl: 4, lHa: 5, rSh: 6, rEl: 7, rHa: 8, lHip: 9, lKn: 10, lFt: 11, rHip: 12, rKn: 13, rFt: 14 };
const NJ = 15;
// part: [jointA, jointB, radius, kind]
const PARTS = [
  ['torso', J.pelvis, J.chest, 0.19, 'body'],
  ['head', J.chest, J.head, 0.125, 'head'],
  ['upperL', J.lSh, J.lEl, 0.068, 'limb'], ['foreL', J.lEl, J.lHa, 0.058, 'limb'],
  ['upperR', J.rSh, J.rEl, 0.068, 'limb'], ['foreR', J.rEl, J.rHa, 0.058, 'limb'],
  ['thighL', J.lHip, J.lKn, 0.092, 'limb'], ['shinL', J.lKn, J.lFt, 0.07, 'limb'],
  ['thighR', J.rHip, J.rKn, 0.092, 'limb'], ['shinR', J.rKn, J.rFt, 0.07, 'limb'],
];
const LEN = { torso: 0.5, head: 0.24, upper: 0.3, fore: 0.31, thigh: 0.44, shin: 0.44 };
// extra ragdoll constraints that keep the trunk rigid-ish
const BRACES = [[J.pelvis, J.lHip], [J.pelvis, J.rHip], [J.lHip, J.rHip], [J.chest, J.lSh], [J.chest, J.rSh], [J.lSh, J.rSh],
  [J.lSh, J.pelvis], [J.rSh, J.pelvis], [J.lHip, J.chest], [J.rHip, J.chest], [J.lSh, J.head], [J.rSh, J.head]];

export const TYPES = {
  runner: { name: 'Husk', hp: 90, speed: 6.3, scale: 1, reach: 1.55, dmg: 14, windup: 0.3, cd: 0.95, mass: 1, points: 100, color: new THREE.Color(0.16, 0.13, 0.12), heat: 1, lean: 0.22 },
  brute: { name: 'Brute', hp: 650, speed: 3.5, scale: 1.42, reach: 2.2, dmg: 34, windup: 0.55, cd: 1.7, mass: 4.5, points: 400, color: new THREE.Color(0.1, 0.085, 0.08), heat: 1.8, lean: 0.38, brute: true },
};

function emberTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 256, 256);
  x.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    let px = Math.random() * 256, py = Math.random() * 256;
    x.strokeStyle = `rgba(255,${120 + Math.random() * 90},40,${0.5 + Math.random() * 0.5})`;
    x.lineWidth = 0.6 + Math.random() * 1.3;
    x.beginPath(); x.moveTo(px, py);
    for (let k = 0; k < 5; k++) { px += (Math.random() - 0.5) * 26; py += (Math.random() - 0.5) * 26; x.lineTo(px, py); }
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(2, 2); return t;
}
function charTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); const img = x.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = 60 + Math.random() * 60 + Math.sin(i * 0.013) * 10; img.data.set([v, v * 0.92, v * 0.86, 255], i * 4); }
  x.putImageData(img, 0, 0);
  for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '20,16,14' : '120,100,90'},${Math.random() * 0.4})`; x.beginPath(); x.arc(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 10, 0, 6.28); x.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

function withGlow(g, v = 0) { g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(v), 1)); if (g.index) g = g.toNonIndexed(); return g; }
function partGeometry(name, r) {
  let len = LEN[name.replace(/[LR]$/, '')] || 0.3;
  if (name === 'torso') {
    const g = new THREE.CapsuleGeometry(r, len - r * 0.3, 6, 12); g.scale(1.22, 1, 0.78); g.translate(0, len / 2, 0);
    // shoulder yoke + ribs bulge
    const y = new THREE.CapsuleGeometry(0.1, 0.32, 4, 8); y.rotateZ(Math.PI / 2); y.scale(1, 1, 0.9); y.translate(0, len - 0.06, -0.01);
    return mergeGeometries([withGlow(g), withGlow(y)]);
  }
  if (name === 'head') {
    const neck = new THREE.CylinderGeometry(0.05, 0.065, len * 0.6, 8); neck.translate(0, len * 0.3, 0);
    const skull = new THREE.SphereGeometry(r, 16, 12); skull.scale(0.9, 1.08, 1); skull.translate(0, len, 0.01);
    const jaw = new THREE.BoxGeometry(0.15, 0.07, 0.12); jaw.translate(0, len - 0.09, 0.05);
    const eyeL = new THREE.SphereGeometry(0.022, 8, 6); eyeL.translate(-0.042, len + 0.015, r * 0.86);
    const eyeR = eyeL.clone(); eyeR.translate(0.084, 0, 0);
    return mergeGeometries([withGlow(neck), withGlow(skull), withGlow(jaw), withGlow(eyeL, 1), withGlow(eyeR, 1)]);
  }
  const g = new THREE.CapsuleGeometry(r, len, 4, 8); g.translate(0, len / 2, 0);
  if (name.startsWith('fore')) { const claw = new THREE.ConeGeometry(0.05, 0.14, 6); claw.translate(0, len + 0.07, 0.01); return mergeGeometries([withGlow(g), withGlow(claw)]); }
  return mergeGeometries([withGlow(g)]);
}

function huskMaterial(char, ember) {
  const m = new THREE.MeshStandardMaterial({ map: char, color: '#ffffff', roughness: 0.85, metalness: 0.05, emissive: new THREE.Color(2.4, 0.7, 0.18), emissiveMap: ember });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float iFlash; attribute float iDissolve; attribute float iHeat; attribute float glow;
        varying float vFlash; varying float vDissolve; varying float vHeat; varying float vGlow; varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlash = iFlash; vDissolve = iDissolve; vHeat = iHeat; vGlow = glow; vLocal = position * 9.0 + vec3(float(gl_InstanceID) * 3.7);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFlash; varying float vDissolve; varying float vHeat; varying float vGlow; varying vec3 vLocal;
        float h3(vec3 p){ return fract(sin(dot(p, vec3(17.1, 113.7, 51.3))) * 43758.5453); }
        float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i), h3(i+vec3(1,0,0)), f.x), mix(h3(i+vec3(0,1,0)), h3(i+vec3(1,1,0)), f.x), f.y),
                     mix(mix(h3(i+vec3(0,0,1)), h3(i+vec3(1,0,1)), f.x), mix(h3(i+vec3(0,1,1)), h3(i+vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float dn = n3(vLocal) * 0.65 + n3(vLocal * 2.7) * 0.35;
        if (dn < vDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance *= vHeat * (0.75 + 0.25 * sin(vLocal.y * 0.7 + vLocal.x));
        totalEmissiveRadiance += vec3(6.0, 2.2, 0.6) * vGlow * (1.0 - vDissolve);
        float edge = smoothstep(vDissolve + 0.09, vDissolve, dn) * step(0.001, vDissolve);
        totalEmissiveRadiance += vec3(5.0, 1.6, 0.3) * edge * 2.0;
        totalEmissiveRadiance += vec3(0.9, 0.55, 0.35) * vFlash;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), vFlash * 0.25);`);
  };
  return m;
}

function huskDepthMaterial() {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iDissolve; varying float vDissolve;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDissolve = iDissolve;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDissolve;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vDissolve > 0.001) discard;');
  };
  return m;
}

const tmpM = new THREE.Matrix4(), tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3(), tS = new THREE.Vector3();

export class Horde {
  constructor(scene, arena, hooks) {
    this.scene = scene; this.arena = arena; this.hooks = hooks; this.player = hooks.player;
    this.colliders = arena.colliders.filter((c) => !c.ground);
    this.max = 72;
    const char = charTexture(), ember = emberTexture();
    this.material = huskMaterial(char, ember);
    this.depthMat = huskDepthMaterial();
    this.parts = PARTS.map(([name, a, b, r, kind]) => {
      const geo = partGeometry(name, r);
      const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(this.max).fill(n), 1).setUsage(THREE.DynamicDrawUsage);
      const flash = mk(0), diss = mk(0), heat = mk(1);
      geo.setAttribute('iFlash', flash); geo.setAttribute('iDissolve', diss); geo.setAttribute('iHeat', heat);
      const mesh = new THREE.InstancedMesh(geo, this.material, this.max);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      mesh.customDepthMaterial = this.depthMat;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(mesh);
      return { name, a, b, r, kind, mesh, flash, diss, heat, len: LEN[name.replace(/[LR]$/, '')] };
    });
    this.pool = [];
    this.enemies = [];
    // flow field
    const nav = arena.nav; this.nav = nav;
    this.dist = new Int16Array(nav.N * nav.N).fill(-1);
    this.flowT = 0;
    this.hash = new Map();
    this.wave = 0; this.toSpawn = 0; this.spawnT = 0; this.intermission = 0; this.running = false;
    this.growlT = 0; this.alertT = 0; this.screamT = 0;
  }

  // ---------------------------------------------------------------- waves
  reset() {
    for (const e of this.enemies) this.pool.push(e);
    this.enemies.length = 0; this.wave = 0; this.toSpawn = 0; this.running = false; this.waveKilled = 0; this.waveTotal = 0;
    this.syncInstances();
  }
  start() { this.running = true; this.intermission = 2.5; }
  remaining() { return this.toSpawn + this.enemies.filter((e) => !e.dead).length; }
  aliveCount() { return this.enemies.filter((e) => !e.dead).length; }
  nextWave() {
    this.wave++;
    const n = 6 + this.wave * 5;
    this.brutesLeft = this.wave >= 3 ? Math.floor((this.wave - 1) / 2) : 0;
    this.toSpawn = n; this.waveTotal = n; this.spawnT = 0.5;
    this.hooks.onWaveStart?.(this.wave, n);
  }
  // gunfire wakes idle husks within earshot (closer ones react first)
  alert(pos, radius = 34) {
    for (const e of this.enemies) {
      if (e.dead || e.aware) continue;
      const d = e.pos.distanceTo(pos);
      if (d < radius) e.alertIn = Math.min(e.alertIn ?? 9, 0.12 + d / 70 + rand(0, 0.2));
    }
  }
  wake(e) {
    if (e.aware) return;
    e.aware = true; e.alertIn = undefined; e.flinchV -= 4; e.stagger = Math.max(e.stagger, 0.12);
    if (this.screamT <= 0) { this.hooks.audio.play('scream', this.spatial(e)); this.screamT = 0.25; }
  }
  // quick melee: nearest husk in a short cone in front of the player
  meleeHit(o, f, range) {
    let best = null, bd = range;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const c = e.joints[J.chest].clone().lerp(e.joints[J.pelvis], 0.3);
      const v = c.clone().sub(o); const d = v.length();
      if (d > range + 0.3 * e.scale) continue;
      v.normalize();
      if (v.dot(f) < 0.55 && d > 0.9) continue;
      if (d < bd + 0.3 * e.scale) { bd = d; best = { e, t: d, point: c }; }
    }
    return best;
  }

  spawn(typeKey, at, idle = false) {
    const T = TYPES[typeKey];
    const e = this.pool.pop() || { joints: Array.from({ length: NJ }, () => new THREE.Vector3()), prev: Array.from({ length: NJ }, () => new THREE.Vector3()), pos: new THREE.Vector3(), vel: new THREE.Vector3(), kb: new THREE.Vector3(), gatePt: new THREE.Vector3() };
    e.type = T; e.key = typeKey;
    e.hp = T.hp * (1 + Math.max(0, this.wave - 4) * 0.06);
    e.pos.copy(at); e.vel.set(0, 0, 0); e.kb.set(0, 0, 0); e.vy = 0;
    e.yaw = Math.atan2(-at.x, -at.z); e.phase = rand(0, 6.28);
    e.speed = T.speed * rand(0.88, 1.12) * (1 + Math.min(0.25, this.wave * 0.02));
    e.flank = rand(-0.7, 0.7); e.speedNow = 0;
    e.dead = false; e.deadT = 0; e.dissolve = 0; e.flash = 0; e.stagger = 0;
    e.flinch = 0; e.flinchV = 0; e.headSnap = 0; e.headSnapV = 0; e.twist = 0; e.twistV = 0;
    e.attackT = -1; e.attackCd = rand(0.2, 0.6); e.leapCd = 1;
    e.growlT = rand(1, 5); e.grounded = true; e.scale = T.scale * rand(0.95, 1.06);
    e.armHeight = rand(0.75, 1.25);
    e.heat = T.heat * rand(0.8, 1.2);
    e.lastHit = -1; e.rest = {}; e.pooled = false; e.near = null;
    e.aware = !idle; e.alertIn = undefined; e.wander = new THREE.Vector3(rand(-28, 28), 0, rand(-28, 28)); e.wanderT = rand(4, 9);
    // walk in through the nearest gate
    const g = Math.abs(at.x) > Math.abs(at.z) ? new THREE.Vector3(Math.sign(at.x) * (ARENA.half - 1.5), 0, clamp(at.z, -2.5, 2.5)) : new THREE.Vector3(clamp(at.x, -2.5, 2.5), 0, Math.sign(at.z) * (ARENA.half - 1.5));
    e.gatePt.copy(g); e.outside = Math.max(Math.abs(at.x), Math.abs(at.z)) > ARENA.half - 2;
    this.pose(e, 0);
    this.enemies.push(e);
    return e;
  }
  debugSpawn(n, dist = 14, idle = false) {
    const P = this.player.pos;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2), d = dist + rand(-2, 3);
      const x = clamp(P.x + Math.sin(a) * d, -34, 34), z = clamp(P.z + Math.cos(a) * d, -34, 34);
      this.spawn(i % 7 === 6 ? 'brute' : 'runner', new THREE.Vector3(x, this.groundAt(x, z, 10), z), idle);
    }
  }

  // ---------------------------------------------------------------- navigation
  cellOf(x, z) { const N = this.nav.N, H = this.nav.H; const gx = Math.floor(x + H), gz = Math.floor(z + H); if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -1; return gz * N + gx; }
  buildFlow() {
    const { N, height, blocked } = this.nav, dist = this.dist;
    dist.fill(-1);
    const start = this.cellOf(this.player.pos.x, this.player.pos.z); if (start < 0) return;
    const q = new Int32Array(N * N); let qh = 0, qt = 0;
    dist[start] = 0; q[qt++] = start;
    const pY = this.player.pos.y;
    while (qh < qt) {
      const c = q[qh++], cx = c % N, cz = (c / N) | 0, ch = c === start ? pY : height[c];
      for (let k = 0; k < 4; k++) {
        const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0), nz = cz + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = nz * N + nx;
        if (dist[n] >= 0 || blocked[n]) continue;
        if (c !== start && Math.abs(height[n] - ch) > 0.55) continue;
        dist[n] = dist[c] + 1; q[qt++] = n;
      }
    }
  }
  flowDir(e, out) {
    const { N, H } = this.nav, c = this.cellOf(e.pos.x, e.pos.z);
    if (c < 0 || this.dist[c] < 0) return false;
    const cx = c % N, cz = (c / N) | 0; let best = this.dist[c], bx = 0, bz = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
      const d = this.dist[nz * N + nx]; if (d < 0) continue;
      if (dx && dz && (this.dist[cz * N + nx] < 0 || this.dist[nz * N + cx] < 0)) continue;
      const score = d + (dx && dz ? 0.41 : 0);
      if (score < best) { best = score; bx = dx; bz = dz; }
    }
    if (!bx && !bz) return false;
    const tx = cx + bx - H + 0.5, tz = cz + bz - H + 0.5;
    out.set(tx - e.pos.x, 0, tz - e.pos.z).normalize();
    return true;
  }
  groundAt(x, z, y, r = 0.15) {
    let g = 0;
    for (const c of this.colliders) {
      if (x < c.minX - r || x > c.maxX + r || z < c.minZ - r || z > c.maxZ + r) continue;
      if (c.maxY <= y + 0.6 && c.maxY > g) g = c.maxY;
    }
    return g;
  }
  collide(e) {
    const r = 0.32 * e.scale, p = e.pos, top = p.y + 1.6 * e.scale;
    for (const c of this.colliders) {
      if (c.maxY <= p.y + 0.6 || c.minY >= top) continue;
      if (p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
      const qx = clamp(p.x, c.minX, c.maxX), qz = clamp(p.z, c.minZ, c.maxZ);
      let dx = p.x - qx, dz = p.z - qz, d = Math.hypot(dx, dz);
      if (d >= r) continue;
      if (d < 1e-5) { // center inside: push out the shortest way
        const opts = [[c.minX - r - p.x, 0], [c.maxX + r - p.x, 0], [0, c.minZ - r - p.z], [0, c.maxZ + r - p.z]];
        opts.sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
        p.x += opts[0][0]; p.z += opts[0][1]; continue;
      }
      p.x = qx + (dx / d) * r; p.z = qz + (dz / d) * r;
    }
    if (!e.outside) { p.x = clamp(p.x, -35.5, 35.5); p.z = clamp(p.z, -35.5, 35.5); }
  }

  // ---------------------------------------------------------------- combat
  raycast(o, d, maxT) {
    const hits = [], c = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) continue;
      c.copy(e.pos); c.y += 0.95 * e.scale;
      if (raySphere(o, d, c, 1.25 * e.scale, maxT) < 0 && c.distanceToSquared(o) > 2.5) continue;
      let best = maxT, part = null;
      for (const P of this.parts) {
        let t;
        if (P.kind === 'head') { t = raySphere(o, d, e.joints[J.head], 0.15 * e.scale, best); }
        else t = rayCapsule(o, d, e.joints[P.a], e.joints[P.b], P.r * e.scale * (P.name === 'torso' ? 1.15 : 1.1), best);
        if (t >= 0 && t < best) { best = t; part = P.kind; }
      }
      if (part) hits.push({ t: best, e, part, point: o.clone().addScaledVector(d, best) });
    }
    return hits.sort((a, b) => a.t - b.t);
  }
  damage(e, amount, part, point, dir, def) {
    if (e.dead) return { killed: false };
    e.hp -= amount; e.flash = 1; e.lastHit = performance.now();
    if (!e.aware) this.wake(e);
    const T = e.type, big = def.id !== 'ar';
    this.hooks.fx.bloodHit(point, dir, big || part === 'head');
    const dist = point.distanceTo(this.player.pos);
    this.hooks.audio.play('flesh', { gain: clamp(8 / (dist + 3), 0.2, 1) });
    // stagger + knockback (heavier enemies resist)
    const imp = (amount / 30) / T.mass;
    e.kb.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), Math.min(def.knock ? 9 : 6, imp * (def.knock ?? (def.id === 'sg' ? 1.6 : 1.1))));
    e.stagger = Math.max(e.stagger, Math.min(0.55, 0.12 + imp * 0.25));
    // flinch: torso jerks back, head snaps
    const local = Math.sin(e.yaw) * dir.x + Math.cos(e.yaw) * dir.z; // + when shot from behind
    e.flinchV -= imp * 9 * Math.sign(local || 1) * -1;
    if (part === 'head') e.headSnapV -= 14 * Math.min(1.5, imp + 0.4) * -Math.sign(local || 1);
    e.twistV += (Math.random() - 0.5) * imp * 22;
    if (e.hp <= 0) {
      const head = part === 'head';
      this.kill(e, point, dir, amount, def, head);
      this.hooks.onKill?.(e, { head, def });
      return { killed: true, head };
    }
    return { killed: false };
  }
  kill(e, point, dir, amount, def, head) {
    e.dead = true; e.deadT = 0;
    // ragdoll: previous positions encode velocity (motion + shot impulse, strongest near the hit)
    const h = 1 / 120;
    const v = e.vel.clone().add(e.kb);
    const push = dir.clone().multiplyScalar(clamp(amount / 22, 1.5, def.id === 'sg' ? 9 : 6) / Math.sqrt(e.type.mass));
    push.y += 1.2;
    for (let i = 0; i < NJ; i++) {
      const j = e.joints[i];
      const w = Math.exp(-j.distanceTo(point) * 2.2);
      e.prev[i].copy(j).addScaledVector(v, -h).addScaledVector(push, -h * (0.35 + w * 1.4));
    }
    if (head) this.hooks.fx.bloodHit(e.joints[J.head], dir, true);
    this.hooks.audio.play('scream', { gain: 0.5 });
  }

  // ---------------------------------------------------------------- per frame
  update(dt, time, camera) {
    if (dt <= 0) { return; }
    const P = this.player;
    // waves
    if (this.running && P.alive) {
      if (this.toSpawn <= 0 && this.aliveCount() === 0) {
        if (this.wave > 0 && this.intermission <= 0) { this.hooks.onWaveEnd?.(this.wave); this.intermission = 7; }
        this.intermission -= dt;
        if (this.intermission <= 0) this.nextWave();
      } else if (this.toSpawn > 0) {
        this.spawnT -= dt;
        if (this.spawnT <= 0 && this.aliveCount() < 42) {
          const spawns = this.arena.spawns;
          const sp = spawns[Math.floor(Math.random() * spawns.length)];
          const brute = this.brutesLeft > 0 && Math.random() < this.brutesLeft / this.toSpawn + 0.05;
          if (brute) this.brutesLeft--;
          const at = sp.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 0, rand(-2.5, 2.5)));
          this.spawn(brute ? 'brute' : 'runner', at, !brute && Math.random() < 0.25);
          this.toSpawn--;
          this.spawnT = Math.max(0.12, 0.55 - this.wave * 0.035) * rand(0.5, 1.5);
        }
      }
    }
    this.flowT -= dt;
    if (this.flowT <= 0) { this.buildFlow(); this.flowT = 0.25; }
    // spatial hash for separation
    this.hash.clear();
    for (const e of this.enemies) {
      if (e.dead) continue;
      const k = (Math.floor(e.pos.x / 2) + 64) * 256 + Math.floor(e.pos.z / 2) + 64;
      let b = this.hash.get(k); if (!b) this.hash.set(k, (b = [])); b.push(e);
    }
    this.growlT -= dt; this.alertT -= dt; this.screamT -= dt;
    const dir = new THREE.Vector3(), toP = new THREE.Vector3(), sep = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.dead) { this.updateRagdoll(e, dt); continue; }
      const T = e.type;
      toP.copy(P.pos).sub(e.pos); const dy = toP.y; toP.y = 0;
      const dist = toP.length(); toP.divideScalar(dist || 1);
      // idle husks shamble between random points until they see/hear the player
      if (!e.aware) {
        if (e.alertIn !== undefined) { e.alertIn -= dt; if (e.alertIn <= 0) this.wake(e); }
        if (dist < 11 && Math.abs(dy) < 3) this.wake(e);
      }
      // steering
      if (!e.aware && !e.outside) {
        e.wanderT -= dt;
        dir.copy(e.wander).sub(e.pos).setY(0);
        if (dir.length() < 1.5 || e.wanderT <= 0) { e.wander.set(rand(-28, 28), 0, rand(-28, 28)); e.wanderT = rand(4, 9); }
        dir.normalize();
      } else if (e.outside) {
        dir.copy(e.gatePt).sub(e.pos).setY(0);
        if (dir.length() < 1.2) e.outside = false;
        dir.normalize();
      } else if (dist < 4.5 && Math.abs(dy) < 1.2) dir.copy(toP);
      else if (!this.flowDir(e, dir)) dir.copy(toP);
      // flank: bend the approach sideways when far, converge when close
      if (e.aware && !e.outside && dist > 7) {
        const f = e.flank * clamp((dist - 7) / 12, 0, 1);
        const c = Math.cos(f), s = Math.sin(f); dir.set(dir.x * c - dir.z * s, 0, dir.x * s + dir.z * c);
      }
      // separation
      sep.set(0, 0, 0);
      const kx = Math.floor(e.pos.x / 2) + 64, kz = Math.floor(e.pos.z / 2) + 64;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const b = this.hash.get((kx + ox) * 256 + kz + oz); if (!b) continue;
        for (const o of b) {
          if (o === e) continue;
          const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d2 = dx * dx + dz * dz;
          const rr = 0.75 * (e.scale + o.scale);
          if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); sep.x += (dx / d) * (rr - d) / rr; sep.z += (dz / d) * (rr - d) / rr; }
        }
      }
      dir.addScaledVector(sep, 1.6);
      // stop at melee range
      let want = e.aware ? e.speed : e.speed * 0.2;
      if (e.aware && dist < T.reach * 0.75 && Math.abs(dy) < 1.2) want = 0;
      if (e.stagger > 0) { want *= 0.15; e.stagger -= dt; }
      if (e.attackT >= 0) want *= 0.35;
      // brutes charge when close
      if (e.aware && T.brute && dist < 10 && dist > 3) want *= 1.8;
      const dl = dir.length(); if (dl > 0) dir.divideScalar(Math.max(1, dl));
      const acc = e.grounded ? 9 : 1.5;
      e.vel.x = damp(e.vel.x, dir.x * want, acc, dt); e.vel.z = damp(e.vel.z, dir.z * want, acc, dt);
      e.kb.multiplyScalar(Math.exp(-7 * dt));
      e.pos.x += (e.vel.x + e.kb.x) * dt; e.pos.z += (e.vel.z + e.kb.z) * dt;
      this.collide(e);
      // vertical: gravity, step up, leap toward an elevated player
      const g = this.groundAt(e.pos.x, e.pos.z, e.pos.y);
      if (e.grounded && g > e.pos.y) e.pos.y = g;
      e.vy -= 18 * dt; e.pos.y += e.vy * dt;
      if (e.pos.y <= g) { if (!e.grounded && e.vy < -4) e.stagger = 0.15; e.pos.y = g; e.vy = 0; e.grounded = true; } else if (e.pos.y > g + 0.05) e.grounded = false;
      e.leapCd -= dt;
      if (e.aware && e.grounded && dy > 0.9 && dy < 4 && dist < 4.5 && e.leapCd <= 0 && !T.brute) {
        e.vy = Math.sqrt(2 * 18 * (dy + 0.9)); e.leapCd = 2.2;
        const tt = e.vy / 18 * 1.6; e.vel.copy(toP).multiplyScalar(Math.min(9, dist / tt + 1)); e.grounded = false;
        this.hooks.audio.play('growl', this.spatial(e, { brute: false }));
      }
      // facing + gait
      const sp = Math.hypot(e.vel.x, e.vel.z); e.speedNow = sp;
      const faceYaw = e.aware && dist < 6 ? Math.atan2(toP.x, toP.z) : sp > 0.3 ? Math.atan2(e.vel.x, e.vel.z) : e.yaw;
      let dyaw = faceYaw - e.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      e.yaw += dyaw * (1 - Math.exp(-10 * dt));
      e.phase += dt * (sp * (T.brute ? 1.5 : 2.05) / e.scale + 0.5);
      // attack
      e.attackCd -= dt;
      if (e.aware && e.attackT < 0 && e.attackCd <= 0 && dist < T.reach && Math.abs(dy) < 1.3 && P.alive) {
        e.attackT = 0; this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute }));
      }
      if (e.attackT >= 0) {
        const before = e.attackT; e.attackT += dt;
        if (before < T.windup && e.attackT >= T.windup) {
          this.hooks.audio.play('swing', this.spatial(e));
          if (dist < T.reach + 0.45 && Math.abs(dy) < 1.4 && e.stagger <= 0) this.hooks.onPlayerHit?.(T.dmg, e.pos, e);
        }
        if (e.attackT > T.windup + 0.35) { e.attackT = -1; e.attackCd = T.cd * rand(0.8, 1.2); }
      }
      // ambient voices
      e.growlT -= dt;
      if (e.growlT <= 0 && this.growlT <= 0) { this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute })); e.growlT = rand(3, 8); this.growlT = 0.35; }
      // flinch springs
      e.flinchV += (-e.flinch * 140 - e.flinchV * 14) * dt; e.flinch += e.flinchV * dt;
      e.headSnapV += (-e.headSnap * 160 - e.headSnapV * 12) * dt; e.headSnap += e.headSnapV * dt;
      e.twistV += (-e.twist * 120 - e.twistV * 12) * dt; e.twist += e.twistV * dt;
      e.flash = Math.max(0, e.flash - dt * 9);
      this.pose(e, time);
    }
    // recycle burned corpses
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.dissolve >= 1) { this.enemies.splice(i, 1); this.pool.push(e); }
    }
    this.syncInstances();
  }
  spatial(e, o = {}) {
    const P = this.player, dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    return { ...o, pan: clamp((dx * rx + dz * rz) / (d + 1), -0.9, 0.9), gain: clamp(10 / (d + 4), 0.06, 1) };
  }

  // procedural run cycle in the enemy's local frame (x right, y up, z forward)
  pose(e, time) {
    const T = e.type, s = e.scale, sp = clamp(e.speedNow / 6, 0, 1.4), ph = e.phase;
    const L = [];
    const bounce = Math.abs(Math.sin(ph)) * 0.07 * sp;
    const hipY = 0.9 - 0.06 * sp + bounce;
    const lean = T.lean + 0.22 * sp + e.flinch + (e.attackT >= 0 ? 0.2 : 0);
    const twist = e.twist + Math.sin(ph) * 0.12 * sp;
    const pelvis = new THREE.Vector3(0, hipY, 0);
    const ct = Math.cos(twist), st = Math.sin(twist);
    const chest = pelvis.clone().add(new THREE.Vector3(Math.sin(twist) * 0.02, Math.cos(lean) * LEN.torso, Math.sin(lean) * LEN.torso));
    const hl = lean * 0.4 + e.headSnap;
    const head = chest.clone().add(new THREE.Vector3(Math.sin(e.headSnap * 0.5) * 0.05, Math.cos(hl) * LEN.head, Math.sin(hl) * LEN.head + 0.02));
    const side = (sx) => new THREE.Vector3(sx * ct * 0.2, -0.05, -sx * st * 0.2);
    const lSh = chest.clone().add(side(-1)), rSh = chest.clone().add(side(1));
    const dirA = (a, out = new THREE.Vector3(), splay = 0) => out.set(splay, -Math.cos(a), Math.sin(a));
    // arms: clawing reach forward, alternating with the gait; attack swings the right arm overhead and down
    const reach = (1.0 + 0.25 * sp) * e.armHeight;
    let la = reach + Math.sin(ph) * 0.45 * sp, ra = reach - Math.sin(ph) * 0.45 * sp, rBend = 0.5, lBend = 0.6;
    if (e.attackT >= 0) {
      const w = T.windup, t = e.attackT;
      const k = t < w ? t / w : 1 - Math.min(1, (t - w) / 0.2);
      ra = lerp(0.4, 2.9, Math.pow(k, 0.7)); rBend = lerp(0.3, 1.2, k);
      la = lerp(la, 1.6, 0.5);
    }
    const lEl = lSh.clone().addScaledVector(dirA(la, undefined, -0.15).normalize(), LEN.upper);
    const lHa = lEl.clone().addScaledVector(dirA(la + lBend, undefined, 0.1).normalize(), LEN.fore);
    const rEl = rSh.clone().addScaledVector(dirA(ra, undefined, 0.15).normalize(), LEN.upper);
    const rHa = rEl.clone().addScaledVector(dirA(ra + rBend, undefined, -0.1).normalize(), LEN.fore);
    // legs
    const leg = (sx, off) => {
      const hip = pelvis.clone().add(new THREE.Vector3(sx * 0.105, -0.03, 0));
      const sw = Math.sin(ph + off) * 0.7 * sp;
      const bend = (0.15 + 1.1 * Math.max(0, -Math.cos(ph + off))) * sp + 0.06;
      const knee = hip.clone().addScaledVector(dirA(sw), LEN.thigh);
      const foot = knee.clone().addScaledVector(dirA(sw - bend), LEN.shin);
      return [hip, knee, foot];
    };
    const [lHip, lKn, lFt] = leg(-1, 0), [rHip, rKn, rFt] = leg(1, Math.PI);
    L.push(pelvis, chest, head, lSh, lEl, lHa, rSh, rEl, rHa, lHip, lKn, lFt, rHip, rKn, rFt);
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    for (let i = 0; i < NJ; i++) {
      const v = L[i];
      e.joints[i].set((v.x * cy + v.z * sy) * s + e.pos.x, v.y * s + e.pos.y, (-v.x * sy + v.z * cy) * s + e.pos.z);
    }
    void time;
  }

  updateRagdoll(e, dt) {
    e.deadT += dt;
    if (e.deadT > 1.6) e.dissolve = Math.min(1, e.dissolve + dt / 1.3);
    if (e.deadT > 3.5) return;
    const steps = clamp(Math.round(dt * 120), 1, 4), h = 1 / 120;
    const s = e.scale;
    if (!e.near) {
      const c0 = e.joints[J.pelvis];
      e.near = this.colliders.filter((c) => c0.x > c.minX - 3 && c0.x < c.maxX + 3 && c0.z > c.minZ - 3 && c0.z < c.maxZ + 3);
    }
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < NJ; i++) {
        const j = e.joints[i], p = e.prev[i];
        const vx = (j.x - p.x) * 0.995, vy = (j.y - p.y) * 0.995, vz = (j.z - p.z) * 0.995;
        p.copy(j);
        j.x += vx; j.y += vy - 18 * h * h; j.z += vz;
      }
      for (let it = 0; it < 3; it++) {
        for (const P of this.parts) this.constrain(e.joints[P.a], e.joints[P.b], P.len * s);
        for (const [a, b] of BRACES) this.constrain(e.joints[a], e.joints[b], this.restLen(e, a, b));
      }
      for (let i = 0; i < NJ; i++) {
        const j = e.joints[i], rad = 0.08 * s;
        let g = 0;
        for (const c of e.near) {
          if (j.x < c.minX || j.x > c.maxX || j.z < c.minZ || j.z > c.maxZ) continue;
          if (c.maxY <= j.y + 0.35) { if (c.maxY > g) g = c.maxY; continue; }
          if (j.y < c.minY) continue;
          // inside a wall: push out sideways
          const dxm = j.x - c.minX, dxM = c.maxX - j.x, dzm = j.z - c.minZ, dzM = c.maxZ - j.z, m = Math.min(dxm, dxM, dzm, dzM);
          if (m === dxm) j.x = c.minX; else if (m === dxM) j.x = c.maxX; else if (m === dzm) j.z = c.minZ; else j.z = c.maxZ;
        }
        if (j.y < g + rad) {
          j.y = g + rad;
          const p = e.prev[i]; p.x = lerp(p.x, j.x, 0.35); p.z = lerp(p.z, j.z, 0.35); // friction
        }
      }
    }
    if (e.deadT > 0.6 && !e.pooled) { e.pooled = true; const c = e.joints[J.chest]; this.hooks.fx.bloodPool(c, s, this.groundAt(c.x, c.z, c.y)); }
  }
  restLen(e, a, b) {
    const k = a * 16 + b;
    if (e.rest[k] === undefined) e.rest[k] = e.joints[a].distanceTo(e.joints[b]);
    return e.rest[k];
  }
  constrain(a, b, len) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    const k = ((d - len) / d) * 0.5;
    a.x += dx * k; a.y += dy * k; a.z += dz * k; b.x -= dx * k; b.y -= dy * k; b.z -= dz * k;
  }

  syncInstances() {
    const n = this.enemies.length;
    for (const P of this.parts) {
      const mesh = P.mesh;
      for (let i = 0; i < n; i++) {
        const e = this.enemies[i];
        const A = e.joints[P.a], B = e.joints[P.b];
        tY.copy(B).sub(A); const len = tY.length() || 1e-4; tY.divideScalar(len);
        // side axis from shoulders keeps the torso/head facing correctly (also in ragdoll)
        tX.copy(e.joints[J.rSh]).sub(e.joints[J.lSh]);
        tZ.crossVectors(tX, tY);
        if (tZ.lengthSq() < 1e-6) tZ.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        tZ.normalize(); tX.crossVectors(tY, tZ).normalize();
        const s = e.scale;
        tmpM.makeBasis(tX.multiplyScalar(s), tY.multiplyScalar(s * (P.kind === 'head' ? 1 : len / (P.len * s))), tZ.multiplyScalar(s));
        tmpM.setPosition(A);
        mesh.setMatrixAt(i, tmpM);
        P.flash.array[i] = e.flash; P.diss.array[i] = e.dissolve * 1.05; P.heat.array[i] = e.dead ? e.heat * (1 + Math.min(e.deadT, 1.5) * 0.5) : e.heat;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true; P.flash.needsUpdate = P.diss.needsUpdate = P.heat.needsUpdate = true;
    }
    void tS;
  }
}
