import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, damp, rand, rayCapsule, raySphere, rayAABB } from './core/util.js';
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
  runner: { name: 'Husk', hp: 90, speed: 6.3, scale: 1, reach: 1.55, dmg: 14, windup: 0.3, cd: 0.95, mass: 1, points: 100, color: new THREE.Color(0.16, 0.13, 0.12), heat: 1, lean: 0.22, sever: 1 },
  brute: { name: 'Brute', hp: 650, speed: 3.5, scale: 1.42, reach: 2.2, dmg: 34, windup: 0.55, cd: 1.7, mass: 4.5, points: 400, color: new THREE.Color(0.1, 0.085, 0.08), heat: 1.8, lean: 0.38, brute: true, sever: 2.2 },
  spitter: { name: 'Spitter', hp: 120, speed: 4.6, scale: 0.97, reach: 1.5, dmg: 10, windup: 0.3, cd: 1.2, mass: 1, points: 175, color: new THREE.Color(0.14, 0.15, 0.11), heat: 1, lean: 0.3, hue: 1, ranged: true, bulk: 1.3, sever: 1 },
  boss: { name: 'Colossus', hp: 5200, speed: 3.5, scale: 2.2, reach: 3.4, dmg: 30, windup: 0.6, cd: 1.5, mass: 40, points: 3000, color: new THREE.Color(0.1, 0.085, 0.08), heat: 1.4, lean: 0.34, brute: true, boss: true, sever: 0, bulk: 1.3 },
};
// part index groups: severing an upper limb takes the whole arm/leg
const SEVER_GROUP = { 2: [2, 3], 3: [3], 4: [4, 5], 5: [5], 6: [6, 7], 7: [7], 8: [8, 9], 9: [9], 1: [1] };
const SEVER_THR = [1e9, 50, 55, 45, 55, 45, 75, 60, 75, 60];
const SEVER_F = { ar: 0.55, sg: 1.0, mr: 1.45 };
const LIMB_MAX = 36, MAXI = 72 + LIMB_MAX;
const SPIT_CHARGE = 0.85, SPIT_G = 14;

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
        attribute float iFlash; attribute float iDissolve; attribute float iHeat; attribute float iHue; attribute float glow;
        varying float vFlash; varying float vDissolve; varying float vHeat; varying float vGlow; varying float vHue; varying vec3 vLocal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFlash = iFlash; vHue = iHue; vDissolve = iDissolve; vHeat = iHeat; vGlow = glow; vLocal = position * 9.0 + vec3(float(gl_InstanceID) * 3.7);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFlash; varying float vDissolve; varying float vHeat; varying float vGlow; varying float vHue; varying vec3 vLocal;
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
        float lumE = dot(totalEmissiveRadiance, vec3(0.3, 0.59, 0.11));
        totalEmissiveRadiance = mix(totalEmissiveRadiance, vec3(0.45, 1.0, 0.12) * lumE * 1.8, vHue);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 1.0, 0.72), vHue);
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

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3(), tN = new THREE.Vector3();
const tmpM = new THREE.Matrix4(), tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3(), tS = new THREE.Vector3();

export class Horde {
  constructor(scene, arena, hooks) {
    this.scene = scene; this.arena = arena; this.hooks = hooks; this.player = hooks.player;
    this.colliders = arena.colliders.filter((c) => !c.ground);
    this.max = 72; this.maxI = MAXI;
    const char = charTexture(), ember = emberTexture();
    this.material = huskMaterial(char, ember);
    this.depthMat = huskDepthMaterial();
    this.parts = PARTS.map(([name, a, b, r, kind]) => {
      const geo = partGeometry(name, r);
      const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(MAXI).fill(n), 1).setUsage(THREE.DynamicDrawUsage);
      const flash = mk(0), diss = mk(0), heat = mk(1), hue = mk(0);
      geo.setAttribute('iHue', hue); geo.setAttribute('iFlash', flash); geo.setAttribute('iDissolve', diss); geo.setAttribute('iHeat', heat);
      const mesh = new THREE.InstancedMesh(geo, this.material, MAXI);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.count = 0;
      mesh.customDepthMaterial = this.depthMat;
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(mesh);
      return { name, a, b, r, kind, mesh, flash, diss, heat, hue, len: LEN[name.replace(/[LR]$/, '')] };
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
    this.limbs = []; this.limbPool = [];
    this.puddles = []; this.boss = null; this.bossDelay = 0;
    // pooled acid globs
    const orbGeo = new THREE.SphereGeometry(1, 14, 10), haloGeo = new THREE.SphereGeometry(1.7, 12, 8);
    const orbMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 4.2, 0.5), toneMapped: false });
    const haloMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 0.15), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.proj = Array.from({ length: 14 }, () => {
      const m = new THREE.Mesh(orbGeo, orbMat); m.add(new THREE.Mesh(haloGeo, haloMat)); m.visible = false; scene.add(m);
      return { mesh: m, vel: new THREE.Vector3(), state: 'free', life: 0, trailT: 0 };
    });
    this.buildBossRig(scene, ember);
  }

  // armor plates + glowing weak points that ride the boss skeleton
  buildBossRig(scene, ember) {
    const armor = new THREE.MeshStandardMaterial({ color: '#2e2925', roughness: 0.38, metalness: 0.85, emissive: new THREE.Color(1.6, 0.45, 0.1), emissiveMap: ember, emissiveIntensity: 0.5 });
    const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 2.4, 0.6), toneMapped: false });
    const halo = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.9, 0.2), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const L = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const pieces = [];
    const add = (geo, mat, part, local) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.castShadow = mat === armor; m.frustumCulled = false; m.visible = false; scene.add(m); pieces.push({ m, part, local }); };
    const rb = (w, h, d, r = 0.02) => new RoundedBoxGeometry(w, h, d, 2, r);
    add(rb(0.5, 0.36, 0.12, 0.04), armor, 0, L(0, 0.32, 0.15, -0.12));          // chest plate
    add(rb(0.44, 0.14, 0.11, 0.035), armor, 0, L(0, 0.08, 0.14, 0.15));          // belly band
    for (const sx of [-1, 1]) add(rb(0.17, 0.4, 0.1, 0.03), armor, 0, L(sx * 0.17, 0.3, -0.13, 0.1, sx * 0.25)); // back plates beside the core
    add(new THREE.TorusGeometry(0.1, 0.025, 8, 20), armor, 0, L(0, 0.34, -0.17));  // core collar
    add(new THREE.SphereGeometry(0.085, 16, 12), core, 0, L(0, 0.34, -0.17));     // back core (weak point)
    add(new THREE.SphereGeometry(0.16, 12, 8), halo, 0, L(0, 0.34, -0.19));
    for (const pi of [2, 4]) add(new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), armor, pi, L(0, 0.02, 0, 0, 0, 0, 1.1, 1, 1.1)); // pauldrons
    for (const pi of [3, 5]) add(new THREE.CylinderGeometry(0.07, 0.085, 0.2, 10), armor, pi, L(0, 0.13, 0));  // gauntlets
    for (const pi of [6, 8]) add(rb(0.17, 0.3, 0.09, 0.03), armor, pi, L(0, 0.2, 0.08));                  // thigh plates
    for (const pi of [7, 9]) add(rb(0.12, 0.26, 0.07, 0.025), armor, pi, L(0, 0.2, 0.06));                // shin guards
    add(new THREE.TorusGeometry(0.11, 0.018, 6, 20, Math.PI), core, 1, L(0, 0.255, 0.04, Math.PI / 2 - 0.2, 0, 0)); // glowing brow band (head weak point)
    
    this.rig = { pieces, core, halo, m: new THREE.Matrix4() };
  }
  updateBossRig(time) {
    const e = this.boss, R = this.rig;
    const vis = !!e && (!e.dead || e.dissolve < 0.15);
    for (const p of R.pieces) p.m.visible = vis;
    if (!vis) return;
    const pulse = 0.7 + 0.3 * Math.sin(time * 6), stun = e.bs === 'stun' ? 1.6 : 1;
    R.core.color.setRGB(3.2 * pulse * stun, 1.25 * pulse * stun, 0.3 * pulse);
    R.halo.opacity = (0.08 + 0.08 * pulse) * stun;
    for (const p of R.pieces) {
      const P = this.parts[p.part];
      this.partBasis(e, e.joints[P.a], e.joints[P.b], e.scale, R.m);
      p.m.matrix.multiplyMatrices(R.m, p.local);
      p.m.matrixWorldNeedsUpdate = true;
    }
  }
  // orthonormal frame on a bone (x across the shoulders, y along the bone), uniformly scaled
  partBasis(e, A, B, s, out) {
    tY.copy(B).sub(A).normalize();
    tX.copy(e.joints[J.rSh]).sub(e.joints[J.lSh]);
    tZ.crossVectors(tX, tY); if (tZ.lengthSq() < 1e-6) tZ.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
    tZ.normalize(); tX.crossVectors(tY, tZ).normalize();
    out.makeBasis(tX.multiplyScalar(s), tY.multiplyScalar(s), tZ.multiplyScalar(s)); out.setPosition(A);
    return out;
  }

  // ---------------------------------------------------------------- waves
  reset() {
    for (const e of this.enemies) this.pool.push(e);
    for (const L of this.limbs) this.limbPool.push(L);
    this.limbs.length = 0; this.puddles.length = 0; this.boss = null; this.bossDelay = 0; this.bossWave = false;
    for (const pr of this.proj) { pr.state = 'free'; pr.mesh.visible = false; }
    this.enemies.length = 0; this.wave = 0; this.toSpawn = 0; this.running = false; this.waveKilled = 0; this.waveTotal = 0;
    this.syncInstances();
  }
  start() { this.running = true; this.intermission = 2.5; }
  remaining() { return this.toSpawn + (this.bossDelay > 0 ? 1 : 0) + this.enemies.filter((e) => !e.dead).length; }
  aliveCount() { return this.enemies.filter((e) => !e.dead).length; }
  nextWave() {
    this.wave++;
    this.bossWave = this.wave % 5 === 0;
    let n = 6 + this.wave * 5;
    this.brutesLeft = this.wave >= 3 ? Math.floor((this.wave - 1) / 2) : 0;
    if (this.bossWave) { n = Math.round(n * 0.45); this.brutesLeft = 0; this.bossDelay = 2.4; }
    this.toSpawn = n; this.waveTotal = n; this.spawnT = this.bossWave ? 4 : 0.5;
    this.hooks.onWaveStart?.(this.wave, n + (this.bossWave ? 1 : 0), this.bossWave);
  }
  spawnBoss(at) {
    if (!at) { // farthest spawn point from the player
      let best = null, bd = -1;
      for (const sp of this.arena.spawns) { const d = sp.distanceTo(this.player.pos); if (d > bd) { bd = d; best = sp; } }
      at = best.clone();
    }
    const e = this.spawn('boss', at);
    e.hp = e.maxHp = TYPES.boss.hp * (1 + (Math.max(5, this.wave) / 5 - 1) * 0.5);
    this.boss = e;
    this.hooks.audio.play('roar');
    this.hooks.onBoss?.(e);
    return e;
  }
  spittersAlive() { let n = 0; for (const e of this.enemies) if (!e.dead && e.type.ranged) n++; return n; }
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
    e.maxHp = e.hp; e.lost = 0; e.limbDmg = e.limbDmg || new Float32Array(10); e.limbDmg.fill(0);
    e.crawl = false; e.armless = false; e.stumps = []; e.facePlayer = false;
    e.spitCd = rand(1.2, 2.5); e.charge = -1; e.orb = null; e.strafe = Math.random() < 0.5 ? -1 : 1; e.strafeT = rand(1.5, 3); e.spitRecoil = 0;
    e.bs = 'walk'; e.bt = 0; e.chargeCd = 3; e.slamCd = 2; e.stunDur = 1; e.chargeDir = e.chargeDir || new THREE.Vector3(); e.chargeHit = false; e.prePos = e.prePos || new THREE.Vector3();
    e.aware = !idle; e.alertIn = undefined; e.wander = new THREE.Vector3(rand(-28, 28), 0, rand(-28, 28)); e.wanderT = rand(4, 9);
    // walk in through the nearest gate
    const g = Math.abs(at.x) > Math.abs(at.z) ? new THREE.Vector3(Math.sign(at.x) * (ARENA.half - 1.5), 0, clamp(at.z, -2.5, 2.5)) : new THREE.Vector3(clamp(at.x, -2.5, 2.5), 0, Math.sign(at.z) * (ARENA.half - 1.5));
    e.gatePt.copy(g); e.outside = Math.max(Math.abs(at.x), Math.abs(at.z)) > ARENA.half - 2;
    this.pose(e, 0);
    this.enemies.push(e);
    return e;
  }
  debugSpawn(n, dist = 14, idle = false, type = null, ang = null) {
    const P = this.player.pos, out = [];
    for (let i = 0; i < n; i++) {
      const a = ang !== null ? ang + i * 0.35 : (i / n) * Math.PI * 2 + rand(-0.2, 0.2), d = ang !== null ? dist : dist + rand(-2, 3);
      const x = clamp(P.x + Math.sin(a) * d, -34, 34), z = clamp(P.z + Math.cos(a) * d, -34, 34);
      const at = new THREE.Vector3(x, this.groundAt(x, z, 10), z);
      out.push(type === 'boss' ? this.spawnBoss(at) : this.spawn(type || (i % 7 === 6 ? 'brute' : 'runner'), at, idle));
    }
    return out;
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
      if (e.dead && (e.deadT > 0 || !e.type.sever)) continue; // the rest of a blast still tears into a fresh corpse
      c.copy(e.pos); c.y += 0.95 * e.scale;
      if (raySphere(o, d, c, 1.25 * e.scale, maxT) < 0 && c.distanceToSquared(o) > 2.5) continue;
      let best = maxT, part = null, hp = -1;
      for (let pi = 0; pi < this.parts.length; pi++) {
        const P = this.parts[pi];
        if (e.lost & (1 << pi)) continue;
        let t;
        if (P.kind === 'head') { t = raySphere(o, d, e.joints[J.head], 0.15 * e.scale, best); }
        else t = rayCapsule(o, d, e.joints[P.a], e.joints[P.b], P.r * e.scale * (P.name === 'torso' ? 1.15 : 1.1), best);
        if (t >= 0 && t < best) { best = t; part = P.kind; hp = pi; }
      }
      if (part) hits.push({ t: best, e, part, pi: hp, point: o.clone().addScaledVector(d, best) });
    }
    return hits.sort((a, b) => a.t - b.t);
  }
  damage(e, amount, part, point, dir, def, pi = -1) {
    if (e.dead) {
      if (e.deadT === 0 && e.type.sever && pi > 0 && (def.id === 'sg' || def.id === 'mr')) {
        e.limbDmg[pi] += amount * SEVER_F[def.id];
        if (e.limbDmg[pi] >= SEVER_THR[pi] * e.type.sever * (pi === 1 ? 0.5 : 0.35)) this.sever(e, pi, dir);
      }
      return { killed: false, corpse: true };
    }
    const T = e.type, big = def.id !== 'ar';
    const local = Math.sin(e.yaw) * dir.x + Math.cos(e.yaw) * dir.z; // + when shot from behind
    let weak = false, armor = false;
    if (T.boss) {
      // armored: the glowing head and back core take full damage, plates shrug most of it off
      const backCore = part === 'body' && local > 0.3 && point.y > e.pos.y + 1.0 * e.scale;
      if (part === 'head') { amount *= 1.25; weak = true; }
      else if (backCore) { amount *= 2.2; weak = true; }
      else { amount *= part === 'limb' ? 0.4 : 0.28; armor = def.id !== 'melee'; }
      if (e.bs === 'stun') amount *= 1.5;
    }
    e.hp -= amount; e.flash = armor ? 0.35 : 1; e.lastHit = performance.now();
    if (!e.aware) this.wake(e);
    if (armor) { this.hooks.fx.impact(point, dir.clone().negate(), 'metal'); if (Math.random() < 0.5) this.hooks.audio.play('armor'); }
    else if (T.hue) this.hooks.fx.ichor(point, dir, big ? 0.6 : 0.35, true);
    else this.hooks.fx.bloodHit(point, dir, big || part === 'head');
    const dist = point.distanceTo(this.player.pos);
    this.hooks.audio.play('flesh', { gain: clamp(8 / (dist + 3), 0.2, 1) });
    // dismemberment: limb damage builds per part, scaled by how violent the weapon is
    if (T.sever && pi > 0) {
      e.limbDmg[pi] += amount * (SEVER_F[def.id] ?? 0) * (dist < 6 && def.id === 'sg' ? 1.3 : 1);
      if (pi !== 1 && e.limbDmg[pi] >= SEVER_THR[pi] * T.sever) this.sever(e, pi, dir);
    }
    // stagger + knockback (heavier enemies resist)
    const imp = (amount / 30) / T.mass;
    e.kb.addScaledVector(new THREE.Vector3(dir.x, 0, dir.z).normalize(), Math.min(def.knock ? 9 : 6, imp * (def.knock ?? (def.id === 'sg' ? 1.6 : 1.1))));
    e.stagger = Math.max(e.stagger, Math.min(0.55, 0.12 + imp * 0.25));
    if (e.charge >= 0 && imp > 0.9) this.cancelSpit(e);
    // flinch: torso jerks back, head snaps
    e.flinchV -= imp * 9 * Math.sign(local || 1) * -1;
    if (part === 'head') e.headSnapV -= 14 * Math.min(1.5, imp + 0.4) * -Math.sign(local || 1);
    e.twistV += (Math.random() - 0.5) * imp * 22;
    if (e.hp <= 0) {
      const head = part === 'head';
      this.kill(e, point, dir, amount, def, head);
      this.hooks.onKill?.(e, { head, def, weak });
      return { killed: true, head, weak, armor };
    }
    return { killed: false, weak, armor };
  }
  sever(e, pi, dir) {
    const idxs = (SEVER_GROUP[pi] || [pi]).filter((i) => !(e.lost & (1 << i)));
    if (!idxs.length) return;
    for (const i of idxs) e.lost |= 1 << i;
    const jIdx = [PARTS[idxs[0]][1], ...idxs.map((i) => PARTS[i][2])];
    // detached limb: a little Verlet chain that tumbles and burns away
    const L = this.limbs.length >= LIMB_MAX ? this.limbs.shift() : this.limbPool.pop() || { pts: [0, 1, 2].map(() => new THREE.Vector3()), prev: [0, 1, 2].map(() => new THREE.Vector3()), side: new THREE.Vector3(), len: [0, 0] };
    L.n = jIdx.length; L.segs = idxs; L.t = 0; L.dis = 0; L.scale = e.scale; L.hue = e.type.hue || 0; L.heat = e.heat * 1.4;
    L.side.copy(e.joints[J.rSh]).sub(e.joints[J.lSh]).normalize();
    const h = 1 / 120, base = dir.clone().setY(0).normalize().multiplyScalar(rand(2.5, 5)).add(e.vel.clone().multiplyScalar(0.5)); base.y += rand(2.2, 4.2);
    for (let k = 0; k < L.n; k++) {
      L.pts[k].copy(e.joints[jIdx[k]]);
      const v = base.clone().add(new THREE.Vector3(rand(-2.5, 2.5), rand(-1, 1.5), rand(-2.5, 2.5)));
      L.prev[k].copy(L.pts[k]).addScaledVector(v, -h);
    }
    for (let k = 0; k < L.n - 1; k++) L.len[k] = L.pts[k].distanceTo(L.pts[k + 1]);
    this.limbs.push(L);
    const stump = e.joints[jIdx[0]];
    this.hooks.fx.ichor(stump, dir, 1.4, !!e.type.hue);
    e.stumps.push({ j: jIdx[0], t: 1.3 });
    this.hooks.audio.play('sever');
    if (!e.dead) {
      if (idxs.some((i) => i >= 6)) { e.crawl = true; e.stagger = Math.max(e.stagger, 0.7); e.attackT = -1; this.cancelSpit(e); }
      const armsLost = (e.lost & 0b1100) && (e.lost & 0b110000);
      if (armsLost) e.armless = true;
    }
    this.hooks.onSever?.(e, PARTS[pi][0]);
  }
  kill(e, point, dir, amount, def, head) {
    e.dead = true; e.deadT = 0;
    if (e.charge >= 0) this.cancelSpit(e);
    // big headshots pop the head off
    if (head && e.type.sever && e.limbDmg[1] >= SEVER_THR[1] * e.type.sever) this.sever(e, 1, dir);
    // violent kills (shotgun up close, marksman) tear off limbs that were already badly hurt
    if (e.type.sever && (def.id === 'sg' || def.id === 'mr')) {
      for (let pi = 1; pi < 10; pi++) if (e.limbDmg[pi] >= SEVER_THR[pi] * e.type.sever * (pi === 1 ? 0.5 : 0.35)) this.sever(e, pi, dir);
    }
    if (e.type.ranged) { this.hooks.fx.acidBurst(e.joints[J.chest].clone(), false); this.hooks.audio.play('splash', { gain: 0.6 }); }
    if (e.type.boss) {
      for (let i = 0; i < 4; i++) this.hooks.fx.ichor(e.joints[[J.chest, J.head, J.pelvis, J.chest][i]], new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)), 3);
      this.hooks.audio.play('roar', { gain: 0.8 }); this.hooks.onBossDead?.(e);
    }
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
      if (this.bossDelay > 0) { this.bossDelay -= dt; if (this.bossDelay <= 0) this.spawnBoss(); }
      if (this.toSpawn <= 0 && this.aliveCount() === 0 && this.bossDelay <= 0) {
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
          let type = brute ? 'brute' : 'runner';
          if (!brute && this.wave >= 4 && this.spittersAlive() < 2 + Math.floor(this.wave / 4) && Math.random() < 0.16 + this.wave * 0.012) type = 'spitter';
          this.spawn(type, at, type === 'runner' && Math.random() < 0.25);
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
    const dir = new THREE.Vector3(), toP = new THREE.Vector3(), sep = new THREE.Vector3(), perp = new THREE.Vector3();
    for (const e of this.enemies) {
      if (e.stumps.length) this.updateStumps(e, dt);
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
      // spitters hold a firing distance and strafe instead of rushing
      if (T.ranged && e.aware && !e.outside && !e.crawl && dist < 18) {
        e.strafeT -= dt; if (e.strafeT <= 0) { e.strafe = -e.strafe; e.strafeT = rand(1.5, 3.5); }
        perp.set(-toP.z, 0, toP.x).multiplyScalar(e.strafe);
        if (dist < 8) dir.copy(toP).multiplyScalar(-1).addScaledVector(perp, 0.6);
        else dir.copy(perp).addScaledVector(toP, dist < 11 ? -0.25 : 0.25);
        dir.normalize();
      }
      dir.addScaledVector(sep, 1.6);
      // stop at melee range
      let want = e.aware ? e.speed : e.speed * 0.2;
      if (e.crawl) want = Math.max(1.1, e.speed * 0.22);
      const reach = e.crawl ? 1.3 : T.reach;
      if (e.aware && dist < reach * 0.75 && Math.abs(dy) < 1.2) want = 0;
      if (T.ranged && e.charge >= 0) want = 0;
      if (T.ranged && dist < 18 && !e.crawl) want *= 0.75;
      if (e.stagger > 0) { want *= 0.15; e.stagger -= dt; }
      if (e.attackT >= 0) want *= 0.35;
      // brutes charge when close
      if (e.aware && T.brute && !T.boss && dist < 10 && dist > 3) want *= 1.8;
      e.facePlayer = false;
      if (T.boss) want = this.bossBrain(e, dt, dist, dy, toP, dir, want);
      const dl = dir.length(); if (dl > 0) dir.divideScalar(Math.max(1, dl));
      const acc = e.grounded ? 9 : 1.5;
      e.vel.x = damp(e.vel.x, dir.x * want, acc, dt); e.vel.z = damp(e.vel.z, dir.z * want, acc, dt);
      e.kb.multiplyScalar(Math.exp(-7 * dt));
      e.prePos.copy(e.pos);
      e.pos.x += (e.vel.x + e.kb.x) * dt; e.pos.z += (e.vel.z + e.kb.z) * dt;
      this.collide(e);
      if (T.boss && e.bs === 'charge' && e.bt > 0.25) { // slammed into a wall: stunned
        const moved = (e.pos.x - e.prePos.x) * e.chargeDir.x + (e.pos.z - e.prePos.z) * e.chargeDir.z;
        if (moved < 15 * dt * 0.3) { e.bs = 'stun'; e.bt = 0; e.stunDur = 2.2; this.hooks.onShake?.(0.5); this.hooks.audio.play('slam', { gain: 0.6 }); this.hooks.fx.slam(e.pos, 3); }
      }
      // vertical: gravity, step up, leap toward an elevated player
      const g = this.groundAt(e.pos.x, e.pos.z, e.pos.y);
      if (e.grounded && g > e.pos.y) e.pos.y = g;
      e.vy -= 18 * dt; e.pos.y += e.vy * dt;
      if (e.pos.y <= g) { if (!e.grounded && e.vy < -4) e.stagger = 0.15; e.pos.y = g; e.vy = 0; e.grounded = true; } else if (e.pos.y > g + 0.05) e.grounded = false;
      e.leapCd -= dt;
      if (e.aware && e.grounded && dy > 0.9 && dy < 4 && dist < 4.5 && e.leapCd <= 0 && !T.brute && !e.crawl) {
        e.vy = Math.sqrt(2 * 18 * (dy + 0.9)); e.leapCd = 2.2;
        const tt = e.vy / 18 * 1.6; e.vel.copy(toP).multiplyScalar(Math.min(9, dist / tt + 1)); e.grounded = false;
        this.hooks.audio.play('growl', this.spatial(e, { brute: false }));
      }
      // facing + gait
      const sp = Math.hypot(e.vel.x, e.vel.z); e.speedNow = sp;
      const faceYaw = e.aware && (dist < 6 || e.facePlayer) ? Math.atan2(toP.x, toP.z) : sp > 0.3 ? Math.atan2(e.vel.x, e.vel.z) : e.yaw;
      let dyaw = faceYaw - e.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      e.yaw += dyaw * (1 - Math.exp(-10 * dt));
      e.phase += dt * (sp * (T.brute ? 1.5 : e.crawl ? 3.2 : 2.05) / e.scale + 0.5);
      // attack
      e.attackCd -= dt;
      if (e.aware && e.attackT < 0 && e.attackCd <= 0 && dist < reach && Math.abs(dy) < 1.3 && P.alive && e.charge < 0 && (!T.boss || e.bs === 'walk')) {
        e.attackT = 0; this.hooks.audio.play('growl', this.spatial(e, { brute: T.brute }));
      }
      if (e.attackT >= 0) {
        const before = e.attackT; e.attackT += dt;
        if (before < T.windup && e.attackT >= T.windup) {
          this.hooks.audio.play('swing', this.spatial(e));
          if (dist < reach + 0.45 && Math.abs(dy) < 1.4 && e.stagger <= 0) this.hooks.onPlayerHit?.(T.dmg * (e.armless ? 0.45 : e.crawl ? 0.7 : 1), e.pos, e);
        }
        if (e.attackT > T.windup + 0.35) { e.attackT = -1; e.attackCd = T.cd * rand(0.8, 1.2); }
      }
      if (T.ranged && e.aware && !e.outside && P.alive && !e.crawl) this.updateSpit(e, dt, dist);
      e.spitRecoil = Math.max(0, e.spitRecoil - dt * 3);
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
    this.updateProjectiles(dt);
    this.updateLimbs(dt);
    this.updatePuddles(dt);
    // recycle burned corpses
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead && e.dissolve >= 1) { this.enemies.splice(i, 1); this.pool.push(e); if (e === this.boss) this.boss = null; }
    }
    this.syncInstances();
    this.updateBossRig(time);
  }
  // ---------------------------------------------------------------- boss
  bossBrain(e, dt, dist, dy, toP, dir, want) {
    const P = this.player, H = this.hooks;
    e.chargeCd -= dt; e.slamCd -= dt; e.bt += dt;
    if (!e.aware || e.outside) return want;
    switch (e.bs) {
      case 'walk':
        if (dist < 5.8 && e.slamCd <= 0 && Math.abs(dy) < 2 && e.attackT < 0) { e.bs = 'slamWind'; e.bt = 0; H.audio.play('growl', this.spatial(e, { brute: true })); return 0; }
        if (dist > 8 && dist < 26 && e.chargeCd <= 0 && e.attackT < 0 && Math.abs(dy) < 1.5 && this.los(e.joints[J.chest], P.pos.clone().setY(P.pos.y + 1.2))) {
          e.bs = 'chargeWind'; e.bt = 0; H.audio.play('roar', { gain: 0.7 }); H.onShake?.(0.12); return 0;
        }
        return want;
      case 'chargeWind':
        e.facePlayer = true;
        if (e.bt > 0.95) { e.bs = 'charge'; e.bt = 0; e.chargeDir.copy(toP); e.chargeHit = false; }
        return 0;
      case 'charge': {
        dir.copy(e.chargeDir);
        if (Math.random() < 0.5) this.hooks.fx.smoke(e.pos.clone().setY(e.pos.y + 0.2), e.chargeDir.clone().negate(), 1.4);
        if (!e.chargeHit && dist < 2.8 && Math.abs(dy) < 1.8) { e.chargeHit = true; H.onPlayerHit?.(36, e.pos, e, { knock: 15 }); H.onShake?.(0.6); }
        const ahead = toP.x * e.chargeDir.x + toP.z * e.chargeDir.z;
        if (e.bt > 1.6 || (ahead < -0.2 && dist > 4)) { e.bs = 'stun'; e.bt = 0; e.stunDur = 1.2; }
        return 15;
      }
      case 'stun':
        if (e.bt > e.stunDur) { e.bs = 'walk'; e.bt = 0; e.chargeCd = rand(7, 10); }
        return 0;
      case 'slamWind':
        e.facePlayer = true;
        if (e.bt > 1.0) {
          e.bs = 'slamRecover'; e.bt = 0; e.slamCd = rand(5, 7);
          const hit = e.pos.clone().addScaledVector(toP, 1.6 * e.scale * 0.5);
          this.hooks.fx.slam(hit, 8.5); H.audio.play('slam');
          const d = Math.hypot(P.pos.x - hit.x, P.pos.z - hit.z);
          H.onShake?.(clamp(1.1 - d / 22, 0.3, 0.95));
          if (P.grounded && d < 7.5 && Math.abs(P.pos.y - e.pos.y) < 1.6) H.onPlayerHit?.(34 * (1 - (d / 7.5) * 0.55), hit, e, { knock: 10 });
        }
        return 0;
      case 'slamRecover':
        if (e.bt > 0.75) { e.bs = 'walk'; e.bt = 0; }
        return 0;
    }
    return want;
  }

  // ---------------------------------------------------------------- spitter
  los(a, b) {
    const d = tA.copy(b).sub(a); const L = d.length(); d.divideScalar(L || 1);
    for (const c of this.colliders) if (rayAABB(a.x, a.y, a.z, d.x, d.y, d.z, c, L, tN) >= 0) return false;
    return true;
  }
  mouth(e, out) { return out.copy(e.joints[J.head]).add(tB.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(0.16 * e.scale)); }
  updateSpit(e, dt, dist) {
    const P = this.player;
    e.spitCd -= dt;
    if (e.charge < 0) {
      if (e.spitCd > 0 || e.attackT >= 0 || e.stagger > 0) return;
      if (dist > 3.5 && dist < 28 && this.los(e.joints[J.head], tC.copy(P.pos).setY(P.pos.y + 1.2))) {
        const pr = this.proj.find((q) => q.state === 'free');
        if (!pr) { e.spitCd = 0.5; return; }
        e.charge = 0; e.orb = pr; pr.state = 'hold'; pr.mesh.visible = true; pr.mesh.scale.setScalar(0.01);
        this.hooks.audio.play('spitCharge', this.spatial(e));
      } else e.spitCd = 0.4;
      return;
    }
    e.charge += dt; e.facePlayer = true;
    const k = Math.min(1, e.charge / SPIT_CHARGE);
    const pr = e.orb; this.mouth(e, pr.mesh.position); pr.mesh.scale.setScalar(0.03 + 0.1 * k * (0.9 + 0.1 * Math.sin(e.charge * 40)));
    if (k < 1) return;
    // launch a lobbed glob at where the player is heading (half lead, so strafing dodges it)
    const start = pr.mesh.position, tgt = tC.copy(P.pos);
    tgt.y += 1.0;
    const T = clamp(dist / 13, 0.6, 1.45);
    tgt.x += P.vel.x * T * 0.5; tgt.z += P.vel.z * T * 0.5;
    pr.vel.copy(tgt).sub(start).divideScalar(T); pr.vel.y += 0.5 * SPIT_G * T;
    pr.state = 'fly'; pr.life = 3; pr.trailT = 0; pr.mesh.scale.setScalar(0.11);
    e.orb = null; e.charge = -1; e.spitCd = rand(2.6, 3.8); e.spitRecoil = 1;
    this.hooks.audio.play('spit', this.spatial(e));
  }
  cancelSpit(e) {
    if (e.orb) { e.orb.state = 'free'; e.orb.mesh.visible = false; e.orb = null; }
    e.charge = -1; e.spitCd = Math.max(e.spitCd, 1.2);
  }
  updateProjectiles(dt) {
    const P = this.player;
    for (const pr of this.proj) {
      if (pr.state !== 'fly') continue;
      const p = pr.mesh.position;
      pr.vel.y -= SPIT_G * dt; p.addScaledVector(pr.vel, dt); pr.life -= dt;
      pr.trailT -= dt; if (pr.trailT <= 0) { this.hooks.fx.acidTrail(p); pr.trailT = 0.03; }
      // player capsule
      const cy = clamp(p.y, P.pos.y + 0.3, P.pos.y + 1.5);
      if (Math.hypot(p.x - P.pos.x, p.y - cy, p.z - P.pos.z) < 0.55) { this.explode(pr, p, true); continue; }
      const g = this.groundAt(p.x, p.z, p.y, 0);
      if (p.y <= g + 0.05) { p.y = g; this.explode(pr, p, false, true); continue; }
      let wall = false;
      for (const c of this.colliders) if (p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ && p.y > c.minY && p.y < c.maxY) { wall = true; break; }
      if (wall || pr.life <= 0 || p.y < -5) this.explode(pr, p, false, false);
    }
  }
  explode(pr, at, direct, ground) {
    const P = this.player, pt = at.clone();
    pr.state = 'free'; pr.mesh.visible = false;
    const idx = this.hooks.fx.acidBurst(pt, !!ground);
    if (ground) this.puddles.push({ pos: pt, t: 4.5, idx });
    const d = Math.hypot(pt.x - P.pos.x, pt.z - P.pos.z, Math.max(0, Math.abs(pt.y - (P.pos.y + 0.9)) - 0.8));
    const dd = Math.hypot(pt.x - P.pos.x, pt.z - P.pos.z);
    this.hooks.audio.play('splash', { gain: clamp(10 / (dd + 4), 0.15, 1) });
    if (direct || d < 2.6) this.hooks.onAcid?.(direct ? 28 : 24 * (1 - d / 2.6) + 6, pt);
  }
  updatePuddles(dt) {
    const P = this.player;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const q = this.puddles[i]; q.t -= dt;
      if (q.t <= 0) { if (q.idx !== undefined) this.hooks.fx.acid.hide(q.idx); this.puddles.splice(i, 1); continue; }
      if (P.grounded && Math.hypot(P.pos.x - q.pos.x, P.pos.z - q.pos.z) < 1.2 && Math.abs(P.pos.y - q.pos.y) < 0.5) this.hooks.onAcid?.(11 * dt, q.pos, true);
    }
  }

  // ---------------------------------------------------------------- severed limbs
  updateStumps(e, dt) {
    for (let i = e.stumps.length - 1; i >= 0; i--) {
      const st = e.stumps[i]; st.t -= dt;
      if (st.t <= 0 || e.dissolve > 0.2) { e.stumps.splice(i, 1); continue; }
      if (Math.random() < 0.7) {
        const j = e.joints[st.j];
        tA.copy(j).sub(e.joints[J.pelvis]); tA.y += 0.4; tA.normalize();
        this.hooks.fx.stumpSpray(j, tA, !!e.type.hue);
      }
    }
  }
  updateLimbs(dt) {
    const steps = clamp(Math.round(dt * 120), 1, 4), h = 1 / 120;
    for (let i = this.limbs.length - 1; i >= 0; i--) {
      const L = this.limbs[i]; L.t += dt;
      if (L.t > 2.6) L.dis = Math.min(1, L.dis + dt / 1.3);
      if (L.dis >= 1) { this.limbs.splice(i, 1); this.limbPool.push(L); continue; }
      if (L.t > 4) continue;
      for (let st = 0; st < steps; st++) {
        for (let k = 0; k < L.n; k++) {
          const j = L.pts[k], p = L.prev[k];
          const vx = (j.x - p.x) * 0.996, vy = (j.y - p.y) * 0.996, vz = (j.z - p.z) * 0.996;
          p.copy(j); j.x += vx; j.y += vy - 18 * h * h; j.z += vz;
        }
        for (let it = 0; it < 2; it++) for (let k = 0; k < L.n - 1; k++) this.constrain(L.pts[k], L.pts[k + 1], L.len[k]);
        for (let k = 0; k < L.n; k++) {
          const j = L.pts[k], rad = 0.06 * L.scale, g = this.groundAt(j.x, j.z, j.y, 0);
          if (j.y < g + rad) { j.y = g + rad; const p = L.prev[k]; p.x = lerp(p.x, j.x, 0.3); p.z = lerp(p.z, j.z, 0.3); if (p.y < j.y) p.y = lerp(p.y, j.y, 0.6); }
        }
      }
      if (Math.random() < 0.25 && L.t < 1.5) this.hooks.fx.stumpSpray(L.pts[0], tA.set(0, 1, 0), !!L.hue);
    }
  }
  spatial(e, o = {}) {
    const P = this.player, dx = e.pos.x - P.pos.x, dz = e.pos.z - P.pos.z, d = Math.hypot(dx, dz);
    const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
    return { ...o, pan: clamp((dx * rx + dz * rz) / (d + 1), -0.9, 0.9), gain: clamp(10 / (d + 4), 0.06, 1) };
  }

  // procedural run cycle in the enemy's local frame (x right, y up, z forward)
  pose(e, time) {
    if (e.crawl) return this.poseCrawl(e);
    const T = e.type, s = e.scale, sp = clamp(e.speedNow / 6, 0, 1.4), ph = e.phase;
    const L = [];
    // state-driven body language: spitter rears back to charge, boss winds up charge / slam
    let leanAdd = 0, armOv = null, headUp = 0;
    if (e.charge >= 0) { const k = Math.min(1, e.charge / SPIT_CHARGE); leanAdd = -0.4 * k; headUp = -0.5 * k; armOv = [lerp(1, 0.5, k), lerp(1, 0.5, k), 1.4]; }
    if (e.spitRecoil > 0) leanAdd += 0.5 * e.spitRecoil;
    if (T.boss) {
      const k = clamp(e.bt / 0.8, 0, 1);
      if (e.bs === 'chargeWind') { leanAdd = 0.4 * k; armOv = [0.15, 0.15, 0.4]; headUp = -0.3; }
      else if (e.bs === 'charge') { leanAdd = 0.5; armOv = [0.2, 0.2, 0.5]; }
      else if (e.bs === 'stun') { leanAdd = 0.7; armOv = [0.15, 0.25, 0.2]; headUp = 0.5; }
      else if (e.bs === 'slamWind') { leanAdd = -0.25 * k; armOv = [lerp(1, 3.0, k), lerp(1, 3.0, k), lerp(0.5, 0.2, k)]; headUp = -0.3 * k; }
      else if (e.bs === 'slamRecover') { leanAdd = 0.75; armOv = [0.55, 0.55, 0.3]; }
    }
    const bounce = Math.abs(Math.sin(ph)) * 0.07 * sp;
    const hipY = 0.9 - 0.06 * sp + bounce;
    const lean = T.lean + 0.22 * sp + e.flinch + (e.attackT >= 0 ? 0.2 : 0) + leanAdd;
    const twist = e.twist + Math.sin(ph) * 0.12 * sp;
    const pelvis = new THREE.Vector3(0, hipY, 0);
    const ct = Math.cos(twist), st = Math.sin(twist);
    const chest = pelvis.clone().add(new THREE.Vector3(Math.sin(twist) * 0.02, Math.cos(lean) * LEN.torso, Math.sin(lean) * LEN.torso));
    const hl = lean * 0.4 + e.headSnap + headUp;
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
    if (armOv) { la = armOv[0]; ra = armOv[1]; lBend = rBend = armOv[2]; }
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
  // legless: dragging itself along on its arms
  poseCrawl(e) {
    const s = e.scale, ph = e.phase, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const att = e.attackT >= 0 ? Math.sin(Math.min(1, e.attackT / (e.type.windup + 0.2)) * Math.PI) : 0;
    const pelvis = V(0, 0.2, 0), chest = V(Math.sin(ph) * 0.03, 0.34 + att * 0.15, 0.46 + att * 0.1);
    const head = chest.clone().add(V(Math.sin(e.headSnap * 0.5) * 0.05, 0.17 + 0.02 * Math.sin(ph * 2), 0.15));
    const lSh = chest.clone().add(V(-0.2, -0.04, -0.02)), rSh = chest.clone().add(V(0.2, -0.04, -0.02));
    const arm = (sh, sx, off) => {
      const k = Math.sin(ph + off), f = 0.5 + 0.5 * k;
      const el = sh.clone().add(V(sx * 0.2, 0.05 + 0.12 * Math.max(0, k), 0.05 + 0.16 * f));
      const ha = V(el.x + sx * 0.04, 0.04 + 0.1 * Math.max(0, k) + att * 0.3, el.z + 0.2 + 0.12 * f + att * 0.3);
      return [el, ha];
    };
    const [lEl, lHa] = arm(lSh, -1, 0), [rEl, rHa] = arm(rSh, 1, Math.PI);
    const leg = (sx) => {
      const hip = pelvis.clone().add(V(sx * 0.1, 0, -0.03));
      const knee = hip.clone().add(V(sx * 0.07, -0.1 + 0.03 * Math.sin(ph * 1.3 + sx), -0.42));
      const foot = knee.clone().add(V(sx * 0.03, -0.04, -0.42));
      return [hip, knee, foot];
    };
    const [lHip, lKn, lFt] = leg(-1), [rHip, rKn, rFt] = leg(1);
    const Lp = [pelvis, chest, head, lSh, lEl, lHa, rSh, rEl, rHa, lHip, lKn, lFt, rHip, rKn, rFt];
    const cy = Math.cos(e.yaw), sy = Math.sin(e.yaw);
    for (let i = 0; i < NJ; i++) {
      const v = Lp[i];
      e.joints[i].set((v.x * cy + v.z * sy) * s + e.pos.x, v.y * s + e.pos.y, (-v.x * sy + v.z * cy) * s + e.pos.z);
    }
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
    for (let pi = 0; pi < this.parts.length; pi++) {
      const P = this.parts[pi], mesh = P.mesh, bit = 1 << pi;
      for (let i = 0; i < n; i++) {
        const e = this.enemies[i];
        if (e.lost & bit) { tmpM.makeScale(0, 0, 0); mesh.setMatrixAt(i, tmpM); continue; }
        const A = e.joints[P.a], B = e.joints[P.b];
        tY.copy(B).sub(A); const len = tY.length() || 1e-4; tY.divideScalar(len);
        // side axis from shoulders keeps the torso/head facing correctly (also in ragdoll)
        tX.copy(e.joints[J.rSh]).sub(e.joints[J.lSh]);
        tZ.crossVectors(tX, tY);
        if (tZ.lengthSq() < 1e-6) tZ.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
        tZ.normalize(); tX.crossVectors(tY, tZ).normalize();
        const s = e.scale, bulk = pi === 0 ? e.type.bulk || 1 : 1;
        tmpM.makeBasis(tX.multiplyScalar(s * bulk), tY.multiplyScalar(s * (P.kind === 'head' ? 1 : len / (P.len * s))), tZ.multiplyScalar(s * bulk));
        tmpM.setPosition(A);
        mesh.setMatrixAt(i, tmpM);
        const charge = e.charge >= 0 ? 1 + 2.5 * Math.min(1, e.charge / SPIT_CHARGE) : 1;
        const bossGlow = e.type.boss && pi === 1 ? 1.5 : 1; // head weak point burns brighter
        P.flash.array[i] = e.flash; P.diss.array[i] = e.dissolve * 1.05; P.hue.array[i] = e.type.hue || 0;
        P.heat.array[i] = (e.dead ? e.heat * (1 + Math.min(e.deadT, 1.5) * 0.5) : e.heat * charge) * bossGlow;
      }
      // detached limbs share the same instanced meshes
      let c = n;
      for (const L of this.limbs) {
        const k = L.segs.indexOf(pi); if (k < 0 || c >= MAXI) continue;
        const A = L.pts[k], B = L.pts[k + 1];
        tY.copy(B).sub(A); const len = tY.length() || 1e-4; tY.divideScalar(len);
        tZ.crossVectors(L.side, tY); if (tZ.lengthSq() < 1e-6) tZ.set(0, 0, 1);
        tZ.normalize(); tX.crossVectors(tY, tZ).normalize();
        const s = L.scale;
        tmpM.makeBasis(tX.multiplyScalar(s), tY.multiplyScalar(P.kind === 'head' ? s : len / P.len), tZ.multiplyScalar(s));
        tmpM.setPosition(A); mesh.setMatrixAt(c, tmpM);
        P.flash.array[c] = 0; P.diss.array[c] = L.dis * 1.05; P.hue.array[c] = L.hue; P.heat.array[c] = L.heat * (1 + Math.min(L.t, 1.5) * 0.6);
        c++;
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true; P.flash.needsUpdate = P.diss.needsUpdate = P.heat.needsUpdate = P.hue.needsUpdate = true;
    }
    void tS;
  }
}
